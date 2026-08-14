import { analyzeImageText } from "@/app/lib/visionAnalysis";
import { MIN_FONT_PX } from "@/app/lib/pageMetrics";
import { MAX_OPENAI_CALLS_PER_GENERATION } from "@/app/lib/openaiConfig";
import { jsonNoStore } from "@/app/lib/httpResponse";

type ImageInput = {
  imageDataUrl: string;
  nativeWidthPx: number;
  nativeHeightPx: number;
  displayWidthPx: number;
};

type ImageAnalysisResult =
  | { hasText: false; meetsMinFont: true; requiredMinDisplayWidthPx: null }
  | {
      hasText: true;
      textHeightRatio: number;
      originalTextHeightPx: number;
      displayedTextHeightPx: number;
      meetsMinFont: boolean;
      requiredMinDisplayWidthPx: number;
    };

// 이미지 한 장에 대해 Vision 분석 → 12pt 보정 계산을 수행한다 (analyze-image-text 단건 엔드포인트와 동일한 계산)
async function analyzeOneImage(
  img: ImageInput,
  apiKey: string,
): Promise<ImageAnalysisResult> {
  const analysis = await analyzeImageText(img.imageDataUrl, apiKey);

  if (!analysis.hasText || analysis.textHeightRatio === null) {
    return { hasText: false, meetsMinFont: true, requiredMinDisplayWidthPx: null };
  }

  const originalTextHeightPx = analysis.textHeightRatio * img.nativeHeightPx;
  const displayScale = img.displayWidthPx / img.nativeWidthPx;
  const displayedTextHeightPx = originalTextHeightPx * displayScale;
  const meetsMinFont = displayedTextHeightPx >= MIN_FONT_PX;
  const requiredMinDisplayWidthPx = meetsMinFont
    ? img.displayWidthPx
    : img.nativeWidthPx * (MIN_FONT_PX / originalTextHeightPx);

  return {
    hasText: true,
    textHeightRatio: analysis.textHeightRatio,
    originalTextHeightPx,
    displayedTextHeightPx,
    meetsMinFont,
    requiredMinDisplayWidthPx,
  };
}

// PLAN.md 19번: 이미지 Vision 분석 요청을 한 번에 받아 Promise.all로 병렬 호출한다.
// 요약(1) + 레퍼런스 폰트(1) 호출을 예약하고, 남은 여유 내에서 이미지 수를 검증한다.
export async function POST(request: Request) {
  let body: { images?: unknown };
  try {
    body = await request.json();
  } catch {
    return jsonNoStore(
      { error: "요청 형식이 올바르지 않습니다." },
      { status: 400 },
    );
  }

  const { images } = body;
  if (!Array.isArray(images)) {
    return jsonNoStore({ error: "images 배열이 필요합니다." }, { status: 400 });
  }

  // 요약(1) + 폰트 분석(1)을 위해 2회 예약하고, 나머지를 이미지 Vision에 쓴다
  const maxImages = MAX_OPENAI_CALLS_PER_GENERATION - 2;
  if (images.length > maxImages) {
    return jsonNoStore(
      {
        error: `이미지는 최대 ${maxImages}장까지 분석할 수 있습니다. (생성당 OpenAI 호출 상한 ${MAX_OPENAI_CALLS_PER_GENERATION}회)`,
      },
      { status: 400 },
    );
  }

  const parsed: ImageInput[] = [];
  for (let i = 0; i < images.length; i++) {
    const imgRaw = images[i];
    if (typeof imgRaw !== "object" || imgRaw === null) {
      return jsonNoStore(
        { error: `images[${i}]은 객체여야 합니다.` },
        { status: 400 },
      );
    }
    const img = imgRaw as Record<string, unknown>;
    if (
      typeof img.imageDataUrl !== "string" ||
      !img.imageDataUrl.startsWith("data:image/") ||
      typeof img.nativeWidthPx !== "number" ||
      typeof img.nativeHeightPx !== "number" ||
      typeof img.displayWidthPx !== "number" ||
      img.nativeWidthPx <= 0 ||
      img.nativeHeightPx <= 0 ||
      img.displayWidthPx <= 0
    ) {
      return jsonNoStore(
        {
          error: `images[${i}]의 형식이 올바르지 않습니다. 각 항목은 { imageDataUrl, nativeWidthPx, nativeHeightPx, displayWidthPx } 형태여야 합니다.`,
        },
        { status: 400 },
      );
    }
    parsed.push({
      imageDataUrl: img.imageDataUrl as string,
      nativeWidthPx: img.nativeWidthPx as number,
      nativeHeightPx: img.nativeHeightPx as number,
      displayWidthPx: img.displayWidthPx as number,
    });
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

  // 모든 이미지를 동시에(병렬) 분석 — 순차 호출 금지(PLAN.md 19번)
  let results: ImageAnalysisResult[];
  try {
    results = await Promise.all(
      parsed.map((img) => analyzeOneImage(img, apiKey)),
    );
  } catch {
    return jsonNoStore(
      { error: "이미지 분석 요청이 실패했습니다. 잠시 후 다시 시도해주세요." },
      { status: 502 },
    );
  }

  return jsonNoStore({ results });
}
