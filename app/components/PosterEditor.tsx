"use client";

import { useState } from "react";
import InstagramExportPanel from "./InstagramExportPanel";

// ─── 클라이언트 전용 타입 (서버 lib 임포트 없이 API 응답 구조를 직접 정의) ───

type PxBox = { x: number; y: number; width: number; height: number };
type MmBox = { x: number; y: number; width: number; height: number };

type TextBlock = { type: "text"; content: string; px: PxBox; mm: MmBox };
type ImageBlock = {
  type: "image";
  imageNumber: number;
  px: PxBox;
  mm: MmBox;
  textTooSmall?: boolean;
};
type LayoutBlock = TextBlock | ImageBlock;

export type LayoutResultClient = {
  page: { widthPx: number; heightPx: number; widthMm: number; heightMm: number };
  blocks: LayoutBlock[];
  overflowed: boolean;
};

// 화면 3에 전달되는 선택된 후보 정보
export type EditorCandidate = {
  templateId: string;
  label: string;
  layout: LayoutResultClient;
};

// 생성 시 만들어진 공유 컨텍스트 (이미지 · 페이지 정보)
export type EditorContext = {
  imageDataUrls: string[];
  layoutImages: Array<{
    number: number;
    aspectRatio?: number;
    requiredMinDisplayWidthPx?: number;
  }>;
  pageWidthMm: number;
  pageHeightMm: number;
  referenceStructureId: string | null;
  // 인스타그램 프리셋 선택 여부 — true면 화면3에서 Instagram 탭이 기본으로 열림
  isInstagram: boolean;
  // 레퍼런스 이미지에서 추출한 색상 팔레트 (최대 3개 hex, 없으면 null)
  referenceColors?: string[] | null;
  // 레퍼런스 이미지에서 분석한 폰트 분위기
  referenceFontStyle?: "sans" | "serif" | "handwriting" | null;
};

type DownloadFormat = "pptx" | "docx" | "latex";
const MAX_ADJUSTMENTS = 5;
const PREVIEW_MAX_WIDTH = 380; // 미리보기 폭(px)

// ─── 헬퍼 ───

async function postJson(url: string, body: object): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json() as Promise<Record<string, unknown>>;
}

// ─── 레이아웃 미리보기 컴포넌트 ───
// page.tsx의 후보 카드에서도 사용하므로 export한다.

export function LayoutPreview({
  layout,
  imageDataUrls,
  maxWidth = PREVIEW_MAX_WIDTH,
}: {
  layout: LayoutResultClient;
  imageDataUrls: string[];
  maxWidth?: number;
}) {
  const scale = maxWidth / layout.page.widthPx;
  const previewHeight = Math.round(layout.page.heightPx * scale);

  return (
    <div
      className="relative shrink-0 overflow-hidden border border-black/[.15] bg-white shadow-sm dark:border-white/[.15] dark:bg-zinc-900"
      style={{ width: maxWidth, height: previewHeight }}
    >
      {layout.blocks.map((block, i) => (
        <div
          key={i}
          className="absolute overflow-hidden"
          style={{
            left: Math.round(block.px.x * scale),
            top: Math.round(block.px.y * scale),
            width: Math.round(block.px.width * scale),
            height: Math.round(block.px.height * scale),
          }}
        >
          {block.type === "text" ? (
            <div
              className="h-full w-full bg-zinc-100 p-0.5 leading-tight text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
              style={{ fontSize: Math.max(6, Math.round(11 * scale)) }}
            >
              {block.content}
            </div>
          ) : (
            <div className="relative h-full w-full">
              {imageDataUrls[block.imageNumber - 1] ? (
                // 사용자가 업로드한 임시 미리보기라 next/image 최적화 대상이 아니다
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={imageDataUrls[block.imageNumber - 1]}
                  alt={`이미지 ${block.imageNumber}`}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-zinc-200 text-[8px] text-zinc-500 dark:bg-zinc-700 dark:text-zinc-400">
                  이미지 {block.imageNumber}
                </div>
              )}
              {block.textTooSmall && (
                <div className="absolute inset-0 flex items-center justify-center bg-amber-400/30 text-[7px] text-amber-800">
                  글자 12pt 미만
                </div>
              )}
            </div>
          )}
        </div>
      ))}
      {layout.overflowed && (
        <div className="absolute bottom-0 left-0 right-0 bg-red-500/80 py-0.5 text-center text-[8px] text-white">
          페이지 초과 — 텍스트를 줄여주세요
        </div>
      )}
    </div>
  );
}

// ─── 화면 3 메인 컴포넌트 ───

export default function PosterEditor({
  candidate,
  initialText,
  context,
  onBack,
}: {
  candidate: EditorCandidate;
  initialText: string;
  context: EditorContext;
  onBack: () => void;
}) {
  // 현재 편집 상태
  const [currentTemplateId, setCurrentTemplateId] = useState(candidate.templateId);
  const [currentText, setCurrentText] = useState(initialText);
  const [currentLayout, setCurrentLayout] = useState<LayoutResultClient>(candidate.layout);

  // 조정 횟수 (서버가 실제 카운트를 응답으로 돌려주면 갱신됨)
  const [remainingAdjustments, setRemainingAdjustments] = useState(MAX_ADJUSTMENTS);

  // 명령 입력
  const [command, setCommand] = useState("");

  // 다운로드 형식
  const [downloadFormat, setDownloadFormat] = useState<DownloadFormat>("pptx");

  // 화면 3 하단 탭: 파일 다운로드 | 인스타그램 내보내기
  // 인스타그램 프리셋으로 생성했으면 처음부터 Instagram 탭을 기본으로 열어준다
  const [activeTab, setActiveTab] = useState<"download" | "instagram">(
    context.isInstagram ? "instagram" : "download",
  );

  // 로딩 · 오류
  const [isRecomputing, setIsRecomputing] = useState(false);
  const [isAdjusting, setIsAdjusting] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // DESIGN.md 화면3: 텍스트 수정 후 "텍스트 적용" → AI 없이 규칙 엔진만으로 재배치
  const handleTextApply = async () => {
    setIsRecomputing(true);
    setError(null);
    try {
      const res = await postJson("/api/recompute-layout", {
        templateId: currentTemplateId,
        text: currentText,
        images: context.layoutImages,
        pageWidthMm: context.pageWidthMm,
        pageHeightMm: context.pageHeightMm,
        referenceStructureId: context.referenceStructureId,
      });
      if (typeof res.error === "string") throw new Error(res.error);
      const layout = res.layout as LayoutResultClient | undefined;
      if (layout) setCurrentLayout(layout);
    } catch (err) {
      setError(err instanceof Error ? err.message : "레이아웃 재계산에 실패했습니다.");
    } finally {
      setIsRecomputing(false);
    }
  };

  // DESIGN.md 화면3: 텍스트 명령 → adjust-layout → OpenAI가 템플릿 선택 + 규칙 엔진이 좌표 계산
  const handleCommandSubmit = async () => {
    const trimmed = command.trim();
    if (!trimmed || remainingAdjustments <= 0 || isAdjusting) return;
    setIsAdjusting(true);
    setError(null);
    try {
      const res = await postJson("/api/adjust-layout", {
        currentTemplateId,
        command: trimmed,
        text: currentText,
        images: context.layoutImages,
        pageWidthMm: context.pageWidthMm,
        pageHeightMm: context.pageHeightMm,
        referenceStructureId: context.referenceStructureId,
      });
      // 서버가 돌려주는 실제 남은 횟수로 동기화 (세션 카운터 기반)
      if (typeof res.remainingAdjustments === "number") {
        setRemainingAdjustments(res.remainingAdjustments);
      }
      if (typeof res.error === "string") throw new Error(res.error);
      if (typeof res.templateId === "string") setCurrentTemplateId(res.templateId);
      const layout = res.layout as LayoutResultClient | undefined;
      if (layout) setCurrentLayout(layout);
      setCommand("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "명령 처리에 실패했습니다.");
    } finally {
      setIsAdjusting(false);
    }
  };

  // DESIGN.md 화면3: 선택한 형식으로 파일을 서버에서 만들어 즉시 다운로드
  const handleDownload = async () => {
    setIsDownloading(true);
    setError(null);
    try {
      const res = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          format: downloadFormat,
          layout: currentLayout,
          images: context.imageDataUrls.map((dataUrl, i) => ({
            number: i + 1,
            dataUrl,
          })),
        }),
      });
      if (!res.ok) {
        const json = (await res.json()) as { error?: string };
        throw new Error(json.error ?? "파일 생성에 실패했습니다.");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = downloadFormat === "latex" ? "poster-latex.zip" : `poster.${downloadFormat}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "다운로드에 실패했습니다.");
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="flex w-full flex-col gap-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-black dark:text-zinc-50">편집 · 다운로드</h2>
        <button
          type="button"
          onClick={onBack}
          className="text-sm text-zinc-500 underline underline-offset-2 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
        >
          ← 옵션 다시 선택
        </button>
      </div>

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        {/* 미리보기 — 인스타그램 모드에서는 숨긴다 (Instagram 패널에 자체 미리보기가 있음) */}
        {!context.isInstagram && (
          <div className="flex flex-col gap-1.5">
            <p className="text-xs text-zinc-500 dark:text-zinc-400">미리보기 · {candidate.label}</p>
            <LayoutPreview layout={currentLayout} imageDataUrls={context.imageDataUrls} />
          </div>
        )}

        {/* 오른쪽 편집 패널 */}
        <div className="flex flex-1 flex-col gap-5">

          {/* 텍스트 직접 수정 */}
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              텍스트 수정
            </label>
            <textarea
              value={currentText}
              onChange={(e) => setCurrentText(e.target.value)}
              rows={7}
              className="w-full resize-none rounded-lg border border-black/[.15] bg-transparent px-3 py-2 text-sm outline-none focus:border-black/40 dark:border-white/[.2] dark:focus:border-white/40"
            />
            <button
              type="button"
              onClick={() => void handleTextApply()}
              disabled={isRecomputing}
              className="self-start rounded-lg border border-black/[.15] px-3 py-1.5 text-xs font-medium text-black transition-colors hover:bg-black hover:text-white disabled:opacity-40 dark:border-white/[.2] dark:text-zinc-50 dark:hover:bg-white dark:hover:text-black"
            >
              {isRecomputing ? "재배치 중…" : "텍스트 적용"}
            </button>
          </div>

          {/* 텍스트 명령 조정 (DESIGN.md: 세션당 최대 5회) */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                레이아웃 명령
              </label>
              <span className="text-xs text-zinc-400">
                남은 조정 횟수 {remainingAdjustments}/{MAX_ADJUSTMENTS}
              </span>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void handleCommandSubmit();
                  }
                }}
                placeholder='예: "이미지를 오른쪽으로 옮겨줘"'
                disabled={isAdjusting || remainingAdjustments <= 0}
                className="flex-1 rounded-lg border border-black/[.15] bg-transparent px-3 py-2 text-sm outline-none focus:border-black/40 disabled:opacity-40 dark:border-white/[.2] dark:focus:border-white/40"
              />
              <button
                type="button"
                onClick={() => void handleCommandSubmit()}
                disabled={isAdjusting || !command.trim() || remainingAdjustments <= 0}
                className="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-80 disabled:opacity-40 dark:bg-white dark:text-black"
              >
                {isAdjusting ? "적용 중…" : "전송"}
              </button>
            </div>
            {remainingAdjustments <= 0 && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                조정 횟수를 모두 사용했습니다. 새 포스터를 만들려면 페이지를 새로 고침하세요.
              </p>
            )}
          </div>

          {/* DESIGN.md: 화면 3 하단 — 탭 전환 (파일 다운로드 | 인스타그램 내보내기) */}
          <div className="flex flex-col gap-4">
            <div className="flex overflow-hidden rounded-lg border border-black/[.12] text-sm dark:border-white/[.12]">
              <button
                type="button"
                onClick={() => setActiveTab("download")}
                className={`flex-1 py-2 font-medium transition-colors ${
                  activeTab === "download"
                    ? "bg-black text-white dark:bg-white dark:text-black"
                    : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
                }`}
              >
                파일 다운로드
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("instagram")}
                className={`flex-1 py-2 font-medium transition-colors ${
                  activeTab === "instagram"
                    ? "bg-gradient-to-r from-pink-500 to-purple-500 text-white"
                    : "text-pink-600 hover:bg-pink-50 dark:text-pink-400 dark:hover:bg-pink-950/30"
                }`}
              >
                Instagram 내보내기
              </button>
            </div>

            {activeTab === "download" ? (
              /* 파일 다운로드 탭 (기존 동작 유지) */
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  다운로드 형식
                </label>
                <div className="flex flex-wrap gap-2">
                  {(["pptx", "docx", "latex"] as const).map((fmt) => (
                    <label
                      key={fmt}
                      className={`cursor-pointer rounded-full border px-4 py-1.5 text-sm transition-colors ${
                        downloadFormat === fmt
                          ? "border-black bg-black text-white dark:border-white dark:bg-white dark:text-black"
                          : "border-black/[.15] text-zinc-700 hover:border-black/40 dark:border-white/[.2] dark:text-zinc-300"
                      }`}
                    >
                      <input
                        type="radio"
                        name="download-format"
                        value={fmt}
                        checked={downloadFormat === fmt}
                        onChange={() => setDownloadFormat(fmt)}
                        className="sr-only"
                      />
                      .{fmt}
                    </label>
                  ))}
                </div>
                {downloadFormat === "latex" && (
                  <p className="text-xs text-zinc-400">
                    .tex 파일과 이미지를 묶은 zip으로 다운로드됩니다.
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => void handleDownload()}
                  disabled={isDownloading}
                  className="self-start rounded-lg bg-black px-6 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-80 disabled:opacity-40 dark:bg-white dark:text-black"
                >
                  {isDownloading ? "파일 생성 중…" : "다운로드"}
                </button>
              </div>
            ) : (
              /* 인스타그램 내보내기 탭 (화면 4) */
              <InstagramExportPanel
                posterText={currentText}
                imageDataUrls={context.imageDataUrls}
                pageWidthMm={context.pageWidthMm}
                pageHeightMm={context.pageHeightMm}
                referenceFontStyle={context.referenceFontStyle ?? null}
                referenceColors={context.referenceColors ?? null}
              />
            )}
          </div>

          {/* 오류 메시지 (DESIGN.md: 조정 실패·횟수 초과·다운로드 실패) */}
          {error && (
            <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
