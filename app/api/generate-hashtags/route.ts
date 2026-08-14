import OpenAI from "openai";
import { jsonNoStore } from "@/app/lib/httpResponse";
import { OPENAI_MODEL } from "@/app/lib/openaiConfig";

// PLAN.md 23번: 텍스트 + 이미지(Vision)를 OpenAI에 전달해 인스타그램 해시태그를 카테고리별 추천.
// DESIGN.md: { topic 5개, mood 5개, location 최대 5개, misc 5개 } → 최대 20개
//
// 이미지가 있으면 첫 번째 이미지를 low-detail Vision으로 포함한다.
// 포스터 생성 시 Vision 분석(analyze-images-batch)은 기술적 글자 크기 검사용이라 재활용이 불가해
// 해시태그 목적에 맞는 별도 Vision 호출을 1회 더 수행한다.

const DATA_URL_PATTERN = /^data:image\/[a-zA-Z0-9.+-]+;base64,/;

const SYSTEM_PROMPT = `You are an Instagram marketing expert who suggests hashtags.
Return ONLY valid JSON with this exact structure — no markdown fences, no extra text:
{
  "categories": {
    "topic":    ["#tag1", "#tag2", "#tag3", "#tag4", "#tag5"],
    "mood":     ["#tag1", "#tag2", "#tag3", "#tag4", "#tag5"],
    "location": ["#tag1", "#tag2"],
    "misc":     ["#tag1", "#tag2", "#tag3", "#tag4", "#tag5"]
  }
}

Rules:
- Each hashtag must start with #, contain no spaces, use CamelCase or underscores if needed
- topic: 5 tags about the main subject
- mood: 5 tags about atmosphere, emotion, or aesthetic
- location: up to 5 tags about place, region, or brand (empty array [] if not applicable)
- misc: 5 additional popular tags that fit the content
- Mix Korean and English hashtags naturally (Korean tags are fine: #서울 #일상 etc.)
- Total across all categories: maximum 20 tags`;

export type HashtagCategories = {
  topic: string[];
  mood: string[];
  location: string[];
  misc: string[];
};

export async function POST(request: Request) {
  let body: { text?: unknown; imageDataUrls?: unknown };
  try {
    body = await request.json();
  } catch {
    return jsonNoStore({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }

  const { text, imageDataUrls } = body;

  if (typeof text !== "string" || text.trim().length === 0) {
    return jsonNoStore(
      { error: "text(포스터 텍스트 내용)가 필요합니다." },
      { status: 400 },
    );
  }

  // imageDataUrls 검증: 배열이고 각 요소가 data URL 형식인지 확인
  const validImageUrls: string[] = [];
  if (Array.isArray(imageDataUrls)) {
    for (const url of imageDataUrls) {
      if (typeof url === "string" && DATA_URL_PATTERN.test(url)) {
        validImageUrls.push(url);
        // 해시태그 목적에는 첫 번째 이미지 1장으로 충분
        break;
      }
    }
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

  const client = new OpenAI({ apiKey });

  // 이미지가 있으면 Vision 포함 메시지, 없으면 텍스트 전용 메시지
  type ContentPart =
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string; detail: "low" } };

  const userContent: ContentPart[] = [];

  if (validImageUrls.length > 0) {
    userContent.push({
      type: "image_url",
      image_url: { url: validImageUrls[0], detail: "low" },
    });
  }

  userContent.push({
    type: "text",
    text: `다음 인스타그램 게시물 내용에 맞는 해시태그를 추천해줘.\n\n${text.trim()}`,
  });

  let raw: string;
  try {
    const completion = await client.chat.completions.create({
      model: OPENAI_MODEL,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
    });
    raw = completion.choices[0]?.message?.content?.trim() ?? "{}";
  } catch {
    return jsonNoStore(
      { error: "해시태그 생성 요청이 실패했습니다. 잠시 후 다시 시도해주세요." },
      { status: 502 },
    );
  }

  let parsed: { categories?: HashtagCategories };
  try {
    parsed = JSON.parse(raw) as { categories?: HashtagCategories };
  } catch {
    return jsonNoStore(
      { error: "해시태그 응답 파싱에 실패했습니다. 다시 시도해주세요." },
      { status: 500 },
    );
  }

  const categories = parsed.categories;
  if (
    !categories ||
    !Array.isArray(categories.topic) ||
    !Array.isArray(categories.mood) ||
    !Array.isArray(categories.location) ||
    !Array.isArray(categories.misc)
  ) {
    return jsonNoStore(
      { error: "해시태그 응답 형식이 예상과 다릅니다. 다시 시도해주세요." },
      { status: 500 },
    );
  }

  // 각 해시태그가 #으로 시작하는지 보정 (모델이 가끔 # 생략)
  const normalizeTag = (tag: string) =>
    typeof tag === "string" && tag.startsWith("#") ? tag : `#${tag}`;

  const result: HashtagCategories = {
    topic: categories.topic.slice(0, 5).map(normalizeTag),
    mood: categories.mood.slice(0, 5).map(normalizeTag),
    location: categories.location.slice(0, 5).map(normalizeTag),
    misc: categories.misc.slice(0, 5).map(normalizeTag),
  };

  return jsonNoStore({ categories: result });
}
