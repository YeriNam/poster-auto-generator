import {
  AVG_CHAR_WIDTH_RATIO,
  GAP_PX,
  LINE_HEIGHT_RATIO,
  MARGIN_PX,
  MIN_FONT_PX,
  mmToPx,
  pxToMm,
} from "./pageMetrics";

export type LayoutImageInput = {
  number: number; // 업로드 순서 번호. 텍스트 안 [이미지N] 표시와 매칭된다
  aspectRatio?: number; // 가로/세로 비율. 모르면 기본 4:3 사용
  // PLAN.md 8번(app/api/analyze-image-text)이 미리 계산해 넘겨주는 값.
  // 이미지 안 텍스트가 12pt 이상으로 보이려면 필요한 최소 표시 폭(px)
  requiredMinDisplayWidthPx?: number;
};

export type Box = { x: number; y: number; width: number; height: number };

export type LayoutBlock =
  | { type: "text"; content: string; px: Box; mm: Box }
  | {
      type: "image";
      imageNumber: number;
      px: Box;
      mm: Box;
      // true면 이 배치 폭으로는 이미지 속 텍스트가 12pt 미만으로 보인다는 뜻이다.
      // 실제 사용자 안내는 PLAN.md 9번(app/lib/layoutError)이 처리한다.
      textTooSmall?: boolean;
    };

export type LayoutResult = {
  page: { widthPx: number; heightPx: number; widthMm: number; heightMm: number };
  margin: { px: number; mm: number };
  gap: { px: number; mm: number };
  blocks: LayoutBlock[];
  overflowed: boolean;
};

export const DEFAULT_ASPECT_RATIO = 4 / 3;

// PRD: 텍스트 안 [이미지1] 같은 표시로 이미지 위치를 앵커링한다. 매칭되는 이미지가 없는
// 번호는 오류 처리 없이 문자 그대로 남긴다(=앵커로 취급하지 않고 일반 텍스트로 둔다).
const MARKER_PATTERN = /\[이미지(\d+)\]/g;

export type Segment =
  | { type: "text"; content: string }
  | { type: "image"; imageNumber: number };

function splitTextByMarkers(text: string, validNumbers: Set<number>): Segment[] {
  const segments: Segment[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(MARKER_PATTERN)) {
    const number = Number(match[1]);
    if (!validNumbers.has(number)) continue; // 없는 번호는 건너뛰어 다음 텍스트 조각에 그대로 포함시킨다

    const start = match.index ?? 0;
    if (start > lastIndex) {
      segments.push({ type: "text", content: text.slice(lastIndex, start) });
    }
    segments.push({ type: "image", imageNumber: number });
    lastIndex = start + match[0].length;
  }
  if (lastIndex < text.length) {
    segments.push({ type: "text", content: text.slice(lastIndex) });
  }
  return segments;
}

// 텍스트를 [이미지N] 기준으로 조각내 앵커를 반영하고, 표시가 없는 나머지 이미지는 뒤에
// 이어 붙인 "기본 순서"를 만든다. PLAN.md 10번의 여러 템플릿도 전부 이 순서에서 출발해,
// 앵커된 이미지의 상대적 위치(텍스트 어디쯤에서 나오는지)는 항상 유지한다.
export function buildOrderedSegments(
  text: string,
  images: LayoutImageInput[],
): Segment[] {
  const validNumbers = new Set(images.map((img) => img.number));
  const segments = splitTextByMarkers(text, validNumbers);

  const anchoredNumbers = new Set(
    segments
      .filter((s): s is Extract<Segment, { type: "image" }> => s.type === "image")
      .map((s) => s.imageNumber),
  );
  for (const img of images) {
    if (!anchoredNumbers.has(img.number)) {
      segments.push({ type: "image", imageNumber: img.number });
    }
  }
  return segments;
}

export function estimateTextHeightPx(content: string, widthPx: number): number {
  const trimmed = content.trim();
  if (trimmed.length === 0) return 0;
  const charWidthPx = MIN_FONT_PX * AVG_CHAR_WIDTH_RATIO;
  const lineHeightPx = MIN_FONT_PX * LINE_HEIGHT_RATIO;
  const charsPerLine = Math.max(1, Math.floor(widthPx / charWidthPx));
  const lineCount = Math.max(1, Math.ceil(trimmed.length / charsPerLine));
  return lineCount * lineHeightPx;
}

export function toBoxes(
  x: number,
  y: number,
  width: number,
  height: number,
): { px: Box; mm: Box } {
  return {
    px: { x, y, width, height },
    mm: { x: pxToMm(x), y: pxToMm(y), width: pxToMm(width), height: pxToMm(height) },
  };
}

// 세로 1단(칸) 안에 segments를 여백 없이 흐르듯 배치하는 공용 함수.
// PLAN.md 7번의 기본 배치와, PLAN.md 10번의 여러 템플릿(1단·2단 분할)이 모두 이 함수를 쓴다.
export function layoutColumn(
  segments: Segment[],
  imageMap: Map<number, LayoutImageInput>,
  columnX: number,
  columnWidthPx: number,
): { blocks: LayoutBlock[]; usedHeightPx: number } {
  const blocks: LayoutBlock[] = [];
  let cursorY = MARGIN_PX;

  for (const segment of segments) {
    if (segment.type === "text") {
      const heightPx = estimateTextHeightPx(segment.content, columnWidthPx);
      if (heightPx === 0) continue; // 빈 텍스트 구간은 자리를 차지하지 않는다
      if (blocks.length > 0) cursorY += GAP_PX;
      blocks.push({
        type: "text",
        content: segment.content.trim(),
        ...toBoxes(columnX, cursorY, columnWidthPx, heightPx),
      });
      cursorY += heightPx;
    } else {
      const imageInput = imageMap.get(segment.imageNumber);
      const aspectRatio = imageInput?.aspectRatio ?? DEFAULT_ASPECT_RATIO;
      const heightPx = columnWidthPx / aspectRatio;
      if (blocks.length > 0) cursorY += GAP_PX;
      // 이 칸의 폭으로 배치해도 필요한 최소 폭보다 작다면, 이 칸 크기로는 12pt를 못 채운다는 뜻이다.
      const textTooSmall =
        imageInput?.requiredMinDisplayWidthPx !== undefined &&
        imageInput.requiredMinDisplayWidthPx > columnWidthPx;
      blocks.push({
        type: "image",
        imageNumber: segment.imageNumber,
        ...toBoxes(columnX, cursorY, columnWidthPx, heightPx),
        ...(textTooSmall ? { textTooSmall: true } : {}),
      });
      cursorY += heightPx;
    }
  }

  return { blocks, usedHeightPx: cursorY - MARGIN_PX };
}

// PLAN.md 7번: 여백 24px·간격 16px·그리드(1단 정렬) 규칙으로 텍스트·이미지를 세로로 배치하는
// 기본 엔진이다. 여러 템플릿으로 후보를 만들고 점수를 매기는 일은 PLAN.md 10번(app/lib/layoutCandidates)의 몫이다.
export function computeLayout({
  text,
  images,
  pageWidthMm,
  pageHeightMm,
}: {
  text: string;
  images: LayoutImageInput[];
  pageWidthMm: number;
  pageHeightMm: number;
}): LayoutResult {
  const pageWidthPx = mmToPx(pageWidthMm);
  const pageHeightPx = mmToPx(pageHeightMm);
  const usableWidthPx = Math.max(0, pageWidthPx - MARGIN_PX * 2);
  const usableHeightPx = Math.max(0, pageHeightPx - MARGIN_PX * 2);

  const imageMap = new Map(images.map((img) => [img.number, img]));
  const segments = buildOrderedSegments(text, images);
  const { blocks, usedHeightPx } = layoutColumn(
    segments,
    imageMap,
    MARGIN_PX,
    usableWidthPx,
  );

  return {
    page: { widthPx: pageWidthPx, heightPx: pageHeightPx, widthMm: pageWidthMm, heightMm: pageHeightMm },
    margin: { px: MARGIN_PX, mm: pxToMm(MARGIN_PX) },
    gap: { px: GAP_PX, mm: pxToMm(GAP_PX) },
    blocks,
    overflowed: usedHeightPx > usableHeightPx,
  };
}
