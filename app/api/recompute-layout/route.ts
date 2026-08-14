import {
  TEMPLATE_LABELS,
  computeLayoutForTemplate,
  type TemplateId,
} from "@/app/lib/layoutCandidates";
import { parseLayoutRequest } from "@/app/lib/parseLayoutRequest";
import { jsonNoStore } from "@/app/lib/httpResponse";

const VALID_TEMPLATE_IDS = Object.keys(TEMPLATE_LABELS) as TemplateId[];

// PLAN.md 16번(앞부분): 화면3에서 사용자가 텍스트 내용을 직접 고쳤을 때 쓰는 API.
// AI 호출 없이, 이미 고른 templateId 하나만 새 텍스트로 다시 계산해 여백·간격·최소
// 글자 크기 규칙을 자동으로 다시 검사하고, 필요하면 재배치(높이 재계산 등)한다.
export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return jsonNoStore(
      { error: "요청 형식이 올바르지 않습니다." },
      { status: 400 },
    );
  }

  const { templateId } = body;
  if (typeof templateId !== "string" || !VALID_TEMPLATE_IDS.includes(templateId as TemplateId)) {
    return jsonNoStore(
      { error: `templateId는 ${VALID_TEMPLATE_IDS.join(", ")} 중 하나여야 합니다.` },
      { status: 400 },
    );
  }

  const parsed = parseLayoutRequest(body);
  if ("error" in parsed) {
    return jsonNoStore({ error: parsed.error }, { status: 400 });
  }

  const candidate = computeLayoutForTemplate(templateId as TemplateId, parsed);
  return jsonNoStore(candidate);
}
