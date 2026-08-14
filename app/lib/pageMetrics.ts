// PRD 5장: 여백·간격은 px(96dpi 기준)로 정의하고, 최종 파일 생성 시 pt/mm 등으로 환산한다.
// 이 상수·변환 함수는 임시 배치 판단(PLAN.md 6번, app/api/summarize)과
// 실제 레이아웃 엔진(PLAN.md 7번, app/lib/layoutEngine)이 함께 쓴다.
export const PX_PER_MM = 96 / 25.4;
export const MARGIN_PX = 24; // PRD: 페이지 여백 최소 24px
export const GAP_PX = 16; // PRD: 요소 간격 최소 16px
export const MIN_FONT_PX = 16; // PRD: 본문 최소 12pt ≈ 16px (96dpi 기준, 1pt = 4/3px)
export const LINE_HEIGHT_RATIO = 1.4;
export const AVG_CHAR_WIDTH_RATIO = 0.9; // 한글·영문이 섞였을 때의 대략적인 평균 글자 폭 비율

export function mmToPx(mm: number): number {
  return mm * PX_PER_MM;
}

export function pxToMm(px: number): number {
  return px / PX_PER_MM;
}

export function pxToPt(px: number): number {
  return px / (4 / 3); // 96dpi 기준 1pt = 4/3px
}
