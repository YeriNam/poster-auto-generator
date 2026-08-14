"use client";

// PLAN.md 25번: 화면 4 — 인스타그램 내보내기 탭
// PLAN.md 26번: Web Share API (다중 파일 지원) + 데스크톱 폴백
//
// 오버레이 텍스트는 포스터 텍스트에서 [이미지N] 마커를 기준으로 각 이미지에 연관된
// 단락을 자동 추출한다 (수동 입력 없음).
// 다중 이미지(imageDataUrls.length > 1) → 병렬 합성 → 카루셀 미리보기 → 전체 공유/다운로드.

import { useState, useEffect, useRef, useCallback } from "react";

type TextPosition = "top" | "center" | "bottom";
type FontStyle = "sans" | "serif" | "handwriting";
type LogoPosition = "top-left" | "top-right" | "bottom-left" | "bottom-right";

type HashtagCategories = {
  topic: string[];
  mood: string[];
  location: string[];
  misc: string[];
};

const FONT_LABELS: Record<FontStyle, string> = {
  sans: "고딕",
  serif: "명조",
  handwriting: "손글씨",
};

const TEXT_POSITION_LABELS: Record<TextPosition, string> = {
  top: "상단",
  center: "중앙",
  bottom: "하단",
};

const LOGO_POSITION_LABELS: Record<LogoPosition, string> = {
  "top-left": "좌상단",
  "top-right": "우상단",
  "bottom-left": "좌하단",
  "bottom-right": "우하단",
};

const HASHTAG_CAT_LABELS: Record<keyof HashtagCategories, string> = {
  topic: "주제",
  mood: "분위기",
  location: "장소",
  misc: "기타",
};

// ─────────────────────────────────────────────────────────────────────────────
// 텍스트 파싱: [이미지N] 마커를 기준으로 각 이미지에 연관된 텍스트를 추출한다.
//
// 마커가 있으면 마커 직후 텍스트(다음 마커 직전까지)를 해당 이미지의 오버레이 텍스트로 사용.
// 마커가 없거나 해당 번호의 마커가 없으면 첫 단락(제목/도입부)으로 폴백.
// ─────────────────────────────────────────────────────────────────────────────
function parseImageTexts(posterText: string, imageCount: number): string[] {
  const count = imageCount > 0 ? imageCount : 1;

  // 마커가 없거나 매칭되는 텍스트가 없으면 빈 문자열 (사용자가 직접 입력하거나 이미지 분석으로 채움)
  const fallback = "";

  const MARKER_RE = /\[이미지(\d+)\]/g;
  const markers: { start: number; end: number; num: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = MARKER_RE.exec(posterText)) !== null) {
    markers.push({ start: m.index, end: m.index + m[0].length, num: parseInt(m[1], 10) });
  }

  const results: string[] = [];
  for (let imgNum = 1; imgNum <= count; imgNum++) {
    const marker = markers.find((mk) => mk.num === imgNum);
    if (marker) {
      const nextMarker = markers.find((mk) => mk.start > marker.end);
      const raw = nextMarker
        ? posterText.slice(marker.end, nextMarker.start)
        : posterText.slice(marker.end);
      const trimmed = raw.trim().slice(0, 200);
      results.push(trimmed || fallback);
    } else {
      results.push(fallback);
    }
  }
  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// 메인 컴포넌트
// ─────────────────────────────────────────────────────────────────────────────

export default function InstagramExportPanel({
  posterText,
  imageDataUrls,
  pageWidthMm,
  pageHeightMm,
  referenceFontStyle = null,
  referenceColors = null,
}: {
  posterText: string;
  imageDataUrls: string[];
  pageWidthMm: number;
  pageHeightMm: number;
  referenceFontStyle?: "sans" | "serif" | "handwriting" | null;
  referenceColors?: string[] | null;
}) {
  const isCarousel = imageDataUrls.length > 1;

  // 각 이미지에 연관된 오버레이 텍스트 — 자동 파싱으로 초기값 설정, 사용자가 직접 수정 가능
  const [overlayTexts, setOverlayTexts] = useState<string[]>(() =>
    parseImageTexts(posterText, imageDataUrls.length || 1),
  );
  // posterText 또는 이미지 개수가 바뀌면 렌더 중 동기적으로 리셋한다 (React 권장 파생 상태 패턴).
  const [prevPosterText, setPrevPosterText] = useState(posterText);
  const [prevImageCount, setPrevImageCount] = useState(imageDataUrls.length);
  const currentCount = imageDataUrls.length || 1;
  if (prevPosterText !== posterText || prevImageCount !== currentCount) {
    setPrevPosterText(posterText);
    setPrevImageCount(currentCount);
    setOverlayTexts(parseImageTexts(posterText, currentCount));
  }

  // ─── 스타일 설정 ───
  const [textPosition, setTextPosition] = useState<TextPosition>("bottom");
  // 레퍼런스 분석 결과로 초기값 설정 (없으면 고딕)
  const [fontStyle, setFontStyle] = useState<FontStyle>(referenceFontStyle ?? "sans");
  // 레퍼런스 팔레트 첫 번째 색상으로 초기값 설정 (없으면 흰색; API가 WCAG AA로 자동 보정)
  const [textColor, setTextColor] = useState<string>(referenceColors?.[0] ?? "#ffffff");

  // ─── 로고 ───
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);
  const [logoPosition, setLogoPosition] = useState<LogoPosition>("top-right");
  const [logoError, setLogoError] = useState<string | null>(null);

  // ─── 미리보기 Blob URL 배열 ───
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const prevUrlsRef = useRef<string[]>([]);
  const [isGeneratingPreview, setIsGeneratingPreview] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // ─── 해시태그 ───
  const [hashtags, setHashtags] = useState<HashtagCategories | null>(null);
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [customTag, setCustomTag] = useState("");
  const [isGeneratingHashtags, setIsGeneratingHashtags] = useState(false);
  const [hashtagError, setHashtagError] = useState<string | null>(null);

  // ─── Vision 텍스트 매칭 ───
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);

  // ─── 공유/복사 상태 ───
  const [shareState, setShareState] = useState<"idle" | "sharing" | "copied" | "error">("idle");
  const [shareError, setShareError] = useState<string | null>(null);

  // 언마운트 시 모든 Blob URL 정리
  useEffect(() => {
    return () => {
      prevUrlsRef.current.forEach((u) => URL.revokeObjectURL(u));
    };
  }, []);

  // ─── Vision 이미지→텍스트 매칭 ───
  // 이미지 내용을 분석해 포스터 텍스트에서 가장 관련 있는 구절을 찾아 textarea를 채운다.
  const analyzeAndMatch = useCallback(async () => {
    if (isAnalyzing || imageDataUrls.length === 0) return;
    setIsAnalyzing(true);
    setAnalyzeError(null);

    try {
      const res = await fetch("/api/match-image-text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ images: imageDataUrls, posterText }),
      });
      const json = (await res.json()) as { matchedTexts?: string[]; error?: string };
      if (json.error) throw new Error(json.error);
      if (Array.isArray(json.matchedTexts)) {
        setOverlayTexts(json.matchedTexts.map((t) => t ?? ""));
      }
    } catch (err) {
      setAnalyzeError(err instanceof Error ? err.message : "이미지 분석에 실패했습니다.");
    } finally {
      setIsAnalyzing(false);
    }
  }, [imageDataUrls, posterText, isAnalyzing]);

  // ─── 로고 업로드 ───

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLogoError(null);
    if (file.size > 500 * 1024) {
      setLogoError("로고 파일이 500KB를 초과합니다.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setLogoDataUrl(reader.result as string);
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  // ─── 오버레이 이미지 생성 ───
  // 이미지가 여러 장이면 각각 다른 연관 텍스트로 병렬 합성한다.

  const generatePreview = useCallback(async () => {
    if (isGeneratingPreview) return;
    setIsGeneratingPreview(true);
    setPreviewError(null);

    const targets = imageDataUrls.length > 0 ? imageDataUrls : [null];

    try {
      const blobs = await Promise.all(
        targets.map(async (imgUrl, idx) => {
          const text = overlayTexts[idx] ?? overlayTexts[0] ?? "";
          const res = await fetch("/api/create-overlay-image", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...(imgUrl ? { imageDataUrl: imgUrl } : {}),
              text,
              pageWidthMm,
              pageHeightMm,
              textPosition,
              fontStyle,
              textColor,
              ...(logoDataUrl ? { logoDataUrl, logoPosition } : {}),
            }),
          });
          if (!res.ok) {
            const json = (await res.json()) as { error?: string };
            throw new Error(json.error ?? "이미지 합성 실패");
          }
          return res.blob();
        }),
      );

      prevUrlsRef.current.forEach((u) => URL.revokeObjectURL(u));
      const urls = blobs.map((b) => URL.createObjectURL(b));
      prevUrlsRef.current = urls;
      setPreviewUrls(urls);
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : "이미지 합성에 실패했습니다.");
    } finally {
      setIsGeneratingPreview(false);
    }
  }, [
    imageDataUrls,
    overlayTexts,
    pageWidthMm,
    pageHeightMm,
    textPosition,
    fontStyle,
    textColor,
    logoDataUrl,
    logoPosition,
    isGeneratingPreview,
  ]);

  // ─── 해시태그 추천 ───

  const generateHashtags = useCallback(async () => {
    if (isGeneratingHashtags) return;
    setIsGeneratingHashtags(true);
    setHashtagError(null);

    try {
      const res = await fetch("/api/generate-hashtags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: posterText,
          imageDataUrls: imageDataUrls.length > 0 ? [imageDataUrls[0]] : [],
        }),
      });
      const json = (await res.json()) as { categories?: HashtagCategories; error?: string };
      if (json.error) throw new Error(json.error);
      if (json.categories) {
        setHashtags(json.categories);
        setSelectedTags(new Set([...json.categories.topic, ...json.categories.mood]));
      }
    } catch (err) {
      setHashtagError(err instanceof Error ? err.message : "해시태그 생성에 실패했습니다.");
    } finally {
      setIsGeneratingHashtags(false);
    }
  }, [posterText, imageDataUrls, isGeneratingHashtags]);

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  };

  const addCustomTag = () => {
    const raw = customTag.trim();
    if (!raw) return;
    const tag = raw.startsWith("#") ? raw : `#${raw}`;
    setSelectedTags((prev) => new Set([...prev, tag]));
    setCustomTag("");
  };

  const captionText = [...selectedTags].join(" ");

  // ─── 클립보드 복사 ───

  const handleCopyCaption = async () => {
    try {
      await navigator.clipboard.writeText(captionText);
      setShareState("copied");
      setTimeout(() => setShareState("idle"), 2000);
    } catch {
      // 권한 거부 시 무시
    }
  };

  // ─── 다운로드 ───

  const handleDownloadAll = () => {
    previewUrls.forEach((url, i) => {
      const a = document.createElement("a");
      a.href = url;
      a.download =
        previewUrls.length === 1
          ? "instagram-poster.png"
          : `${String(i + 1).padStart(2, "0")}-instagram-poster.png`;
      a.click();
    });
  };

  // ─── Web Share API / 폴백 ───

  const handleShare = async () => {
    if (previewUrls.length === 0 || shareState === "sharing") return;
    setShareState("sharing");
    setShareError(null);

    try {
      const blobs = await Promise.all(previewUrls.map((u) => fetch(u).then((r) => r.blob())));
      const files = blobs.map(
        (b, i) =>
          new File(
            [b],
            previewUrls.length === 1
              ? "instagram-poster.png"
              : `${String(i + 1).padStart(2, "0")}-instagram-poster.png`,
            { type: "image/png" },
          ),
      );

      if (navigator.canShare?.({ files })) {
        await navigator.share({ files, text: captionText });
        setShareState("idle");
      } else {
        handleDownloadAll();
        if (captionText) await navigator.clipboard.writeText(captionText).catch(() => undefined);
        setShareState("copied");
        setTimeout(() => setShareState("idle"), 3000);
      }
    } catch (err) {
      if (err instanceof Error && err.name !== "AbortError") {
        setShareError(err.message);
        setShareState("error");
      } else {
        setShareState("idle");
      }
    }
  };

  // ─── 공통 pill 스타일 ───

  const pill = (active: boolean, pink = false) =>
    `cursor-pointer rounded-full border px-3 py-1 text-xs transition-colors ${
      active
        ? pink
          ? "border-pink-600 bg-pink-600 text-white"
          : "border-black bg-black text-white dark:border-white dark:bg-white dark:text-black"
        : pink
          ? "border-pink-300 text-pink-700 hover:border-pink-500 dark:border-pink-800 dark:text-pink-300"
          : "border-black/[.15] text-zinc-600 hover:border-black/40 dark:border-white/[.2] dark:text-zinc-400"
    }`;

  // ─────────────────────────────────────────────────────────────────────────
  // 렌더
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-6">
      {/* 카루셀 모드 알림 */}
      {isCarousel && (
        <div className="rounded-lg border border-pink-200 bg-pink-50 px-3 py-2 text-xs text-pink-700 dark:border-pink-900 dark:bg-pink-950/40 dark:text-pink-300">
          카루셀 모드 — 이미지 {imageDataUrls.length}장에 각각 연관된 텍스트를 자동 적용합니다.
        </div>
      )}

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">

        {/* ─ 왼쪽: 설정 + 미리보기 ─ */}
        <div className="flex flex-col gap-4 lg:w-64 lg:shrink-0">

          {/* 자동 추출 텍스트 — 편집 가능 */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                이미지에 넣을 텍스트
                <span className="ml-1 text-zinc-400">(직접 수정 가능)</span>
              </span>
              {imageDataUrls.length > 0 && (
                <button
                  type="button"
                  onClick={() => void analyzeAndMatch()}
                  disabled={isAnalyzing}
                  className="shrink-0 text-xs text-pink-600 underline underline-offset-2 hover:text-pink-800 disabled:opacity-40 dark:text-pink-400 dark:hover:text-pink-200"
                >
                  {isAnalyzing ? "분석 중…" : "이미지로 자동 분석"}
                </button>
              )}
            </div>
            {analyzeError && (
              <p className="text-xs text-red-600 dark:text-red-400">{analyzeError}</p>
            )}
            {overlayTexts.map((t, i) => (
              <div key={i} className="flex gap-2">
                {/* 이미지 썸네일 */}
                {imageDataUrls[i] ? (
                  <div className="h-20 w-20 shrink-0 overflow-hidden rounded-lg border border-black/[.12] dark:border-white/[.12]">
                    {/* 사용자가 업로드한 임시 미리보기 — next/image 최적화 대상이 아님 */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={imageDataUrls[i]}
                      alt={`이미지 ${i + 1}`}
                      className="h-full w-full object-cover"
                    />
                  </div>
                ) : (
                  <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-lg border border-dashed border-black/[.15] bg-zinc-50 text-xs text-zinc-400 dark:border-white/[.15] dark:bg-zinc-900">
                    {i + 1}
                  </div>
                )}
                {/* 텍스트 입력 */}
                <div className="flex flex-1 flex-col gap-0.5">
                  {isCarousel && (
                    <span className="text-xs font-medium text-zinc-400">이미지 {i + 1}</span>
                  )}
                  <textarea
                    value={t}
                    onChange={(e) => {
                      const next = [...overlayTexts];
                      next[i] = e.target.value;
                      setOverlayTexts(next);
                    }}
                    rows={3}
                    className="w-full resize-y rounded-lg border border-black/[.15] bg-transparent px-3 py-2 text-xs text-zinc-700 outline-none focus:border-black/40 dark:border-white/[.2] dark:text-zinc-300 dark:focus:border-white/40"
                  />
                </div>
              </div>
            ))}
          </div>

          {/* 텍스트 위치 */}
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-zinc-500 dark:text-zinc-400">텍스트 위치</span>
            <div className="flex gap-1.5">
              {(["bottom", "top", "center"] as TextPosition[]).map((pos) => (
                <label key={pos} className={pill(textPosition === pos)}>
                  <input
                    type="radio"
                    name="ig-text-position"
                    value={pos}
                    checked={textPosition === pos}
                    onChange={() => setTextPosition(pos)}
                    className="sr-only"
                  />
                  {TEXT_POSITION_LABELS[pos]}
                </label>
              ))}
            </div>
          </div>

          {/* 폰트 */}
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-zinc-500 dark:text-zinc-400">폰트</span>
            <div className="flex gap-1.5">
              {(["sans", "serif", "handwriting"] as FontStyle[]).map((s) => (
                <label key={s} className={pill(fontStyle === s)}>
                  <input
                    type="radio"
                    name="ig-font-style"
                    value={s}
                    checked={fontStyle === s}
                    onChange={() => setFontStyle(s)}
                    className="sr-only"
                  />
                  {FONT_LABELS[s]}
                </label>
              ))}
            </div>
          </div>

          {/* 텍스트 색상 */}
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-zinc-500 dark:text-zinc-400">텍스트 색상</span>
            <div className="flex flex-wrap items-center gap-2">
              {/* 레퍼런스 팔레트 스와치 */}
              {referenceColors?.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => setTextColor(color)}
                  title={color}
                  className={`h-6 w-6 shrink-0 rounded-full border-2 transition-transform ${
                    textColor.toLowerCase() === color.toLowerCase()
                      ? "scale-110 border-black dark:border-white"
                      : "border-black/20 dark:border-white/20"
                  }`}
                  style={{ backgroundColor: color }}
                />
              ))}
              {/* 직접 선택 */}
              <input
                type="color"
                value={textColor}
                onChange={(e) => setTextColor(e.target.value)}
                className="h-6 w-6 shrink-0 cursor-pointer rounded border border-black/20 bg-transparent p-0 dark:border-white/20"
                title="직접 선택"
              />
              <span className="text-xs text-zinc-400">{textColor}</span>
            </div>
            {referenceColors && referenceColors.length > 0 && (
              <p className="text-xs text-zinc-400">
                레퍼런스 이미지에서 추출한 색상 · API가 WCAG AA 대비로 자동 보정
              </p>
            )}
          </div>

          {/* 로고 업로드 */}
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              로고{" "}
              <span className="text-zinc-400">(선택, PNG 투명배경 권장, 최대 500KB)</span>
            </span>
            <div className="flex items-center gap-2">
              <label className="cursor-pointer rounded-lg border border-dashed border-black/[.2] px-3 py-1.5 text-xs text-zinc-600 hover:border-black/40 dark:border-white/[.2] dark:text-zinc-400">
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={handleLogoUpload}
                  className="sr-only"
                />
                {logoDataUrl ? "로고 변경" : "로고 업로드"}
              </label>
              {logoDataUrl && (
                <>
                  {/* 사용자가 직접 올린 임시 미리보기 — next/image 최적화 대상 아님 */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={logoDataUrl}
                    alt="로고"
                    className="h-8 w-auto rounded border border-black/[.12] object-contain dark:border-white/[.12]"
                  />
                  <button
                    type="button"
                    onClick={() => setLogoDataUrl(null)}
                    className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
                  >
                    제거
                  </button>
                </>
              )}
            </div>
            {logoError && <p className="text-xs text-red-600 dark:text-red-400">{logoError}</p>}

            {logoDataUrl && (
              <div className="flex flex-wrap gap-1.5">
                {(["top-left", "top-right", "bottom-left", "bottom-right"] as LogoPosition[]).map(
                  (pos) => (
                    <label key={pos} className={pill(logoPosition === pos)}>
                      <input
                        type="radio"
                        name="ig-logo-position"
                        value={pos}
                        checked={logoPosition === pos}
                        onChange={() => setLogoPosition(pos)}
                        className="sr-only"
                      />
                      {LOGO_POSITION_LABELS[pos]}
                    </label>
                  ),
                )}
              </div>
            )}
          </div>

          {/* 미리보기 생성 버튼 */}
          <button
            type="button"
            onClick={() => void generatePreview()}
            disabled={isGeneratingPreview}
            className="self-start rounded-lg bg-black px-5 py-2 text-sm font-medium text-white transition-opacity hover:opacity-80 disabled:opacity-40 dark:bg-white dark:text-black"
          >
            {isGeneratingPreview
              ? isCarousel
                ? `합성 중… (${imageDataUrls.length}장)`
                : "합성 중…"
              : isCarousel
                ? `미리보기 생성 (${imageDataUrls.length}장 카루셀)`
                : "미리보기 생성"}
          </button>

          {/* 미리보기 이미지 */}
          {previewUrls.length > 0 && (
            previewUrls.length === 1 ? (
              <div className="overflow-hidden rounded-lg border border-black/[.12] dark:border-white/[.12]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={previewUrls[0]} alt="인스타그램 오버레이 미리보기" className="w-full max-w-xs" />
              </div>
            ) : (
              /* 카루셀: 가로 스크롤 */
              <div className="flex gap-2 overflow-x-auto pb-2">
                {previewUrls.map((url, i) => (
                  <div key={i} className="flex shrink-0 flex-col gap-1">
                    <span className="text-xs text-zinc-400">이미지 {i + 1}</span>
                    <div className="overflow-hidden rounded-lg border border-black/[.12] dark:border-white/[.12]">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={url} alt={`슬라이드 ${i + 1} 미리보기`} className="h-40 w-auto" />
                    </div>
                  </div>
                ))}
              </div>
            )
          )}

          {previewError && (
            <p className="text-xs text-red-600 dark:text-red-400">{previewError}</p>
          )}
        </div>

        {/* ─ 오른쪽: 해시태그 + 캡션 + 버튼 ─ */}
        <div className="flex flex-1 flex-col gap-4">

          {/* 해시태그 추천 */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">해시태그 추천</span>
              <button
                type="button"
                onClick={() => void generateHashtags()}
                disabled={isGeneratingHashtags}
                className="text-xs text-zinc-500 underline underline-offset-2 hover:text-zinc-700 disabled:opacity-40 dark:text-zinc-400 dark:hover:text-zinc-200"
              >
                {isGeneratingHashtags ? "생성 중…" : hashtags ? "다시 추천" : "해시태그 추천"}
              </button>
            </div>

            {hashtagError && (
              <p className="text-xs text-red-600 dark:text-red-400">{hashtagError}</p>
            )}

            {!hashtags && !isGeneratingHashtags && (
              <p className="text-xs text-zinc-400 dark:text-zinc-500">
                &ldquo;해시태그 추천&rdquo; 버튼을 눌러 AI가 분석한 태그를 받아보세요.
              </p>
            )}

            {hashtags && (
              <div className="flex flex-col gap-3">
                {(["topic", "mood", "location", "misc"] as const).map((cat) => {
                  const tags = hashtags[cat];
                  if (tags.length === 0) return null;
                  return (
                    <div key={cat} className="flex flex-col gap-1">
                      <span className="text-xs text-zinc-400 dark:text-zinc-500">
                        {HASHTAG_CAT_LABELS[cat]}
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {tags.map((tag) => (
                          <label key={tag} className={pill(selectedTags.has(tag), true)}>
                            <input
                              type="checkbox"
                              checked={selectedTags.has(tag)}
                              onChange={() => toggleTag(tag)}
                              className="sr-only"
                            />
                            {tag}
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* 직접 입력 */}
            <div className="flex gap-2">
              <input
                type="text"
                value={customTag}
                onChange={(e) => setCustomTag(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); addCustomTag(); }
                }}
                placeholder="#직접입력"
                className="flex-1 rounded-lg border border-black/[.15] bg-transparent px-3 py-1.5 text-xs outline-none focus:border-black/40 dark:border-white/[.2] dark:focus:border-white/40"
              />
              <button
                type="button"
                onClick={addCustomTag}
                disabled={!customTag.trim()}
                className="rounded-lg border border-black/[.15] px-3 py-1.5 text-xs text-black transition-colors hover:bg-black hover:text-white disabled:opacity-40 dark:border-white/[.2] dark:text-zinc-50 dark:hover:bg-white dark:hover:text-black"
              >
                추가
              </button>
            </div>
          </div>

          {/* 캡션 미리보기 + 복사 */}
          {selectedTags.size > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-zinc-500 dark:text-zinc-400">캡션 미리보기</span>
              <div className="rounded-lg border border-black/[.12] bg-zinc-50 px-3 py-2 text-xs leading-relaxed text-zinc-700 dark:border-white/[.12] dark:bg-zinc-900 dark:text-zinc-300">
                {captionText}
              </div>
              <button
                type="button"
                onClick={() => void handleCopyCaption()}
                className="self-start text-xs text-zinc-500 underline underline-offset-2 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
              >
                {shareState === "copied" && !shareError ? "복사됨!" : "해시태그 복사"}
              </button>
            </div>
          )}

          {/* 다운로드 + 공유 버튼 */}
          {previewUrls.length > 0 && (
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={handleDownloadAll}
                className="rounded-lg border border-black/[.15] px-5 py-2.5 text-sm font-medium text-black transition-colors hover:bg-black hover:text-white dark:border-white/[.2] dark:text-zinc-50 dark:hover:bg-white dark:hover:text-black"
              >
                {previewUrls.length === 1 ? "PNG 다운로드" : `전체 다운로드 (${previewUrls.length}장)`}
              </button>

              <button
                type="button"
                onClick={() => void handleShare()}
                disabled={shareState === "sharing"}
                className="rounded-lg bg-gradient-to-r from-pink-500 to-purple-500 px-5 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {shareState === "sharing"
                  ? "공유 중…"
                  : isCarousel
                    ? `Instagram 카루셀 공유 (${previewUrls.length}장)`
                    : "Instagram 공유"}
              </button>

              <p className="text-xs text-zinc-400 dark:text-zinc-500">
                {isCarousel
                  ? `모바일(iOS/Android)에서 ${previewUrls.length}장을 카루셀로 Instagram에 공유합니다. 데스크톱에서는 전체 PNG 다운로드 + 해시태그 클립보드 복사로 대체됩니다.`
                  : "모바일(iOS/Android)에서는 Instagram 앱으로 바로 공유됩니다. 데스크톱에서는 PNG 다운로드 + 해시태그 클립보드 복사로 대체됩니다."}
              </p>

              {shareState === "copied" && !shareError && (
                <p className="text-xs text-green-600 dark:text-green-400">
                  {isCarousel
                    ? `PNG ${previewUrls.length}장 다운로드 완료 · 해시태그가 클립보드에 복사됐습니다.`
                    : "PNG 다운로드 완료 · 해시태그가 클립보드에 복사됐습니다."}
                </p>
              )}
              {shareState === "error" && shareError && (
                <p className="text-xs text-red-600 dark:text-red-400">{shareError}</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
