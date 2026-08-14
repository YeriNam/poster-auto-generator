import {
  TEMPLATE_LABELS,
  computeLayoutForTemplate,
  type TemplateId,
} from "@/app/lib/layoutCandidates";
import { interpretAdjustmentCommand } from "@/app/lib/layoutAdjustment";
import { parseLayoutRequest } from "@/app/lib/parseLayoutRequest";
import { jsonNoStore } from "@/app/lib/httpResponse";
import { getOrCreateSessionId, makeSessionCookieHeader } from "@/app/lib/sessionCookie";
import {
  MAX_ADJUSTMENTS_PER_SESSION,
  hasReachedLimit,
  incrementSessionCount,
} from "@/app/lib/sessionCounter";

const VALID_TEMPLATE_IDS = Object.keys(TEMPLATE_LABELS) as TemplateId[];

// PLAN.md 16번(뒷부분): 화면3의 "이미지를 오른쪽으로 옮겨줘" 같은 텍스트 명령을 처리하는 API.
// OpenAI는 어느 배치(템플릿)가 요청에 맞는지만 고르고, 실제 좌표는 항상 우리 규칙 엔진
// (computeLayoutForTemplate)이 계산한다 — 그래서 명령으로 조정해도 여백 24px·간격 16px·
// 최소 12pt 규칙을 벗어날 수 없다.
// PLAN.md 20번: 세션 쿠키 기준 임시 카운터로 조정 횟수를 세션당 최대 5회로 제한한다.
export async function POST(request: Request) {
  // 세션 ID 확인 (없으면 새로 발급)
  const { sessionId, isNew } = getOrCreateSessionId(request.headers.get("cookie"));

  // 세션당 5회 제한 확인 — OpenAI를 호출하기 전에 먼저 걸러낸다
  if (hasReachedLimit(sessionId)) {
    const res = jsonNoStore(
      {
        error: `텍스트 명령 조정은 세션당 최대 ${MAX_ADJUSTMENTS_PER_SESSION}회까지 사용할 수 있어요. 새 포스터를 만들려면 페이지를 새로 고침하세요.`,
        adjustmentCount: MAX_ADJUSTMENTS_PER_SESSION,
        maxAdjustments: MAX_ADJUSTMENTS_PER_SESSION,
      },
      { status: 429 },
    );
    if (isNew) res.headers.set("Set-Cookie", makeSessionCookieHeader(sessionId));
    return res;
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return jsonNoStore(
      { error: "요청 형식이 올바르지 않습니다." },
      { status: 400 },
    );
  }

  const { currentTemplateId, command } = body;
  if (
    typeof currentTemplateId !== "string" ||
    !VALID_TEMPLATE_IDS.includes(currentTemplateId as TemplateId)
  ) {
    return jsonNoStore(
      { error: `currentTemplateId는 ${VALID_TEMPLATE_IDS.join(", ")} 중 하나여야 합니다.` },
      { status: 400 },
    );
  }
  if (typeof command !== "string" || command.trim().length === 0) {
    return jsonNoStore(
      { error: "command(텍스트 명령)가 필요합니다." },
      { status: 400 },
    );
  }

  const parsed = parseLayoutRequest(body);
  if ("error" in parsed) {
    return jsonNoStore({ error: parsed.error }, { status: 400 });
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

  let adjustment: Awaited<ReturnType<typeof interpretAdjustmentCommand>>;
  try {
    adjustment = await interpretAdjustmentCommand(
      command,
      currentTemplateId as TemplateId,
      apiKey,
    );
  } catch {
    return jsonNoStore(
      { error: "명령 해석 요청이 실패했습니다. 잠시 후 다시 시도해주세요." },
      { status: 502 },
    );
  }

  // OpenAI 호출이 성공한 후에만 카운터를 올린다 (실패한 시도는 횟수에서 제외)
  const usedCount = incrementSessionCount(sessionId);
  const remainingCount = MAX_ADJUSTMENTS_PER_SESSION - usedCount;

  const candidate = computeLayoutForTemplate(adjustment.templateId, parsed);

  const res = jsonNoStore({
    changed: adjustment.changed,
    ...candidate,
    adjustmentCount: usedCount,
    remainingAdjustments: remainingCount,
    maxAdjustments: MAX_ADJUSTMENTS_PER_SESSION,
  });
  // 새 세션이면 쿠키를 심어 다음 요청부터 같은 세션으로 인식하게 한다
  if (isNew) res.headers.set("Set-Cookie", makeSessionCookieHeader(sessionId));
  return res;
}
