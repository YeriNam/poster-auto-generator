import { generateLayoutCandidates } from "@/app/lib/layoutCandidates";
import { parseLayoutRequest } from "@/app/lib/parseLayoutRequest";
import { jsonNoStore } from "@/app/lib/httpResponse";

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

  const parsed = parseLayoutRequest(body);
  if ("error" in parsed) {
    return jsonNoStore({ error: parsed.error }, { status: 400 });
  }

  const candidates = generateLayoutCandidates(parsed);
  return jsonNoStore({ candidates });
}
