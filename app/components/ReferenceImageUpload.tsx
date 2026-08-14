"use client";

import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from "react";

export type ReferenceImageUploadHandle = {
  getImage: () => File | null;
};

type ReferenceImageUploadProps = {
  // 형식·용량·손상 여부 검증에 실패하면 이유를 전달한다. 성공하면 null로 지운다
  onErrorChange?: (message: string | null) => void;
};

const MAX_REFERENCE_BYTES = 800 * 1024; // PRD: 레퍼런스 이미지 최대 800KB, 1개만

// 실제로 디코딩을 시도해 손상된 이미지를 걸러낸다 (형식·용량은 맞지만 내용이 깨진 경우)
function canDecodeImage(file: File): Promise<boolean> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(true);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(false);
    };
    img.src = url;
  });
}

// DESIGN.md 화면1: 레퍼런스 업로드 영역 (선택 사항, 이미지 1개, 최대 800KB)
// PDF·PPTX 등 문서 레퍼런스는 PRD 비범위라 다루지 않는다
const ReferenceImageUpload = forwardRef<ReferenceImageUploadHandle, ReferenceImageUploadProps>(
  function ReferenceImageUpload({ onErrorChange }, ref) {
  const [image, setImage] = useState<File | null>(null);

  useImperativeHandle(ref, () => ({
    getImage: () => image,
  }));
  const [isDragging, setIsDragging] = useState(false);

  const previewUrl = useMemo(
    () => (image ? URL.createObjectURL(image) : null),
    [image],
  );
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const validateAndSet = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      onErrorChange?.(`레퍼런스는 이미지 파일만 올릴 수 있어요. (${file.name})`);
      return;
    }
    if (file.size > MAX_REFERENCE_BYTES) {
      onErrorChange?.(
        `레퍼런스 이미지는 최대 800KB까지 올릴 수 있어요. (${file.name})`,
      );
      return;
    }
    const decodable = await canDecodeImage(file);
    if (!decodable) {
      onErrorChange?.(`손상되었거나 열 수 없는 이미지예요. (${file.name})`);
      return;
    }
    setImage(file); // 이미 1개가 있어도 새로 올리면 교체한다 (최대 1개)
    onErrorChange?.(null);
  };

  return (
    <div className="flex w-full max-w-md flex-col gap-2 text-left">
      <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
        레퍼런스 업로드 (선택 사항)
      </span>

      {image && previewUrl ? (
        <div className="relative w-fit">
          {/* 사용자가 방금 올린 파일의 임시 미리보기라 next/image 최적화 대상이 아니다 */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewUrl}
            alt={image.name}
            className="h-20 w-20 rounded object-cover"
          />
          <button
            type="button"
            onClick={() => setImage(null)}
            aria-label={`${image.name} 삭제`}
            className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black text-xs text-white dark:bg-white dark:text-black"
          >
            ×
          </button>
        </div>
      ) : (
        <label
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            void validateAndSet(e.dataTransfer.files[0]);
          }}
          className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed px-4 py-6 text-center text-sm transition-colors ${
            isDragging
              ? "border-black bg-black/[.03] dark:border-white dark:bg-white/[.06]"
              : "border-black/[.2] text-zinc-500 dark:border-white/[.25] dark:text-zinc-400"
          }`}
        >
          <span>원하는 디자인 느낌의 이미지를 올려보세요 (선택)</span>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => {
              void validateAndSet(e.target.files?.[0]);
              e.target.value = "";
            }}
            className="hidden"
          />
        </label>
      )}
    </div>
  );
});

export default ReferenceImageUpload;
