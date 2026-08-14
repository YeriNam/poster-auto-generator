// PRD: "미리 정한 후보 폰트 목록(고딕 계열 2종, 명조 계열 2종, 손글씨풍 1종) 중
// 가장 비슷한 폰트를 선택한다." — Windows/문서 프로그램에서 흔히 쓰는 한글 폰트로 구성했다.
// 이 파일이 후보의 단일 출처라, 다운로드 파일 생성(PLAN.md 17번)에서도 그대로 재사용한다.
export type FontCandidate = {
  id: string;
  label: string; // 사람이 읽는 이름
  family: string; // .pptx/.docx에 실제로 넣을 폰트 이름
  mood: string; // Vision 프롬프트에 설명할 분위기
};

export const FONT_CANDIDATES: FontCandidate[] = [
  {
    id: "gothic-clean",
    label: "맑은 고딕",
    family: "Malgun Gothic",
    mood: "깔끔하고 현대적인 고딕(산세리프) 느낌, 두께는 보통",
  },
  {
    id: "gothic-bold",
    label: "나눔고딕 볼드",
    family: "NanumGothic",
    mood: "굵고 각진 고딕(산세리프) 느낌, 힘 있고 강조된 인상",
  },
  {
    id: "myeongjo-classic",
    label: "바탕",
    family: "Batang",
    mood: "전통적이고 차분한 명조(세리프) 느낌",
  },
  {
    id: "myeongjo-soft",
    label: "나눔명조",
    family: "NanumMyeongjo",
    mood: "얇고 부드러운 명조(세리프) 느낌, 우아한 인상",
  },
  {
    id: "handwriting",
    label: "나눔손글씨 펜",
    family: "Nanum Pen Script",
    mood: "손으로 쓴 듯한 캐주얼하고 친근한 손글씨 느낌",
  },
];
