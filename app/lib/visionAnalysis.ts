import OpenAI from "openai";
import { OPENAI_MODEL } from "./openaiConfig";

export type ImageTextAnalysis = {
  hasText: boolean;
  // 이미지 세로 길이 대비, 가장 큰 텍스트의 높이 비율 (0~1). 텍스트가 없으면 null
  textHeightRatio: number | null;
};

// PRD: 이미지 안 텍스트 포함 여부와 원본 크기를 OpenAI Vision으로 추정한다.
// 절대 px 대신 "이미지 세로 길이 대비 비율"로 물어보고, 실제 해상도는 우리가 이미 아는
// nativeHeightPx 값과 곱해 계산한다(모델은 원본 해상도를 정확히 알 수 없기 때문).
export async function analyzeImageText(
  imageDataUrl: string,
  apiKey: string,
): Promise<ImageTextAnalysis> {
  const client = new OpenAI({ apiKey });

  const completion = await client.chat.completions.create({
    model: OPENAI_MODEL,
    messages: [
      {
        role: "system",
        content:
          "너는 이미지 안에 글자가 있는지 살펴보는 도우미다. 이미지에 읽을 수 있는 텍스트가 " +
          "있으면 hasText를 true로 하고, 그 텍스트 중 가장 큰 글자 기준으로 " +
          "'글자 높이 ÷ 이미지 전체 세로 길이' 비율을 0과 1 사이 숫자로 추정해 " +
          "textHeightRatio에 담아라. 텍스트가 없으면 hasText는 false, textHeightRatio는 " +
          'null로 한다. 다른 설명 없이 {"hasText": boolean, "textHeightRatio": number|null} ' +
          "형태의 JSON만 출력한다.",
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
    return { hasText: false, textHeightRatio: null };
  }

  const record = parsed as { hasText?: unknown; textHeightRatio?: unknown };
  const hasTextField = record.hasText === true;
  const ratio = record.textHeightRatio;
  const textHeightRatio =
    hasTextField && typeof ratio === "number" && ratio > 0 && ratio <= 1
      ? ratio
      : null;

  return { hasText: hasTextField && textHeightRatio !== null, textHeightRatio };
}
