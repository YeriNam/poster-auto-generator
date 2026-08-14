import { NextResponse } from "next/server";

// PRD 보안 섹션: "서버에 저장하지 않는다." 이 프로젝트의 모든 API는 요청을 처리하는
// 동안만 메모리에서 데이터를 다루고 디스크·DB에 아무것도 쓰지 않는다(PLAN.md 18번 감사로
// 확인). 다만 그것만으로는 부족한 게, 응답 자체가 브라우저·중간 프록시·CDN 캐시에
// 남을 수 있다. no-store로 그 경로까지 명시적으로 막는다.
export function jsonNoStore<T>(data: T, init?: ResponseInit): NextResponse {
  const response = NextResponse.json(data, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export const NO_STORE_HEADER = { "Cache-Control": "no-store" } as const;
