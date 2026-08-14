"use client";

import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from "react";

export type ImageUploadHandle = {
  getImages: () => File[];
};

type ImageUploadProps = {
  // 썸네일의 "삽입" 버튼을 누르면 호출되어, 텍스트 입력 커서 위치에 [이미지N]을 넣는다
  onInsertMarker?: (imageNumber: number) => void;
  // 형식·용량·개수·손상 여부 검증에 실패하면 이유를 전달한다. 성공하면 null로 지운다
  onErrorChange?: (message: string | null) => void;
};

const MAX_IMAGES = 5; // PRD: 이미지 최대 5장
const MAX_IMAGE_BYTES = 500 * 1024; // PRD: 장당 최대 500KB

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

// DESIGN.md 화면1: 이미지 업로드 영역 (파일 선택/드래그앤드롭, 썸네일 표시)
const ImageUpload = forwardRef<ImageUploadHandle, ImageUploadProps>(
  function ImageUpload({ onInsertMarker, onErrorChange }, ref) {
  const [images, setImages] = useState<File[]>([]);

  useImperativeHandle(ref, () => ({
    getImages: () => images,
  }));
  const [isDragging, setIsDragging] = useState(false);

  // 이미지가 바뀔 때만 미리보기 URL을 새로 만든다 (렌더 중 계산되는 파생값)
  const previewUrls = useMemo(
    () => images.map((file) => URL.createObjectURL(file)),
    [images],
  );

  // previewUrls가 바뀌거나 컴포넌트가 사라질 때, 그 시점의 URL들을 반드시 해제한다
  useEffect(() => {
    return () => {
      previewUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [previewUrls]);

  // files는 반드시 호출 시점에 이미 복사된 배열이어야 한다.
  // (input.value를 초기화하면 브라우저가 살아있는 FileList를 비워버려서,
  //  setState 콜백 안에서 뒤늦게 읽으면 파일이 사라진 채로 처리되는 버그가 있었다)
  const validateAndAddFiles = async (incoming: File[]) => {
    if (incoming.length === 0) return;

    const errors: string[] = [];
    const remainingSlots = Math.max(0, MAX_IMAGES - images.length);
    if (incoming.length > remainingSlots) {
      errors.push(
        `이미지는 최대 ${MAX_IMAGES}장까지 올릴 수 있어요. 초과분은 제외했어요.`,
      );
    }

    const sizeChecked: File[] = [];
    for (const file of incoming.slice(0, remainingSlots)) {
      if (!file.type.startsWith("image/")) {
        errors.push(`이미지 파일만 올릴 수 있어요. (${file.name})`);
        continue;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        errors.push(
          `이미지는 장당 최대 500KB까지 올릴 수 있어요. (${file.name})`,
        );
        continue;
      }
      sizeChecked.push(file);
    }

    const decodable = await Promise.all(
      sizeChecked.map(async (file) => ((await canDecodeImage(file)) ? file : null)),
    );
    const openable = decodable.filter((f): f is File => f !== null);
    sizeChecked
      .filter((_, i) => decodable[i] === null)
      .forEach((file) => {
        errors.push(`손상되었거나 열 수 없는 이미지예요. (${file.name})`);
      });

    if (openable.length > 0) {
      setImages((prev) => [...prev, ...openable]);
    }
    onErrorChange?.(errors.length > 0 ? errors.join(" ") : null);
  };

  const removeImage = (index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <div className="flex w-full max-w-md flex-col gap-2 text-left">
      <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
        이미지 업로드
      </span>

      <label
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          void validateAndAddFiles(Array.from(e.dataTransfer.files));
        }}
        className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed px-4 py-6 text-center text-sm transition-colors ${
          isDragging
            ? "border-black bg-black/[.03] dark:border-white dark:bg-white/[.06]"
            : "border-black/[.2] text-zinc-500 dark:border-white/[.25] dark:text-zinc-400"
        }`}
      >
        <span>클릭하거나 이미지를 끌어다 놓으세요</span>
        <input
          type="file"
          accept="image/*"
          multiple
          onChange={(e) => {
            void validateAndAddFiles(
              e.target.files ? Array.from(e.target.files) : [],
            );
            e.target.value = "";
          }}
          className="hidden"
        />
      </label>

      {images.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {images.map((file, index) => (
            <div
              key={`${file.name}-${index}`}
              className="flex flex-col items-center gap-1"
            >
              <div className="relative">
                {/* 사용자가 방금 올린 파일의 임시 미리보기라 next/image 최적화 대상이 아니다 */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={previewUrls[index]}
                  alt={file.name}
                  className="h-16 w-16 rounded object-cover"
                />
                {/* 텍스트 입력에서 [이미지1]처럼 참조할 수 있는 업로드 순서 번호 */}
                <span className="absolute -left-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-white text-xs font-medium text-black shadow dark:bg-black dark:text-white">
                  {index + 1}
                </span>
                <button
                  type="button"
                  onClick={() => removeImage(index)}
                  aria-label={`${file.name} 삭제`}
                  className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black text-xs text-white dark:bg-white dark:text-black"
                >
                  ×
                </button>
              </div>
              {onInsertMarker && (
                <button
                  type="button"
                  onClick={() => onInsertMarker(index + 1)}
                  className="text-[11px] text-zinc-500 underline underline-offset-2 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
                >
                  삽입
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

export default ImageUpload;
