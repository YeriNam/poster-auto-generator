// 이 프로젝트에서 OpenAI API를 호출하는 모든 곳(요약, 이미지 텍스트 분석, 폰트 분석 등)이
// 같은 모델과 호출 횟수 제한을 쓰도록 한 곳에서 관리한다.
export const OPENAI_MODEL = "gpt-4o-mini";

// PLAN.md 19번: 포스터 1건 생성당 OpenAI API 호출 상한
// 실제 최대 경로: 요약(1) + 이미지 Vision(최대 5) + 레퍼런스 폰트(1) = 7회 → 10회 한도 내
export const MAX_OPENAI_CALLS_PER_GENERATION = 10;
