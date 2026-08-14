import { GAP_PX, MARGIN_PX, mmToPx, pxToMm } from "./pageMetrics";
import {
  DEFAULT_ASPECT_RATIO,
  buildOrderedSegments,
  estimateTextHeightPx,
  layoutColumn,
  toBoxes,
  type LayoutBlock,
  type LayoutImageInput,
  type LayoutResult,
  type Segment,
} from "./layoutEngine";
import { describeLayoutError, type LayoutErrorInfo } from "./layoutError";
import type { ReferenceStructureCategory } from "./referenceStructure";

// PRD 5장: "미리 정의한 템플릿(예: 상단 이미지+하단 텍스트, 좌우 분할, 텍스트 중심+이미지
// 보조 등 5~6종)을 기반으로 여러 개 만들고 ... 점수가 높은 서로 다른 3개를 옵션으로 제시한다."
export type TemplateId =
  | "sequential"
  | "image-top"
  | "text-top"
  | "split-text-left"
  | "split-image-left"
  | "image-accent";

export const TEMPLATE_LABELS: Record<TemplateId, string> = {
  sequential: "텍스트 순서 그대로",
  "image-top": "상단 이미지 + 하단 텍스트",
  "text-top": "상단 텍스트 + 하단 이미지",
  "split-text-left": "좌우 분할 (텍스트 왼쪽 · 이미지 오른쪽)",
  "split-image-left": "좌우 분할 (이미지 왼쪽 · 텍스트 오른쪽)",
  "image-accent": "텍스트 중심 + 이미지 보조",
};

const ALL_TEMPLATES: TemplateId[] = [
  "sequential",
  "image-top",
  "text-top",
  "split-text-left",
  "split-image-left",
  "image-accent",
];

// "텍스트 중심 + 이미지 보조" 템플릿에서 이미지가 차지하는 폭 비율(나머지는 텍스트가 전체 폭 사용)
const ACCENT_WIDTH_RATIO = 0.6;

export type LayoutCandidate = {
  templateId: TemplateId;
  label: string;
  layout: LayoutResult;
  score: number;
} & LayoutErrorInfo;

function isImageSegment(s: Segment): s is Extract<Segment, { type: "image" }> {
  return s.type === "image";
}
function isTextSegment(s: Segment): s is Extract<Segment, { type: "text" }> {
  return s.type === "text";
}

type PageBox = LayoutResult["page"];

function wrapResult(
  pageBox: PageBox,
  usableHeightPx: number,
  blocks: LayoutBlock[],
  usedHeightPx: number,
): LayoutResult {
  return {
    page: pageBox,
    margin: { px: MARGIN_PX, mm: pxToMm(MARGIN_PX) },
    gap: { px: GAP_PX, mm: pxToMm(GAP_PX) },
    blocks,
    overflowed: usedHeightPx > usableHeightPx,
  };
}

// sequential / image-top / text-top: 순서만 바꿔서 1단(전체 폭)에 배치한다.
// 앵커된 이미지의 상대적 순서(텍스트 안 어디쯤에서 나오는지)는 always 유지된다 —
// image-top/text-top은 그 순서를 지킨 채로 이미지 묶음·텍스트 묶음의 앞뒤만 바꿀 뿐이다.
function buildReorderedLayout(
  segments: Segment[],
  imageMap: Map<number, LayoutImageInput>,
  templateId: "sequential" | "image-top" | "text-top",
  usableWidthPx: number,
  usableHeightPx: number,
  pageBox: PageBox,
): LayoutResult {
  const ordered =
    templateId === "image-top"
      ? [...segments.filter(isImageSegment), ...segments.filter(isTextSegment)]
      : templateId === "text-top"
        ? [...segments.filter(isTextSegment), ...segments.filter(isImageSegment)]
        : segments;

  const { blocks, usedHeightPx } = layoutColumn(ordered, imageMap, MARGIN_PX, usableWidthPx);
  return wrapResult(pageBox, usableHeightPx, blocks, usedHeightPx);
}

// split-text-left / split-image-left: 칸을 둘로 나눠 텍스트와 이미지를 각각 독립적으로 흘린다.
function buildSplitLayout(
  segments: Segment[],
  imageMap: Map<number, LayoutImageInput>,
  imageColumnSide: "left" | "right",
  usableWidthPx: number,
  usableHeightPx: number,
  pageBox: PageBox,
): LayoutResult {
  const columnWidthPx = (usableWidthPx - GAP_PX) / 2;
  const leftX = MARGIN_PX;
  const rightX = MARGIN_PX + columnWidthPx + GAP_PX;
  const imageColumnX = imageColumnSide === "left" ? leftX : rightX;
  const textColumnX = imageColumnSide === "left" ? rightX : leftX;

  const imageResult = layoutColumn(
    segments.filter(isImageSegment),
    imageMap,
    imageColumnX,
    columnWidthPx,
  );
  const textResult = layoutColumn(
    segments.filter(isTextSegment),
    imageMap,
    textColumnX,
    columnWidthPx,
  );

  return wrapResult(
    pageBox,
    usableHeightPx,
    [...imageResult.blocks, ...textResult.blocks],
    Math.max(imageResult.usedHeightPx, textResult.usedHeightPx),
  );
}

// image-accent: 텍스트는 전체 폭으로 흐르고, 이미지만 폭을 줄여 오른쪽에 "보조 요소"처럼 배치한다.
// 폭이 텍스트/이미지마다 달라 layoutColumn(고정 폭)을 그대로 못 쓰고 직접 순회한다.
function buildAccentLayout(
  segments: Segment[],
  imageMap: Map<number, LayoutImageInput>,
  usableWidthPx: number,
  usableHeightPx: number,
  pageBox: PageBox,
): LayoutResult {
  const accentWidthPx = usableWidthPx * ACCENT_WIDTH_RATIO;
  const accentX = MARGIN_PX + (usableWidthPx - accentWidthPx); // 오른쪽 정렬

  const blocks: LayoutBlock[] = [];
  let cursorY = MARGIN_PX;

  for (const segment of segments) {
    if (segment.type === "text") {
      const heightPx = estimateTextHeightPx(segment.content, usableWidthPx);
      if (heightPx === 0) continue;
      if (blocks.length > 0) cursorY += GAP_PX;
      blocks.push({
        type: "text",
        content: segment.content.trim(),
        ...toBoxes(MARGIN_PX, cursorY, usableWidthPx, heightPx),
      });
      cursorY += heightPx;
    } else {
      const imageInput = imageMap.get(segment.imageNumber);
      const aspectRatio = imageInput?.aspectRatio ?? DEFAULT_ASPECT_RATIO;
      const heightPx = accentWidthPx / aspectRatio;
      if (blocks.length > 0) cursorY += GAP_PX;
      const textTooSmall =
        imageInput?.requiredMinDisplayWidthPx !== undefined &&
        imageInput.requiredMinDisplayWidthPx > accentWidthPx;
      blocks.push({
        type: "image",
        imageNumber: segment.imageNumber,
        ...toBoxes(accentX, cursorY, accentWidthPx, heightPx),
        ...(textTooSmall ? { textTooSmall: true } : {}),
      });
      cursorY += heightPx;
    }
  }

  return wrapResult(pageBox, usableHeightPx, blocks, cursorY - MARGIN_PX);
}

function buildTemplateLayout(
  templateId: TemplateId,
  segments: Segment[],
  imageMap: Map<number, LayoutImageInput>,
  usableWidthPx: number,
  usableHeightPx: number,
  pageBox: PageBox,
): LayoutResult {
  switch (templateId) {
    case "sequential":
    case "image-top":
    case "text-top":
      return buildReorderedLayout(segments, imageMap, templateId, usableWidthPx, usableHeightPx, pageBox);
    case "split-text-left":
      return buildSplitLayout(segments, imageMap, "right", usableWidthPx, usableHeightPx, pageBox);
    case "split-image-left":
      return buildSplitLayout(segments, imageMap, "left", usableWidthPx, usableHeightPx, pageBox);
    case "image-accent":
      return buildAccentLayout(segments, imageMap, usableWidthPx, usableHeightPx, pageBox);
  }
}

// PRD: 규칙 기반 점수 = ① 여백·간격 규칙 준수 여부 + ② 텍스트 밀도와 여백의 균형
// + ③ 레퍼런스가 있으면 레퍼런스와의 레이아웃 구조 유사도
// + ④ 인스타그램 모드에서는 이미지 중심 템플릿 보너스 추가
// OpenAI를 쓰지 않는 규칙 기반 계산이라 API 호출 횟수에 포함되지 않는다.
function scoreLayout(
  templateId: TemplateId,
  layout: LayoutResult,
  usableHeightPx: number,
  referenceStructureId: ReferenceStructureCategory | null,
  isInstagram: boolean,
): number {
  let score = 0;

  // ① 여백·간격 규칙 준수 여부 (최대 40점) — 인스타그램도 동일하게 적용
  if (!layout.overflowed) score += 25;
  const hasTextTooSmall = layout.blocks.some(
    (block) => block.type === "image" && block.textTooSmall === true,
  );
  if (!hasTextTooSmall) score += 15;

  // ② 텍스트 밀도-여백 균형 (최대 30점)
  // 인스타그램: 이미지가 프레임을 꽉 채우는 게 선호되므로 이상적인 채움 비율을 0.85로 상향
  // 인쇄 출력: 여백이 충분한 0.75가 이상적
  const usedHeightPx =
    layout.blocks.reduce((max, block) => Math.max(max, block.px.y + block.px.height), 0) -
    MARGIN_PX;
  const fillRatio = usableHeightPx > 0 ? usedHeightPx / usableHeightPx : 0;
  const idealFill = isInstagram ? 0.85 : 0.75;
  const closeness = Math.max(0, 1 - Math.abs(fillRatio - idealFill) / idealFill);
  score += closeness * 30;

  // ③ 레퍼런스 구조 유사도 (최대 30점): 레퍼런스가 없거나 판단 불가면 아무도 못 받는다.
  // PRD 5장 2): 가독성(최소 12pt)이 레퍼런스 일치보다 항상 우선하므로,
  // hasTextTooSmall인 후보는 보너스를 받지 못한다.
  if (!hasTextTooSmall && referenceStructureId !== null && templateId === referenceStructureId) {
    score += 30;
  }

  // ④ 인스타그램 전용: 이미지 중심 템플릿 보너스 (최대 20점)
  // 이미지가 시각적으로 주도하는 구조일수록 인스타그램에서 더 강한 임팩트를 줌.
  // "이미지 상단 히어로" → "좌측 이미지 분할" → "우측 이미지" → "순서 그대로" → "이미지 보조" → "텍스트 상단" 순
  if (isInstagram) {
    const IG_BONUS: Record<TemplateId, number> = {
      "image-top":        20, // 히어로 이미지 + 하단 텍스트 = 가장 Instagram-native
      "split-image-left": 15, // 이미지가 왼쪽 절반을 차지
      "split-text-left":  8,  // 이미지가 오른쪽, 무난
      "sequential":       5,  // 원본 순서 그대로, 중립
      "image-accent":     3,  // 이미지가 보조 역할, 텍스트 중심 → 덜 Instagram-ish
      "text-top":         0,  // 텍스트가 먼저 → 인스타에서 가장 임팩트 약함
    };
    score += IG_BONUS[templateId];
  }

  return Math.round(score * 100) / 100;
}

type GenerateInput = {
  text: string;
  images: LayoutImageInput[];
  pageWidthMm: number;
  pageHeightMm: number;
  referenceStructureId?: ReferenceStructureCategory | null;
  isInstagram?: boolean;
};

function setupGeneration(input: GenerateInput) {
  const pageWidthPx = mmToPx(input.pageWidthMm);
  const pageHeightPx = mmToPx(input.pageHeightMm);
  const usableWidthPx = Math.max(0, pageWidthPx - MARGIN_PX * 2);
  const usableHeightPx = Math.max(0, pageHeightPx - MARGIN_PX * 2);
  const pageBox: PageBox = {
    widthPx: pageWidthPx,
    heightPx: pageHeightPx,
    widthMm: input.pageWidthMm,
    heightMm: input.pageHeightMm,
  };
  const imageMap = new Map(input.images.map((img) => [img.number, img]));
  const baseSegments = buildOrderedSegments(input.text, input.images);
  return { usableWidthPx, usableHeightPx, pageBox, imageMap, baseSegments };
}

function buildCandidate(
  templateId: TemplateId,
  setup: ReturnType<typeof setupGeneration>,
  referenceStructureId: ReferenceStructureCategory | null,
  isInstagram: boolean,
): LayoutCandidate {
  const layout = buildTemplateLayout(
    templateId,
    setup.baseSegments,
    setup.imageMap,
    setup.usableWidthPx,
    setup.usableHeightPx,
    setup.pageBox,
  );
  const score = scoreLayout(templateId, layout, setup.usableHeightPx, referenceStructureId, isInstagram);
  return { templateId, label: TEMPLATE_LABELS[templateId], layout, score, ...describeLayoutError(layout) };
}

// PLAN.md 10번: 템플릿마다 후보를 만들고 점수를 매겨, 점수 높은 서로 다른 3개를 고른다.
// referenceStructureId는 PLAN.md 14번(app/lib/referenceStructure)이 레퍼런스 이미지를
// 분석해 미리 구해둔 값이다. 레퍼런스가 없으면 null을 넘기면 된다.
export function generateLayoutCandidates(input: GenerateInput): LayoutCandidate[] {
  const setup = setupGeneration(input);
  const isInstagram = input.isInstagram ?? false;
  // 인스타그램 모드: 이미지 없이 텍스트만 순서대로 나열하는 sequential 템플릿은 제외
  const templates = isInstagram
    ? ALL_TEMPLATES.filter((t) => t !== "sequential")
    : ALL_TEMPLATES;
  const candidates = templates.map((templateId) =>
    buildCandidate(templateId, setup, input.referenceStructureId ?? null, isInstagram),
  );
  return candidates.sort((a, b) => b.score - a.score).slice(0, 3);
}

// PLAN.md 16번: 사용자가 화면3에서 이미 고른 템플릿 하나만 다시 계산한다(텍스트를 고쳤거나,
// 텍스트 명령으로 배치를 바꿨을 때). generateLayoutCandidates와 같은 규칙 엔진·점수 계산을
// 그대로 재사용하므로, 여백 24px·간격 16px·최소 12pt 규칙이 여기서도 똑같이 적용된다.
export function computeLayoutForTemplate(
  templateId: TemplateId,
  input: GenerateInput,
): LayoutCandidate {
  const setup = setupGeneration(input);
  return buildCandidate(templateId, setup, input.referenceStructureId ?? null, input.isInstagram ?? false);
}
