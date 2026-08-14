import { getPalette } from "colorthief";

// PRD: 레퍼런스 이미지에서 주요 색상 최대 3개를 추출해 팔레트로 적용한다.
// Node 환경에서는 colorthief가 내부적으로 sharp로 이미지를 디코딩한다(peer dependency).
export async function extractPaletteColors(
  imageBuffer: Buffer,
  maxColors = 3,
): Promise<string[]> {
  const palette = await getPalette(imageBuffer, { colorCount: maxColors });
  if (!palette) return [];
  return palette.slice(0, maxColors).map((color) => color.hex());
}
