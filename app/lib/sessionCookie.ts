import { randomUUID } from "crypto";

// DESIGN.md 8번 / PLAN.md 20번: 세션 쿠키로 클라이언트를 식별한다.
// max-age를 설정하지 않는 "세션 쿠키"라서 브라우저(탭)를 닫으면 자동으로 사라진다.
// DESIGN.md 11번: "브라우저 탭을 닫으면 ... 서버의 임시 카운터가 함께 사라짐"

const COOKIE_NAME = "poster_session_id";

// 요청 Cookie 헤더에서 세션 ID를 읽는다. 없으면 새 UUID를 생성해 반환한다.
export function getOrCreateSessionId(cookieHeader: string | null): {
  sessionId: string;
  isNew: boolean;
} {
  if (cookieHeader) {
    for (const part of cookieHeader.split(";")) {
      const trimmed = part.trim();
      if (trimmed.startsWith(`${COOKIE_NAME}=`)) {
        const value = trimmed.slice(COOKIE_NAME.length + 1);
        if (value) return { sessionId: value, isNew: false };
      }
    }
  }
  return { sessionId: randomUUID(), isNew: true };
}

// 응답 Set-Cookie 헤더 값 (세션 쿠키: max-age 없음, HttpOnly, SameSite=Strict)
export function makeSessionCookieHeader(sessionId: string): string {
  return `${COOKIE_NAME}=${sessionId}; Path=/; HttpOnly; SameSite=Strict`;
}
