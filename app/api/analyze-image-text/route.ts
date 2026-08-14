import { MIN_FONT_PX } from "@/app/lib/pageMetrics";
import { analyzeImageText } from "@/app/lib/visionAnalysis";
import { jsonNoStore } from "@/app/lib/httpResponse";

export async function POST(request: Request) {
  let body: {
    imageDataUrl?: unknown;
    nativeWidthPx?: unknown;
    nativeHeightPx?: unknown;
    displayWidthPx?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return jsonNoStore(
      { error: "요청 형식이 올바르지 않습니다." },
      { status: 400 },
    );
  }

  const { imageDataUrl, nativeWidthPx, nativeHeightPx, displayWidthPx } = body;
  if (
    typeof imageDataUrl !== "string" ||
    !imageDataUrl.startsWith("data:image/") ||
    typeof nativeWidthPx !== "number" ||
    typeof nativeHeightPx !== "number" ||
    typeof displayWidthPx !== "number" ||
    nativeWidthPx <= 0 ||
    nativeHeightPx <= 0 ||
    displayWidthPx <= 0
  ) {
    return jsonNoStore(
      {
        error:
          "imageDataUrl(data:image/... 문자열), nativeWidthPx, nativeHeightPx, displayWidthPx 값이 필요합니다.",
      },
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

  let analysis: Awaited<ReturnType<typeof analyzeImageText>>;
  try {
    analysis = await analyzeImageText(imageDataUrl, apiKey);
  } catch {
    return jsonNoStore(
      { error: "이미지 분석 요청이 실패했습니다. 잠시 후 다시 시도해주세요." },
      { status: 502 },
    );
  }

  if (!analysis.hasText || analysis.textHeightRatio === null) {
    return jsonNoStore({
      hasText: false,
      meetsMinFont: true,
      requiredMinDisplayWidthPx: null,
    });
  }

  // PRD 공식: (이미지 안 텍스트의 원본 크기) × (배치 시 이미지 확대·축소 비율) = 실제 표시 크기
  const originalTextHeightPx = analysis.textHeightRatio * nativeHeightPx;
  const displayScale = displayWidthPx / nativeWidthPx;
  const displayedTextHeightPx = originalTextHeightPx * displayScale;
  const meetsMinFont = displayedTextHeightPx >= MIN_FONT_PX;
  // 표시 크기가 부족하면, 최소 12pt를 만족하는 데 필요한 표시 폭을 역산한다
  const requiredMinDisplayWidthPx = meetsMinFont
    ? displayWidthPx
    : nativeWidthPx * (MIN_FONT_PX / originalTextHeightPx);

  return jsonNoStore({
    hasText: true,
    textHeightRatio: analysis.textHeightRatio,
    originalTextHeightPx,
    displayedTextHeightPx,
    meetsMinFont,
    requiredMinDisplayWidthPx,
  });
}
