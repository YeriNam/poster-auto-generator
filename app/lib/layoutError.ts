import type { LayoutBlock, LayoutResult } from "./layoutEngine";

export type LayoutErrorInfo = {
  hasError: boolean;
  message: string | null;
};

type ImageBlock = Extract<LayoutBlock, { type: "image" }>;

// PRD: "자동 배치가 실패하는 등 오류가 발생하면 원인을 설명하는 에러 메시지를 보여준다."
// DESIGN.md 화면2: 옵션 생성이 실패했을 때 이유와 함께 표시하고 "다시 만들기"로 안내한다.
// PLAN.md 7·8번이 계산해둔 overflowed·textTooSmall 플래그를 사람이 읽을 문장으로 바꾼다.
export function describeLayoutError(layout: LayoutResult): LayoutErrorInfo {
  const reasons: string[] = [];

  if (layout.overflowed) {
    reasons.push(
      "텍스트와 이미지가 선택한 페이지 크기보다 많아 한 페이지에 다 들어가지 않아요.",
    );
  }

  const tooSmallImages = layout.blocks.filter(
    (block): block is ImageBlock =>
      block.type === "image" && block.textTooSmall === true,
  );
  if (tooSmallImages.length > 0) {
    const numbers = tooSmallImages.map((block) => block.imageNumber).join(", ");
    reasons.push(
      `이미지 ${numbers}번 안의 글자가 이 페이지 크기에서는 12pt보다 작게 보여요.`,
    );
  }

  if (reasons.length === 0) {
    return { hasError: false, message: null };
  }

  const guidance =
    "텍스트를 줄이거나, 이미지를 줄이거나, 더 큰 페이지 크기를 선택한 뒤 다시 만들어보세요.";
  return { hasError: true, message: `${reasons.join(" ")} ${guidance}` };
}
