import type { LayoutImageInput } from "./layoutEngine";
import type { ReferenceStructureCategory } from "./referenceStructure";

// app/api/layout-candidates, app/api/recompute-layout, app/api/adjust-layout가 공통으로
// 받는 { text, images, pageWidthMm, pageHeightMm, referenceStructureId? } 요청 본문을
// 검증하고 파싱한다. 세 라우트에서 같은 검증 로직을 중복하지 않으려고 여기 모았다.
export type ParsedLayoutRequest = {
  text: string;
  images: LayoutImageInput[];
  pageWidthMm: number;
  pageHeightMm: number;
  referenceStructureId: ReferenceStructureCategory | null;
  // 인스타그램 프리셋 선택 여부 — true면 이미지 중심 템플릿에 점수 보너스 적용
  isInstagram: boolean;
};

const VALID_STRUCTURE_IDS: ReferenceStructureCategory[] = [
  "image-top",
  "text-top",
  "split-image-left",
  "split-text-left",
  "image-accent",
];

export function parseLayoutRequest(
  body: Record<string, unknown>,
): ParsedLayoutRequest | { error: string } {
  const { text, images, pageWidthMm, pageHeightMm, referenceStructureId, isInstagram } = body;

  if (
    typeof text !== "string" ||
    typeof pageWidthMm !== "number" ||
    typeof pageHeightMm !== "number" ||
    pageWidthMm <= 0 ||
    pageHeightMm <= 0 ||
    !Array.isArray(images)
  ) {
    return { error: "text, images(배열), pageWidthMm, pageHeightMm 값이 필요합니다." };
  }

  if (
    referenceStructureId !== undefined &&
    referenceStructureId !== null &&
    !VALID_STRUCTURE_IDS.includes(referenceStructureId as ReferenceStructureCategory)
  ) {
    return {
      error: `referenceStructureId는 ${VALID_STRUCTURE_IDS.join(", ")} 중 하나이거나 없어야 합니다.`,
    };
  }

  const parsedImages: LayoutImageInput[] = [];
  for (const item of images) {
    if (
      typeof item !== "object" ||
      item === null ||
      typeof (item as { number?: unknown }).number !== "number"
    ) {
      return { error: "images 배열의 각 항목은 { number } 형태여야 합니다." };
    }
    const { number, aspectRatio, requiredMinDisplayWidthPx } = item as {
      number: number;
      aspectRatio?: unknown;
      requiredMinDisplayWidthPx?: unknown;
    };
    parsedImages.push({
      number,
      aspectRatio: typeof aspectRatio === "number" ? aspectRatio : undefined,
      requiredMinDisplayWidthPx:
        typeof requiredMinDisplayWidthPx === "number"
          ? requiredMinDisplayWidthPx
          : undefined,
    });
  }

  return {
    text,
    images: parsedImages,
    pageWidthMm,
    pageHeightMm,
    referenceStructureId:
      (referenceStructureId as ReferenceStructureCategory | undefined) ?? null,
    isInstagram: isInstagram === true,
  };
}
