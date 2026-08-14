import PptxGenJS from "pptxgenjs";
import type { LayoutResult } from "./layoutEngine";

const MM_PER_INCH = 25.4;
const mmToIn = (mm: number) => mm / MM_PER_INCH;

// PLAN.md 17번: 계산된 좌표(mm)를 pptxgenjs가 쓰는 inch 단위로 환산해 그대로 옮긴다.
// 페이지 크기·요소 위치 모두 layout.mm 값에서 나오므로, 화면에서 계산한 여백 24px·
// 간격 16px 규칙이 최종 파일에도 그대로 반영된다.
export async function buildPptx(
  layout: LayoutResult,
  imageDataUrls: Map<number, string>,
): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.defineLayout({
    name: "POSTER",
    width: mmToIn(layout.page.widthMm),
    height: mmToIn(layout.page.heightMm),
  });
  pptx.layout = "POSTER";

  const slide = pptx.addSlide();

  for (const block of layout.blocks) {
    if (block.type === "text") {
      slide.addText(block.content, {
        x: mmToIn(block.mm.x),
        y: mmToIn(block.mm.y),
        w: mmToIn(block.mm.width),
        h: mmToIn(block.mm.height),
        fontSize: 12,
        valign: "top",
        autoFit: false,
      });
    } else {
      const dataUrl = imageDataUrls.get(block.imageNumber);
      if (!dataUrl) continue;
      slide.addImage({
        data: dataUrl,
        x: mmToIn(block.mm.x),
        y: mmToIn(block.mm.y),
        w: mmToIn(block.mm.width),
        h: mmToIn(block.mm.height),
      });
    }
  }

  const output = await pptx.write({ outputType: "nodebuffer" });
  return output as Buffer;
}
