import { NextResponse } from "next/server";
import type { LayoutBlock, LayoutResult } from "@/app/lib/layoutEngine";
import { buildPptx } from "@/app/lib/exportPptx";
import { buildDocx } from "@/app/lib/exportDocx";
import { buildLatexSource, buildLatexZip } from "@/app/lib/exportLatex";
import { jsonNoStore, NO_STORE_HEADER } from "@/app/lib/httpResponse";

const DATA_URL_PATTERN = /^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/;

function isLayoutResult(value: unknown): value is LayoutResult {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.page === "object" &&
    v.page !== null &&
    Array.isArray(v.blocks) &&
    typeof v.overflowed === "boolean"
  );
}

// PLAN.md 17번: 화면3에서 고른 레이아웃을 실제 파일(.pptx/.docx/.latex)로 만들어 내려준다.
// 이미지 원본 바이트는 서버에 저장돼 있지 않으므로(PRD: 서버 미저장 원칙), 클라이언트가
// 이 요청에 실어 보낸 base64 데이터를 그때그때만 메모리에서 처리하고 응답 후 버린다.
export async function POST(request: Request) {
  let body: { format?: unknown; layout?: unknown; images?: unknown };
  try {
    body = await request.json();
  } catch {
    return jsonNoStore(
      { error: "요청 형식이 올바르지 않습니다." },
      { status: 400 },
    );
  }

  const { format, layout, images } = body;
  if (format !== "pptx" && format !== "docx" && format !== "latex") {
    return jsonNoStore(
      { error: "format은 pptx, docx, latex 중 하나여야 합니다." },
      { status: 400 },
    );
  }
  if (!isLayoutResult(layout)) {
    return jsonNoStore(
      { error: "layout(레이아웃 계산 결과) 값이 필요합니다." },
      { status: 400 },
    );
  }
  if (!Array.isArray(images)) {
    return jsonNoStore(
      { error: "images(배열)가 필요합니다." },
      { status: 400 },
    );
  }

  const imageBuffers = new Map<number, Buffer>();
  for (const item of images) {
    if (
      typeof item !== "object" ||
      item === null ||
      typeof (item as { number?: unknown }).number !== "number" ||
      typeof (item as { dataUrl?: unknown }).dataUrl !== "string"
    ) {
      return jsonNoStore(
        { error: "images 배열의 각 항목은 { number, dataUrl } 형태여야 합니다." },
        { status: 400 },
      );
    }
    const { number, dataUrl } = item as { number: number; dataUrl: string };
    const match = dataUrl.match(DATA_URL_PATTERN);
    if (!match) {
      return jsonNoStore(
        { error: `이미지 ${number}번의 dataUrl 형식이 올바르지 않습니다.` },
        { status: 400 },
      );
    }
    imageBuffers.set(number, Buffer.from(match[1], "base64"));
  }

  const usedImageNumbers = new Set(
    layout.blocks
      .filter((b: LayoutBlock): b is Extract<LayoutBlock, { type: "image" }> => b.type === "image")
      .map((b) => b.imageNumber),
  );
  for (const num of usedImageNumbers) {
    if (!imageBuffers.has(num)) {
      return jsonNoStore(
        { error: `이미지 ${num}번의 데이터가 없습니다.` },
        { status: 400 },
      );
    }
  }

  try {
    if (format === "pptx") {
      const imageDataUrls = new Map(
        (images as { number: number; dataUrl: string }[]).map((i) => [i.number, i.dataUrl]),
      );
      const buffer = await buildPptx(layout, imageDataUrls);
      return new NextResponse(new Uint8Array(buffer), {
        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          "Content-Disposition": 'attachment; filename="poster.pptx"',
          ...NO_STORE_HEADER,
        },
      });
    }

    if (format === "docx") {
      const buffer = await buildDocx(layout, imageBuffers);
      return new NextResponse(new Uint8Array(buffer), {
        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "Content-Disposition": 'attachment; filename="poster.docx"',
          ...NO_STORE_HEADER,
        },
      });
    }

    // latex: .tex + 이미지들을 zip으로
    const imageFileNames = new Map<number, string>();
    const zipImages: { fileName: string; data: Buffer }[] = [];
    for (const [number, data] of imageBuffers) {
      const fileName = `image${number}.png`;
      imageFileNames.set(number, fileName);
      zipImages.push({ fileName, data });
    }
    const texSource = buildLatexSource(layout, imageFileNames);
    const zipBuffer = await buildLatexZip(texSource, zipImages);
    return new NextResponse(new Uint8Array(zipBuffer), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": 'attachment; filename="poster-latex.zip"',
        ...NO_STORE_HEADER,
      },
    });
  } catch {
    return jsonNoStore(
      { error: "파일 생성에 실패했습니다." },
      { status: 500 },
    );
  }
}
