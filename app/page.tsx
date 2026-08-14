"use client";

import { useRef, useState } from "react";
import ChatTextInput, { type ChatTextInputHandle } from "./components/ChatTextInput";
import ImageUpload, { type ImageUploadHandle } from "./components/ImageUpload";
import PageSizeSelector, { type PageSizeSelectorHandle } from "./components/PageSizeSelector";
import ReferenceImageUpload, { type ReferenceImageUploadHandle } from "./components/ReferenceImageUpload";
import PosterEditor, {
  LayoutPreview,
  type EditorCandidate,
  type EditorContext,
  type LayoutResultClient,
} from "./components/PosterEditor";

// DESIGN.md 2번 데이터 흐름에서 사용하는 상수 (pageMetrics.ts와 값을 맞춘다)
const PX_PER_MM = 96 / 25.4;
const MARGIN_PX = 24;

// analyze-reference-font의 FontCandidate.id → InstagramExportPanel FontStyle 매핑
function toFontStyle(fontId: string | null | undefined): "sans" | "serif" | "handwriting" | null {
  if (!fontId) return null;
  if (fontId === "handwriting") return "handwriting";
  if (fontId.startsWith("myeongjo")) return "serif";
  return "sans";
}

// 파일 → data URL 변환 (브라우저 메모리에서만 처리, 서버로 보내기 전 단계)
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error(`${file.name}을 읽을 수 없습니다.`));
    reader.readAsDataURL(file);
  });
}

// data URL에서 이미지 원본 가로·세로 픽셀 크기를 읽는다
function getImageDimensions(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error("이미지 크기를 확인할 수 없습니다."));
    img.src = dataUrl;
  });
}

// JSON POST 요청 헬퍼
async function postJson(url: string, body: object): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json() as Promise<Record<string, unknown>>;
}

// 화면 2 후보 카드 타입 — 화면 3 편집에 필요한 layout 포함
type CandidateCard = {
  templateId: string;
  label: string;
  score: number;
  hasError: boolean;
  errorMessage: string | null;
  layout: LayoutResultClient;
};

export default function Home() {
  const chatInputRef = useRef<ChatTextInputHandle>(null);
  const imageUploadRef = useRef<ImageUploadHandle>(null);
  const pageSizeRef = useRef<PageSizeSelectorHandle>(null);
  const referenceUploadRef = useRef<ReferenceImageUploadHandle>(null);

  const [textError, setTextError] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [referenceError, setReferenceError] = useState<string | null>(null);

  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<CandidateCard[] | null>(null);

  // 화면 3에 필요한 생성 컨텍스트 (이미지 데이터 URL · 페이지 정보)
  const [genContext, setGenContext] = useState<EditorContext | null>(null);
  // 화면 3에 필요한 최종 텍스트 (요약 후 실제 배치에 사용된 텍스트)
  const [genFinalText, setGenFinalText] = useState<string>("");
  // "이걸로 선택"을 누르면 화면 3으로 전환
  const [selectedEditor, setSelectedEditor] = useState<EditorCandidate | null>(null);

  const inputErrors = [textError, imageError, referenceError].filter(
    (m): m is string => m !== null,
  );

  // DESIGN.md 2번 데이터 흐름: 입력 수집 → 검증 → AI 처리 → 레이아웃 계산 → 결과 반환
  const handleGenerate = async () => {
    if (
      !chatInputRef.current ||
      !imageUploadRef.current ||
      !pageSizeRef.current ||
      !referenceUploadRef.current
    )
      return;

    const text = chatInputRef.current.getText();
    const imageFiles = imageUploadRef.current.getImages();
    const size = pageSizeRef.current.getSize();
    const referenceFile = referenceUploadRef.current.getImage();

    if (!size) {
      setGenerationError("페이지 크기를 올바르게 입력해주세요. (커스텀 선택 시 가로·세로 모두 입력)");
      return;
    }

    setIsGenerating(true);
    setGenerationError(null);
    setCandidates(null);
    setSelectedEditor(null);

    try {
      // 파일 → data URL 변환 (브라우저 메모리, 서버 미전송)
      const imageDataUrls = await Promise.all(imageFiles.map(fileToDataUrl));
      const referenceDataUrl = referenceFile ? await fileToDataUrl(referenceFile) : null;

      // 이미지 원본 크기 파악 (Vision 12pt 보정에 필요)
      const imageDims = await Promise.all(imageDataUrls.map(getImageDimensions));

      // 페이지 여백을 뺀 배치 가능 폭 (이미지 Vision 분석의 기준 표시 폭으로 사용)
      const usableWidthPx = Math.max(0, size.widthMm * PX_PER_MM - MARGIN_PX * 2);

      // DESIGN.md 5번: 요약·이미지 분석·레퍼런스 분석을 병렬로 호출한다
      const [summarizeRes, batchRes, refColorsRes, refFontRes, refStructRes] =
        await Promise.all([
          // 텍스트 요약 (페이지를 초과할 때만 API 호출됨, 아니면 원문 반환)
          postJson("/api/summarize", {
            text,
            pageWidthMm: size.widthMm,
            pageHeightMm: size.heightMm,
          }),

          // 이미지 Vision 분석 — 병렬 처리 (PLAN.md 19번)
          imageDataUrls.length > 0
            ? postJson("/api/analyze-images-batch", {
                images: imageDataUrls.map((dataUrl, i) => ({
                  imageDataUrl: dataUrl,
                  nativeWidthPx: imageDims[i].width,
                  nativeHeightPx: imageDims[i].height,
                  displayWidthPx: usableWidthPx,
                })),
              })
            : (Promise.resolve({ results: [] }) as Promise<Record<string, unknown>>),

          // 레퍼런스 색상 추출 (레퍼런스가 없으면 건너뜀)
          referenceDataUrl
            ? postJson("/api/extract-colors", { imageDataUrl: referenceDataUrl })
            : (Promise.resolve({ colors: null }) as Promise<Record<string, unknown>>),

          // 레퍼런스 폰트 분석
          referenceDataUrl
            ? postJson("/api/analyze-reference-font", { imageDataUrl: referenceDataUrl })
            : (Promise.resolve({ font: null }) as Promise<Record<string, unknown>>),

          // 레퍼런스 레이아웃 구조 분석 (점수 계산 시 유사도 반영용)
          referenceDataUrl
            ? postJson("/api/analyze-reference-structure", { imageDataUrl: referenceDataUrl })
            : (Promise.resolve({ structureId: null }) as Promise<Record<string, unknown>>),
        ]);

      // API 오류 확인
      for (const res of [summarizeRes, batchRes, refColorsRes, refFontRes, refStructRes]) {
        if (typeof res.error === "string") throw new Error(res.error);
      }

      // Vision 분석 결과로 이미지별 필수 표시 폭 추출
      const analysisResults = (batchRes.results as Array<{ requiredMinDisplayWidthPx?: number }>) ?? [];
      const layoutImages = imageFiles.map((_, i) => {
        const minWidth = analysisResults[i]?.requiredMinDisplayWidthPx;
        return {
          number: i + 1,
          aspectRatio:
            imageDims[i].height > 0 ? imageDims[i].width / imageDims[i].height : 1,
          ...(typeof minWidth === "number" ? { requiredMinDisplayWidthPx: minWidth } : {}),
        };
      });

      // 레이아웃 후보 3개 생성 (인스타그램 프리셋이면 isInstagram=true로 점수 기준 변경)
      const candidatesRes = await postJson("/api/layout-candidates", {
        text: (summarizeRes.finalText as string | undefined) ?? text,
        images: layoutImages,
        pageWidthMm: size.widthMm,
        pageHeightMm: size.heightMm,
        referenceStructureId: refStructRes.structureId ?? null,
        isInstagram: size.isInstagram,
      });

      if (typeof candidatesRes.error === "string") throw new Error(candidatesRes.error);

      const raw = (candidatesRes.candidates as CandidateCard[] | undefined) ?? [];

      // 인스타그램 모드: 레이아웃 선택 화면 없이 점수 1위 후보를 자동 선택
      if (size.isInstagram && raw.length > 0) {
        setCandidates(null);
        setSelectedEditor({
          templateId: raw[0].templateId,
          label: raw[0].label,
          layout: raw[0].layout,
        });
      } else {
        setCandidates(raw);
      }

      // 화면 3용 컨텍스트를 여기서 저장한다 (이미지 데이터 URL은 브라우저 메모리에만 유지)
      const finalText = (summarizeRes.finalText as string | undefined) ?? text;
      setGenFinalText(finalText);
      setGenContext({
        imageDataUrls,
        layoutImages,
        pageWidthMm: size.widthMm,
        pageHeightMm: size.heightMm,
        referenceStructureId: (refStructRes.structureId as string | null) ?? null,
        isInstagram: size.isInstagram,
        referenceColors: (refColorsRes.colors as string[] | null) ?? null,
        referenceFontStyle: toFontStyle(
          (refFontRes.font as { id?: string } | null)?.id,
        ),
      });
    } catch (err) {
      setGenerationError(
        err instanceof Error ? err.message : "포스터 생성 중 오류가 발생했습니다.",
      );
    } finally {
      setIsGenerating(false);
    }
  };

  // 화면 3: "이걸로 선택" 후 PosterEditor로 전환
  if (selectedEditor !== null && genContext !== null) {
    return (
      <div className="flex flex-1 items-center justify-center bg-zinc-50 font-sans dark:bg-black">
        <main className="flex w-full max-w-4xl flex-col items-center gap-6 px-8 py-16">
          <PosterEditor
            candidate={selectedEditor}
            initialText={genFinalText}
            context={genContext}
            onBack={() => setSelectedEditor(null)}
          />
        </main>
      </div>
    );
  }

  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex w-full max-w-2xl flex-col items-center gap-6 px-8 py-16">

        {/* 화면 1 — 입력 영역 (DESIGN.md) */}
        <div className="flex w-full flex-col items-center gap-6 text-center">
          <div className="flex flex-col items-center gap-2">
            <h1 className="text-3xl font-semibold tracking-tight text-black dark:text-zinc-50">
              포스터 자동 생성 서비스
            </h1>
            <p className="max-w-md text-zinc-600 dark:text-zinc-400">
              텍스트와 이미지를 입력하면 한 장짜리 포스터를 자동으로 배치해 드립니다.
            </p>
          </div>

          <ChatTextInput ref={chatInputRef} onErrorChange={setTextError} />
          <ImageUpload
            ref={imageUploadRef}
            onInsertMarker={(imageNumber) =>
              chatInputRef.current?.insertAtCursor(`[이미지${imageNumber}]`)
            }
            onErrorChange={setImageError}
          />
          <PageSizeSelector ref={pageSizeRef} />
          <ReferenceImageUpload ref={referenceUploadRef} onErrorChange={setReferenceError} />

          {/* 업로드 입력 오류 (형식·용량·개수·손상) */}
          {inputErrors.length > 0 && (
            <div className="w-full rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-left text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
              {inputErrors.map((message, i) => (
                <p key={i}>{message}</p>
              ))}
            </div>
          )}

          {/* 포스터 만들기 버튼 */}
          <button
            type="button"
            onClick={() => void handleGenerate()}
            disabled={isGenerating}
            className="w-full max-w-md rounded-lg bg-black px-6 py-3 text-sm font-medium text-white transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-black"
          >
            {isGenerating ? "포스터 생성 중…" : "포스터 만들기"}
          </button>

          {/* 생성 오류 */}
          {generationError && (
            <div className="w-full rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-left text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
              <p>{generationError}</p>
            </div>
          )}
        </div>

        {/* 화면 2 — 레이아웃 후보 선택 (DESIGN.md, 3옵션 카드) */}
        {candidates && candidates.length > 0 && (
          <section className="w-full">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-black dark:text-zinc-50">
                레이아웃 옵션 선택
              </h2>
              <button
                type="button"
                onClick={() => setCandidates(null)}
                className="text-sm text-zinc-500 underline underline-offset-2 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
              >
                다시 만들기
              </button>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {candidates.map((c) => (
                <div
                  key={c.templateId}
                  className="flex flex-col gap-3 rounded-xl border border-black/[.12] bg-white p-4 shadow-sm dark:border-white/[.12] dark:bg-zinc-900"
                >
                  {/* 레이아웃 미리보기 */}
                  {genContext && (
                    <div className="overflow-hidden rounded-lg">
                      <LayoutPreview
                        layout={c.layout}
                        imageDataUrls={genContext.imageDataUrls}
                        maxWidth={200}
                      />
                    </div>
                  )}
                  <div className="flex-1">
                    <p className="text-sm font-medium text-black dark:text-zinc-50">
                      {c.label}
                    </p>
                    <p className="mt-1 text-xs text-zinc-400">
                      적합도 {Math.round(c.score)}점
                    </p>
                    {c.hasError && c.errorMessage && (
                      <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                        ⚠ {c.errorMessage}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedEditor({
                        templateId: c.templateId,
                        label: c.label,
                        layout: c.layout,
                      })
                    }
                    className="w-full rounded-lg border border-black/[.15] px-3 py-2 text-sm font-medium text-black transition-colors hover:bg-black hover:text-white dark:border-white/[.2] dark:text-zinc-50 dark:hover:bg-white dark:hover:text-black"
                  >
                    이걸로 선택
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
