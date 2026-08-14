import { ZipArchive } from "archiver";
import type { LayoutResult } from "./layoutEngine";

// LaTeX 특수문자를 그대로 넣으면 컴파일이 깨지므로 이스케이프한다
function escapeLatex(text: string): string {
  return text
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/([{}$&#%_^~])/g, (match) => {
      if (match === "^") return "\\textasciicircum{}";
      if (match === "~") return "\\textasciitilde{}";
      return `\\${match}`;
    });
}

// PLAN.md 17번: mm 좌표를 그대로 쓸 수 있는 TikZ overlay로 절대 배치한다.
// 이미지는 .tex 파일 안에 담을 수 없어 상대 경로(images/이미지N.png)로 참조하고,
// 실제 파일은 zip에 함께 담는다(DESIGN.md 기술 선택 노트).
export function buildLatexSource(
  layout: LayoutResult,
  imageFileNames: Map<number, string>,
): string {
  const lines: string[] = [];
  lines.push("\\documentclass{article}");
  lines.push("\\usepackage{graphicx}");
  lines.push("\\usepackage{tikz}");
  lines.push("\\usepackage{kotex}"); // 한글 지원
  lines.push(
    `\\usepackage[paperwidth=${layout.page.widthMm}mm,paperheight=${layout.page.heightMm}mm,margin=0mm]{geometry}`,
  );
  lines.push("\\pagestyle{empty}");
  lines.push("\\setlength{\\parindent}{0pt}");
  lines.push("\\begin{document}");
  lines.push(
    "\\begin{tikzpicture}[remember picture, overlay, shift={(current page.north west)}, x=1mm, y=-1mm]",
  );

  for (const block of layout.blocks) {
    const x = block.mm.x;
    const y = block.mm.y;
    if (block.type === "text") {
      lines.push(
        `\\node[anchor=north west, text width=${block.mm.width}mm, inner sep=0] at (${x},${y}) {${escapeLatex(block.content)}};`,
      );
    } else {
      const fileName = imageFileNames.get(block.imageNumber);
      if (!fileName) continue;
      lines.push(
        `\\node[anchor=north west, inner sep=0] at (${x},${y}) ` +
          `{\\includegraphics[width=${block.mm.width}mm,height=${block.mm.height}mm]{images/${fileName}}};`,
      );
    }
  }

  lines.push("\\end{tikzpicture}");
  lines.push("\\end{document}");
  return lines.join("\n");
}

// .tex 파일과 이미지들을 zip 하나로 묶는다 (.tex는 이미지를 파일 안에 못 담기 때문)
export function buildLatexZip(
  texSource: string,
  images: { fileName: string; data: Buffer }[],
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const archive = new ZipArchive({ zlib: { level: 9 } });
    const chunks: Buffer[] = [];

    archive.on("data", (chunk: Buffer) => chunks.push(chunk));
    archive.on("error", reject);
    archive.on("end", () => resolve(Buffer.concat(chunks)));

    archive.append(texSource, { name: "poster.tex" });
    for (const image of images) {
      archive.append(image.data, { name: `images/${image.fileName}` });
    }

    archive.finalize().catch(reject);
  });
}
