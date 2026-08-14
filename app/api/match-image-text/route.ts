import OpenAI from "openai";
import { OPENAI_MODEL } from "@/app/lib/openaiConfig";
import { jsonNoStore } from "@/app/lib/httpResponse";

// 이미지 1장과 포스터 전체 텍스트를 Vision에 넘겨,
// 이미지 앞뒤 문맥까지 고려해 가장 관련 있는 텍스트 구절을 선택한다.
// 관련 텍스트가 없으면 빈 문자열을 반환한다.
async function matchTextForImage(
  imageDataUrl: string,
  posterText: string,
  apiKey: string,
): Promise<string> {
  const client = new OpenAI({ apiKey });

  const completion = await client.chat.completions.create({
    model: OPENAI_MODEL,
    messages: [
      {
        role: "system",
        content:
          "너는 이미지와 포스터 텍스트를 보고, 이미지에 가장 어울리는 텍스트 구절을 골라주는 도우미다.\n" +
          "\n규칙:\n" +
          "- 포스터 텍스트에서 이 이미지 내용을 가장 잘 설명하거나 보완하는 구절을 골라라.\n" +
          "- [이미지N] 마커 앞뒤에 있는 텍스트를 모두 고려한다.\n" +
          "- 관련 텍스트가 있으면 원문 그대로 150자 이내로 반환한다.\n" +
          "- 관련 텍스트가 전혀 없으면 빈 문자열만 반환한다.\n" +
          "- 설명·이유·따옴표 없이, 해당 구절(또는 빈 문자열)만 반환한다.",
      },
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: imageDataUrl } },
          { type: "text", text: `포스터 텍스트:\n${posterText}` },
        ],
      },
    ],
    max_tokens: 200,
  });

  return (completion.choices[0]?.message?.content ?? "").trim();
}

export async function POST(request: Request) {
  let body: { images?: unknown; posterText?: unknown };
  try {
    body = await request.json();
  } catch {
    return jsonNoStore({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }

  const { images, posterText } = body;

  if (!Array.isArray(images) || images.length === 0) {
    return jsonNoStore({ error: "images 배열이 필요합니다." }, { status: 400 });
  }
  if (typeof posterText !== "string" || posterText.trim() === "") {
    return jsonNoStore({ error: "posterText가 필요합니다." }, { status: 400 });
  }
  if (images.length > 5) {
    return jsonNoStore({ error: "이미지는 최대 5장까지 분석할 수 있습니다." }, { status: 400 });
  }

  const dataUrls: string[] = [];
  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    if (typeof img !== "string" || !img.startsWith("data:image/")) {
      return jsonNoStore(
        { error: `images[${i}]는 data: URL 문자열이어야 합니다.` },
        { status: 400 },
      );
    }
    dataUrls.push(img);
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return jsonNoStore(
      { error: "OpenAI API 키가 설정되어 있지 않습니다. .env의 OPENAI_API_KEY를 확인해주세요." },
      { status: 500 },
    );
  }

  let matchedTexts: string[];
  try {
    matchedTexts = await Promise.all(
      dataUrls.map((url) => matchTextForImage(url, posterText, apiKey)),
    );
  } catch {
    return jsonNoStore(
      { error: "이미지 분석 요청이 실패했습니다. 잠시 후 다시 시도해주세요." },
      { status: 502 },
    );
  }

  return jsonNoStore({ matchedTexts });
}
