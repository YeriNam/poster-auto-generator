// PLAN.md 20번: 세션당 레이아웃 조정 횟수를 추적하는 임시(비영구) 서버 메모리 카운터.
// 프로세스 메모리(Map)에만 유지하므로, 서버 재시작이나 Vercel 함수 인스턴스 교체 시
// 카운터가 초기화될 수 있다 — PRD가 명시한 "임시(비영구)" 특성에 부합한다.
// DESIGN.md 11번: 탭을 닫으면 세션 쿠키가 만료되어 카운터도 실질적으로 사라진다.

export const MAX_ADJUSTMENTS_PER_SESSION = 5;

// 세션 ID → 사용 횟수
const sessionCounts = new Map<string, number>();

// 현재 사용 횟수를 반환한다 (카운터가 없으면 0)
export function getSessionCount(sessionId: string): number {
  return sessionCounts.get(sessionId) ?? 0;
}

// 카운터를 1 올리고 새 횟수를 반환한다
export function incrementSessionCount(sessionId: string): number {
  const next = (sessionCounts.get(sessionId) ?? 0) + 1;
  sessionCounts.set(sessionId, next);
  return next;
}

// 제한에 도달했는지 확인한다
export function hasReachedLimit(sessionId: string): boolean {
  return (sessionCounts.get(sessionId) ?? 0) >= MAX_ADJUSTMENTS_PER_SESSION;
}
