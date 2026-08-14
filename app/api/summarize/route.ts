import OpenAI from "openai";
import { jsonNoStore } from "@/app/lib/httpResponse";
import {
  AVG_CHAR_WIDTH_RATIO,
  LINE_HEIGHT_RATIO,
  MARGIN_PX,
  MIN_FONT_PX,
  mmToPx,
} from "@/app/lib/pageMetrics";
import { OPENAI_MODEL } from "@/app/lib/openaiConfig";

// DESIGN.md 데이터 흐름 4번: 최종 레이아웃 엔진(PLAN.md 7번, app/lib/layoutEngine)이 실제로
// 블록을 배치하기 전, "텍스트가 페이지를 넘는지"만 가늠하는 임시 계산이다. 상수는 두 곳이
// app/lib/pageMetrics를 함께 참조해 값이 어긋나지 않게 한다.
function estimateMaxChars(pageWidthMm: number, pageHeightMm: number) {
  const usableWidthPx = Math.max(0, mmToPx(pageWidthMm) - MARGIN_PX * 2);
  const usableHeightPx = Math.max(0, mmToPx(pageHeightMm) - MARGIN_PX * 2);

  const lineHeightPx = MIN_FONT_PX * LINE_HEIGHT_RATIO;
  const charWidthPx = MIN_FONT_PX * AVG_CHAR_WIDTH_RATIO;

  const charsPerLine = Math.floor(usableWidthPx / charWidthPx);
  const lineCount = Math.floor(usableHeightPx / lineHeightPx);

  return Math.max(0, charsPerLine * lineCount);
}

// PRD: 텍스트 안 [이미지1] 같은 위치 표시는 요약 시 원문 그대로 보존해야 한다
const IMAGE_MARKER_PATTERN = /\[이미지\d+\]/g;

export async function POST(request: Request) {
  let body: { text?: unknown; pageWidthMm?: unknown; pageHeightMm?: unknown };
  try {
    body = await request.json();
  } catch {
    return jsonNoStore(
      { error: "요청 형식이 올바르지 않습니다." },
      { status: 400 },
    );
  }

  const { text, pageWidthMm, pageHeightMm } = body;
  if (
    typeof text !== "string" ||
    typeof pageWidthMm !== "number" ||
    typeof pageHeightMm !== "number" ||
    pageWidthMm <= 0 ||
    pageHeightMm <= 0
  ) {
    return jsonNoStore(
      { error: "text, pageWidthMm, pageHeightMm 값이 필요합니다." },
      { status: 400 },
    );
  }

  const estimatedMaxChars = estimateMaxChars(pageWidthMm, pageHeightMm);
  const didOverflow = text.length > estimatedMaxChars;

  if (!didOverflow) {
    return jsonNoStore({
      didOverflow: false,
      estimatedMaxChars,
      finalText: text,
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

  const markers = text.match(IMAGE_MARKER_PATTERN) ?? [];
  const client = new OpenAI({ apiKey });

  let summary: string;
  try {
    const completion = await client.chat.completions.create({
      model: OPENAI_MODEL,
      messages: [
        {
          role: "system",
          content:
            "너는 한 장짜리 포스터에 들어갈 텍스트를 분량에 맞게 요약하는 도우미다. " +
            `요약 결과는 공백 포함 ${estimatedMaxChars}자를 넘지 않아야 한다. ` +
            "원문에 [이미지1], [이미지2]처럼 대괄호로 감싼 이미지 위치 표시가 있으면, " +
            "글자 하나도 바꾸지 말고 정확히 같은 형태로, 원래 있던 순서와 그 주변 맥락을 " +
            "최대한 유지하며 결과에 그대로 남겨야 한다. 다른 설명 없이 요약된 본문만 출력한다.",
        },
        { role: "user", content: text },
      ],
    });
    summary = completion.choices[0]?.message?.content?.trim() ?? "";
  } catch {
    return jsonNoStore(
      { error: "OpenAI 요약 요청이 실패했습니다. 잠시 후 다시 시도해주세요." },
      { status: 502 },
    );
  }

  // 요약 중 이미지 위치 표시가 실수로 빠졌다면, 잃어버리지 않도록 끝에 그대로 되돌려 붙인다
  const missingMarkers = markers.filter((marker) => !summary.includes(marker));
  const finalText =
    missingMarkers.length > 0
      ? `${summary} ${missingMarkers.join(" ")}`
      : summary;

  return jsonNoStore({ didOverflow: true, estimatedMaxChars, finalText });
}
