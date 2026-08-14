import OpenAI from "openai";
import { OPENAI_MODEL } from "./openaiConfig";
import { FONT_CANDIDATES } from "./fontCandidates";

export type FontAnalysisResult = {
  hasVisibleFont: boolean;
  selectedFontId: string | null;
};

// PRD: 레퍼런스 이미지의 폰트 분위기를 OpenAI Vision으로 분석해, 미리 정한 후보 폰트 목록
// 중 가장 비슷한 폰트를 선택한다. 모델이 실제 존재하지 않는 폰트를 지어내지 않도록,
// 후보 id와 분위기 설명을 프롬프트에 그대로 나열해 그중 하나만 고르게 한다.
export async function analyzeReferenceFont(
  imageDataUrl: string,
  apiKey: string,
): Promise<FontAnalysisResult> {
  const client = new OpenAI({ apiKey });

  const candidateList = FONT_CANDIDATES.map(
    (c) => `- id: "${c.id}" — ${c.mood}`,
  ).join("\n");

  const completion = await client.chat.completions.create({
    model: OPENAI_MODEL,
    messages: [
      {
        role: "system",
        content:
          "너는 이미지 속 글자의 폰트 분위기를 살펴보는 도우미다. 이미지 안에 폰트 느낌을 " +
          "판단할 만한 글자가 보이면, 아래 후보 목록 중 그 느낌과 가장 비슷한 것을 " +
          "정확히 하나 골라 id를 selectedFontId에 담아라. 글자가 없거나 폰트 느낌을 " +
          "판단하기 어려우면 selectedFontId를 null로 한다. 목록에 없는 id를 만들어내지 " +
          "마라.\n\n후보 목록:\n" +
          candidateList +
          '\n\n다른 설명 없이 {"selectedFontId": string|null} 형태의 JSON만 출력한다.',
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
    return { hasVisibleFont: false, selectedFontId: null };
  }

  const rawId = (parsed as { selectedFontId?: unknown }).selectedFontId;
  const matched =
    typeof rawId === "string"
      ? FONT_CANDIDATES.find((c) => c.id === rawId)
      : undefined;

  return {
    hasVisibleFont: matched !== undefined,
    selectedFontId: matched?.id ?? null,
  };
}
