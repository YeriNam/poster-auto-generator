import OpenAI from "openai";
import { OPENAI_MODEL } from "./openaiConfig";
import type { TemplateId } from "./layoutCandidates";

export type AdjustmentResult = {
  templateId: TemplateId;
  changed: boolean;
};

type ImageDirection = "top" | "bottom" | "left" | "right" | "accent" | "unchanged";

// 방향 → 템플릿 매핑은 코드가 직접 결정한다(모델이 정하지 않는다). 처음엔 모델에게
// "요청과 가장 맞는 template id를 직접 골라라"라고 시켰더니, 특히 좌/우 두 템플릿
// (split-text-left ↔ split-image-left)을 자주 반대로 골랐다 — 이름끼리 비교하는 게
// 모델에게 더 어려운 판단이었던 것으로 보인다. 그래서 모델에게는 "방향 하나만 추출"하는
// 훨씬 단순한 판단만 맡기고, 방향이 정해지면 아래 표로 항상 같은 결과가 나오게 했다.
const DIRECTION_TO_TEMPLATE: Record<Exclude<ImageDirection, "unchanged">, TemplateId> = {
  top: "image-top", // 이미지가 위로
  bottom: "text-top", // 이미지가 아래로 = 글자가 위로
  left: "split-image-left", // 이미지가 왼쪽
  right: "split-text-left", // 이미지가 오른쪽
  accent: "image-accent", // 이미지를 작게, 글자를 중심으로
};

// PRD: "사용자가 텍스트로 요청하면(예: '이미지를 오른쪽으로 옮겨줘') OpenAI API가
// CSS Grid/Flexbox 좌표를 계산해 위치·크기를 조정한다." — 이 프로젝트에선 좌표를 AI가
// 직접 만들어내지 않는다. AI는 "사용자가 이미지를 어느 방향으로 옮기고 싶어하는지"만
// 판단하고, 실제 좌표는 항상 app/lib/layoutCandidates의 규칙 엔진이 계산하므로, 사용자
// 명령으로도 여백 24px·간격 16px·최소 12pt 규칙을 벗어난 좌표가 나올 수 없다.
export async function interpretAdjustmentCommand(
  command: string,
  currentTemplateId: TemplateId,
  apiKey: string,
): Promise<AdjustmentResult> {
  const client = new OpenAI({ apiKey });

  const completion = await client.chat.completions.create({
    model: OPENAI_MODEL,
    temperature: 0,
    messages: [
      {
        role: "system",
        content:
          "사용자가 포스터의 이미지 위치나 크기를 텍스트로 요청한다. 그 요청이 이미지를 " +
          '위("top")·아래("bottom")·왼쪽("left")·오른쪽("right")으로 옮겨달라는 것인지, ' +
          '아니면 이미지를 작게 곁들이듯("accent") 배치해달라는 것인지 판단해 direction ' +
          "필드에 그 영어 단어 하나만 담아라. 이미지 위치·크기와 무관한 요청(예: 색, 글자 " +
          '내용)이거나 방향을 판단할 수 없으면 direction을 "unchanged"로 한다. 이 6개 ' +
          "단어 외에는 절대 쓰지 마라.\n\n" +
          '다른 설명 없이 {"direction": "top"|"bottom"|"left"|"right"|"accent"|"unchanged"} ' +
          "형태의 JSON만 출력한다.",
      },
      { role: "user", content: command },
    ],
    response_format: { type: "json_object" },
  });

  const raw = completion.choices[0]?.message?.content ?? "{}";
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { templateId: currentTemplateId, changed: false };
  }

  const rawDirection = (parsed as { direction?: unknown }).direction;
  const direction: ImageDirection =
    typeof rawDirection === "string" && rawDirection in DIRECTION_TO_TEMPLATE
      ? (rawDirection as ImageDirection)
      : "unchanged";

  const templateId =
    direction === "unchanged" ? currentTemplateId : DIRECTION_TO_TEMPLATE[direction];

  return { templateId, changed: templateId !== currentTemplateId };
}
