import {
  Document,
  FrameAnchorType,
  FrameWrap,
  ImageRun,
  Packer,
  Paragraph,
  TextRun,
  TextWrappingType,
  convertMillimetersToTwip,
  type IHorizontalPositionOptions,
  type IVerticalPositionOptions,
} from "docx";
import { mmToPx } from "./pageMetrics";
import type { LayoutResult } from "./layoutEngine";

// OOXML floating drawing 의 offset 단위는 EMU(English Metric Unit).
// 1 inch = 914400 EMU → 1 mm = 914400 / 25.4 = 36000 EMU
const MM_TO_EMU = 36000;

// PLAN.md 17번 + DESIGN.md 기술 선택 노트:
// 텍스트 블록은 <w:framePr>로 절대 위치 프레임에 배치하고,
// 이미지 블록은 floating ImageRun으로 배치한다.
// 두 경우 모두 px 단위가 아닌 올바른 문서 단위(twip/EMU)를 사용한다.
//
// 단위 요약:
//   <w:framePr> position/size: twip (1pt = 20twip, 1mm ≈ 56.69twip) → convertMillimetersToTwip 사용
//   floating ImageRun offset:  EMU  (1mm = 36000 EMU)                 → MM_TO_EMU 상수 사용
//   floating ImageRun size:    px   (라이브러리가 내부에서 × 9525 = EMU) → mmToPx 사용
export async function buildDocx(
  layout: LayoutResult,
  imageBuffers: Map<number, Buffer>,
): Promise<Buffer> {
  const children: Paragraph[] = [];

  for (const block of layout.blocks) {
    if (block.type === "text") {
      // 텍스트: <w:framePr>로 페이지 기준 절대 위치 프레임에 배치
      // 긴 텍스트는 프레임 폭 내에서 자동 줄바꿈된다.
      const lines = block.content.split("\n");
      children.push(
        new Paragraph({
          frame: {
            type: "absolute" as const,
            position: {
              x: Math.round(convertMillimetersToTwip(block.mm.x)),
              y: Math.round(convertMillimetersToTwip(block.mm.y)),
            },
            width: Math.round(convertMillimetersToTwip(block.mm.width)),
            height: Math.round(convertMillimetersToTwip(block.mm.height)),
            anchor: {
              horizontal: FrameAnchorType.PAGE,
              vertical: FrameAnchorType.PAGE,
            },
            wrap: FrameWrap.NONE,
          },
          children: lines.flatMap((line, i) => {
            const runs: (TextRun)[] = [
              new TextRun({ text: line, font: { name: "Arial" }, size: 24 }),
            ];
            // 마지막 줄 이외에는 줄바꿈 추가
            if (i < lines.length - 1) {
              runs.push(new TextRun({ break: 1, font: { name: "Arial" }, size: 24 }));
            }
            return runs;
          }),
        }),
      );
      continue;
    }

    const data = imageBuffers.get(block.imageNumber);
    if (!data) continue;

    // 이미지 floating offset 은 EMU 단위 — mmToPx(px) 가 아닌 mm × 36000 사용
    const horizontalPosition: IHorizontalPositionOptions = {
      offset: Math.round(block.mm.x * MM_TO_EMU),
    };
    const verticalPosition: IVerticalPositionOptions = {
      offset: Math.round(block.mm.y * MM_TO_EMU),
    };

    children.push(
      new Paragraph({
        children: [
          new ImageRun({
            type: "png",
            data,
            transformation: {
              // 라이브러리가 px → EMU(× 9525) 변환을 내부에서 처리한다
              width: Math.round(mmToPx(block.mm.width)),
              height: Math.round(mmToPx(block.mm.height)),
            },
            floating: {
              horizontalPosition,
              verticalPosition,
              wrap: { type: TextWrappingType.NONE },
              behindDocument: false,
            },
          }),
        ],
      }),
    );
  }

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            size: {
              width: convertMillimetersToTwip(layout.page.widthMm),
              height: convertMillimetersToTwip(layout.page.heightMm),
            },
            margin: { top: 0, bottom: 0, left: 0, right: 0 },
          },
        },
        children,
      },
    ],
  });

  return Packer.toBuffer(doc);
}
