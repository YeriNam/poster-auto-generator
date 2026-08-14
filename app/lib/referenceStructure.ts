import OpenAI from "openai";
import { OPENAI_MODEL } from "./openaiConfig";

// PRD: "레퍼런스의 이미지·텍스트 배치 구조(예: 이미지가 상단/좌측/중앙 등) 유사도를
// 반영해 가장 비슷한 레이아웃이 3개 옵션에 포함되도록 한다."
// PLAN.md 10번 템플릿 중 시각적으로 구분 가능한 5종만 후보로 둔다(순서만 바뀌는
// "sequential"은 사진만 봐서는 판단할 수 없는 구조라 제외).
const STRUCTURE_DESCRIPTIONS = {
  "image-top": "사진/이미지가 위쪽에 있고 글자는 아래쪽에 몰려 있다",
  "text-top": "글자가 위쪽에 있고 사진/이미지는 아래쪽에 몰려 있다",
  "split-image-left": "화면이 좌우로 나뉘어 왼쪽엔 사진/이미지, 오른쪽엔 글자가 있다",
  "split-text-left": "화면이 좌우로 나뉘어 왼쪽엔 글자, 오른쪽엔 사진/이미지가 있다",
  "image-accent": "글자가 화면 대부분을 차지하고 사진/이미지는 한쪽에 작게 곁들여져 있다",
} as const;

export type ReferenceStructureCategory = keyof typeof STRUCTURE_DESCRIPTIONS;

// PRD API 예산: "레퍼런스 Vision 분석 최대 1회"는 폰트 분석(PLAN.md 13번)이 이미 쓰고 있어,
// 이 구조 분석은 별도 호출 1회를 추가로 쓴다. 생성 1건당 총 10회 한도의 "여유분" 안에서 처리한다.
export async function analyzeReferenceStructure(
  imageDataUrl: string,
  apiKey: string,
): Promise<ReferenceStructureCategory | null> {
  const client = new OpenAI({ apiKey });

  const categoryList = (
    Object.entries(STRUCTURE_DESCRIPTIONS) as [ReferenceStructureCategory, string][]
  )
    .map(([id, desc]) => `- id: "${id}" — ${desc}`)
    .join("\n");

  const completion = await client.chat.completions.create({
    model: OPENAI_MODEL,
    temperature: 0, // 분류 작업이라 매번 같은 이미지엔 같은 답이 나오도록 무작위성을 최소화한다
    messages: [
      {
        role: "system",
        content:
          "너는 이미지 안에서 사진/이미지 요소와 글자(텍스트) 요소가 서로 어떻게 배치되어 " +
          "있는지 살펴보는 도우미다. 먼저 observation 필드에 이미지의 위/아래/왼쪽/오른쪽 " +
          "중 어디에 사진이 있고 어디에 글자가 있는지 한 문장으로 직접 관찰한 내용을 적어라. " +
          "그 다음 그 관찰을 바탕으로 아래 후보 목록 중 가장 비슷한 것을 정확히 하나 골라 " +
          "structureId에 담아라. 사진/이미지 요소와 글자 요소가 뚜렷이 구분되지 않거나 " +
          "판단하기 어려우면 structureId를 null로 한다. 목록에 없는 id를 만들어내지 마라.\n\n" +
          "후보 목록:\n" +
          categoryList +
          '\n\n다른 설명 없이 {"observation": string, "structureId": string|null} 형태의 JSON만 출력한다.',
      },
      {
        role: "user",
        content: [{ type: "image_url", image_url: { url: imageDataUrl } }],
      },
    ],
    response_format: { type: "json_object" },
  });

  const raw = completion.choices[0]?.message?.content ?? "{}";
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  const rawId = (parsed as { structureId?: unknown }).structureId;
  return typeof rawId === "string" && rawId in STRUCTURE_DESCRIPTIONS
    ? (rawId as ReferenceStructureCategory)
    : null;
}
