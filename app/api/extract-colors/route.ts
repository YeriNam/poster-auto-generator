import { extractPaletteColors } from "@/app/lib/colorExtraction";
import { jsonNoStore } from "@/app/lib/httpResponse";

const DATA_URL_PATTERN = /^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/;

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
  const match =
    typeof imageDataUrl === "string" ? imageDataUrl.match(DATA_URL_PATTERN) : null;
  if (!match) {
    return jsonNoStore(
      { error: "imageDataUrl(data:image/...;base64,... 문자열)이 필요합니다." },
      { status: 400 },
    );
  }

  const buffer = Buffer.from(match[1], "base64");

  let colors: string[];
  try {
    colors = await extractPaletteColors(buffer, 3);
  } catch {
    return jsonNoStore(
      { error: "색상 추출에 실패했습니다. 손상된 이미지일 수 있어요." },
      { status: 502 },
    );
  }

  return jsonNoStore({ colors });
}
