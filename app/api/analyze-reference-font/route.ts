import { analyzeReferenceFont } from "@/app/lib/fontAnalysis";
import { FONT_CANDIDATES } from "@/app/lib/fontCandidates";
import { jsonNoStore } from "@/app/lib/httpResponse";

export async function POST(request: Request) {
  let body: { imageDataUrl?: unknown };
  try {
    body = await request.json();
  } catch {
    return jsonNoStore(
      { error: "요청 형식이 올바르지 않습니다." },
      { status: 400 },
    );
  }

  const { imageDataUrl } = body;
  if (typeof imageDataUrl !== "string" || !imageDataUrl.startsWith("data:image/")) {
    return jsonNoStore(
      { error: "imageDataUrl(data:image/... 문자열)이 필요합니다." },
      { status: 400 },
    );
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return jsonNoStore(
      {
        error:
          "OpenAI API 키가 설정되어 있지 않습니다. .env의 OPENAI_API_KEY를 확인해주세요.",
      },
      { status: 500 },
    );
  }

  let result: Awaited<ReturnType<typeof analyzeReferenceFont>>;
  try {
    result = await analyzeReferenceFont(imageDataUrl, apiKey);
  } catch {
    return jsonNoStore(
      { error: "폰트 분석 요청이 실패했습니다. 잠시 후 다시 시도해주세요." },
      { status: 502 },
    );
  }

  if (!result.hasVisibleFont || result.selectedFontId === null) {
    return jsonNoStore({ hasVisibleFont: false, font: null });
  }

  const font = FONT_CANDIDATES.find((c) => c.id === result.selectedFontId) ?? null;
  return jsonNoStore({ hasVisibleFont: true, font });
}
