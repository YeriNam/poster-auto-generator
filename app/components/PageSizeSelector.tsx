"use client";

import { forwardRef, useImperativeHandle, useState } from "react";

export type PageSizeSelectorHandle = {
  // 커스텀 크기가 미완성이면 null 반환
  // isInstagram: 인스타그램 프리셋 선택 여부 (화면 4 탭 표시 결정에 사용)
  getSize: () => { widthMm: number; heightMm: number; isInstagram: boolean } | null;
};

// 인쇄 용지 프리셋 (mm 기준)
const PRINT_PRESETS = [
  { id: "a0", label: "A0", widthMm: 841, heightMm: 1189 },
  { id: "a3", label: "A3", widthMm: 297, heightMm: 420 },
  { id: "a4", label: "A4", widthMm: 210, heightMm: 297 },
  { id: "square", label: "정사각형", widthMm: 210, heightMm: 210 },
] as const;

// 인스타그램 프리셋 (1px = 25.4/96 mm 기준, 소수점 둘째 자리)
// 1080px = 285.75mm, 1350px = 357.19mm, 1920px = 508.00mm
const INSTAGRAM_PRESETS = [
  {
    id: "ig-square",
    label: "정사각형",
    sublabel: "1080 × 1080 px",
    widthMm: 285.75,
    heightMm: 285.75,
  },
  {
    id: "ig-portrait",
    label: "세로형",
    sublabel: "1080 × 1350 px",
    widthMm: 285.75,
    heightMm: 357.19,
  },
  {
    id: "ig-story",
    label: "스토리",
    sublabel: "1080 × 1920 px",
    widthMm: 285.75,
    heightMm: 508.0,
  },
] as const;

type PrintPresetId = (typeof PRINT_PRESETS)[number]["id"];
type InstagramPresetId = (typeof INSTAGRAM_PRESETS)[number]["id"];
type SelectedId = PrintPresetId | InstagramPresetId | "custom";

const INSTAGRAM_IDS = new Set<string>(INSTAGRAM_PRESETS.map((p) => p.id));

const PageSizeSelector = forwardRef<PageSizeSelectorHandle, object>(
  function PageSizeSelector(_, ref) {
    const [selected, setSelected] = useState<SelectedId>("a4");
    const [customWidth, setCustomWidth] = useState("");
    const [customHeight, setCustomHeight] = useState("");

    useImperativeHandle(ref, () => ({
      getSize() {
        if (selected === "custom") {
          const w = parseFloat(customWidth);
          const h = parseFloat(customHeight);
          if (!isFinite(w) || w <= 0 || !isFinite(h) || h <= 0) return null;
          return { widthMm: w, heightMm: h, isInstagram: false };
        }
        const printPreset = PRINT_PRESETS.find((s) => s.id === selected);
        if (printPreset) {
          return { widthMm: printPreset.widthMm, heightMm: printPreset.heightMm, isInstagram: false };
        }
        const igPreset = INSTAGRAM_PRESETS.find((s) => s.id === selected);
        if (igPreset) {
          return { widthMm: igPreset.widthMm, heightMm: igPreset.heightMm, isInstagram: true };
        }
        return null;
      },
    }));

    const optionClass = (isSelected: boolean) =>
      `cursor-pointer rounded-full border px-4 py-2 text-sm transition-colors ${
        isSelected
          ? "border-black bg-black text-white dark:border-white dark:bg-white dark:text-black"
          : "border-black/[.15] text-zinc-700 hover:border-black/40 dark:border-white/[.2] dark:text-zinc-300"
      }`;

    const igOptionClass = (isSelected: boolean) =>
      `cursor-pointer rounded-full border px-4 py-2 text-sm transition-colors ${
        isSelected
          ? "border-pink-600 bg-pink-600 text-white dark:border-pink-400 dark:bg-pink-400 dark:text-black"
          : "border-pink-300 text-pink-700 hover:border-pink-500 dark:border-pink-800 dark:text-pink-300"
      }`;

    return (
      <fieldset className="flex w-full max-w-md flex-col gap-4 text-left">
        <legend className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          페이지 크기 선택
        </legend>

        {/* 인쇄 용지 */}
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-zinc-400 dark:text-zinc-500">인쇄 크기</span>
          <div className="flex flex-wrap gap-2">
            {PRINT_PRESETS.map((size) => (
              <label key={size.id} className={optionClass(selected === size.id)}>
                <input
                  type="radio"
                  name="page-size"
                  value={size.id}
                  checked={selected === size.id}
                  onChange={() => setSelected(size.id)}
                  className="sr-only"
                />
                {size.label}
              </label>
            ))}
            <label className={optionClass(selected === "custom")}>
              <input
                type="radio"
                name="page-size"
                value="custom"
                checked={selected === "custom"}
                onChange={() => setSelected("custom")}
                className="sr-only"
              />
              커스텀
            </label>
          </div>
        </div>

        {/* 인스타그램 프리셋 */}
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-zinc-400 dark:text-zinc-500">인스타그램</span>
          <div className="flex flex-wrap gap-2">
            {INSTAGRAM_PRESETS.map((size) => (
              <label key={size.id} className={igOptionClass(selected === size.id)}>
                <input
                  type="radio"
                  name="page-size"
                  value={size.id}
                  checked={selected === size.id}
                  onChange={() => setSelected(size.id)}
                  className="sr-only"
                />
                <span>{size.label}</span>
                <span className="ml-1.5 text-xs opacity-70">{size.sublabel}</span>
              </label>
            ))}
          </div>
        </div>

        {/* 커스텀 입력 */}
        {selected === "custom" && (
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              inputMode="numeric"
              placeholder="가로(mm)"
              value={customWidth}
              onChange={(e) => setCustomWidth(e.target.value)}
              className="w-28 rounded border border-black/[.15] bg-transparent px-2 py-1 text-sm dark:border-white/[.2]"
            />
            <span className="text-zinc-500">×</span>
            <input
              type="number"
              min={1}
              inputMode="numeric"
              placeholder="세로(mm)"
              value={customHeight}
              onChange={(e) => setCustomHeight(e.target.value)}
              className="w-28 rounded border border-black/[.15] bg-transparent px-2 py-1 text-sm dark:border-white/[.2]"
            />
            <span className="text-zinc-500">mm</span>
          </div>
        )}

        {/* 인스타그램 프리셋 선택 시 안내 문구 */}
        {INSTAGRAM_IDS.has(selected) && (
          <p className="text-xs text-pink-600 dark:text-pink-400">
            인스타그램 최적 해상도(96dpi 기준)입니다. 생성 후 인스타그램 내보내기 탭에서 바로 업로드할 수 있습니다.
          </p>
        )}
      </fieldset>
    );
  },
);

export default PageSizeSelector;
// 외부에서 인스타그램 ID 목록을 참조할 수 있도록 export
export { INSTAGRAM_IDS };
