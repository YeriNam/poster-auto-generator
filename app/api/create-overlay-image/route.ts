import sharp, { type Sharp, type OverlayOptions } from "sharp";
import path from "path";
import fs from "fs";
import { NextResponse } from "next/server";
import { jsonNoStore, NO_STORE_HEADER } from "@/app/lib/httpResponse";
import { PX_PER_MM } from "@/app/lib/pageMetrics";

// PLAN.md 24번: 대표 이미지 위에 레퍼런스 스타일 텍스트를 합성해 인스타그램용 PNG를 반환한다.
// DESIGN.md 화면4:
//   - 배경: 첫 번째 이미지를 cover 방식으로 캔버스에 꽉 채움. 이미지 없으면 단색 배경.
//   - 텍스트 레이어: SVG로 생성 → sharp.composite로 합성
//   - 최소 글자 크기: 캔버스 폭 * 3.3%, 절대 최솟값 16px(≈12pt)
//   - 대비 규칙: 텍스트 색상이 오버레이 바와 WCAG AA(4.5:1) 미달이면 흰색/검정 자동 전환
//
// 폰트 파일: /public/fonts/ 에 배치하면 base64로 SVG에 내장해 렌더링 품질을 높인다.
//   NotoSansKR-Regular.ttf  (고딕, sans)
//   NotoSerifKR-Regular.ttf (명조, serif)
//   Caveat-Regular.ttf       (손글씨, handwriting)
// 파일이 없으면 시스템 폰트 스택(Windows: 맑은고딕, macOS: Apple SD Gothic)으로 자동 대체.
// Vercel 배포 시에는 파일을 포함시켜야 폰트가 보장된다.

type FontStyle = "sans" | "serif" | "handwriting";
type TextPosition = "top" | "center" | "bottom";

const FONT_FILES: Record<FontStyle, string> = {
  sans: "NotoSansKR-Regular.ttf",
  serif: "NotoSerifKR-Regular.ttf",
  handwriting: "Caveat-Regular.ttf",
};

const FONT_FALLBACKS: Record<FontStyle, string> = {
  sans: "'Malgun Gothic', 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif",
  serif: "'Batang', 'AppleMyungjo', 'Noto Serif KR', serif",
  handwriting: "Caveat, 'Comic Sans MS', cursive",
};

// 프로세스 수명 동안 폰트를 한 번만 읽는다 (요청마다 디스크 I/O를 반복하지 않음)
const fontBase64Cache = new Map<FontStyle, string | null>();

function getFontBase64(style: FontStyle): string | null {
  if (fontBase64Cache.has(style)) return fontBase64Cache.get(style) ?? null;
  try {
    const fontPath = path.join(process.cwd(), "public", "fonts", FONT_FILES[style]);
    if (!fs.existsSync(fontPath)) {
      fontBase64Cache.set(style, null);
      return null;
    }
    const b64 = fs.readFileSync(fontPath).toString("base64");
    fontBase64Cache.set(style, b64);
    return b64;
  } catch {
    fontBase64Cache.set(style, null);
    return null;
  }
}

// ─── 색상 유틸리티 ───

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return null;
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}

function relativeLuminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  return (
    [rgb.r, rgb.g, rgb.b]
      .map((c) => {
        const n = c / 255;
        return n <= 0.03928 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4);
      })
      .reduce((acc, c, i) => acc + c * [0.2126, 0.7152, 0.0722][i], 0)
  );
}

function contrastRatio(hex1: string, hex2: string): number {
  const L1 = relativeLuminance(hex1);
  const L2 = relativeLuminance(hex2);
  const [hi, lo] = L1 > L2 ? [L1, L2] : [L2, L1];
  return (hi + 0.05) / (lo + 0.05);
}

// ─── 텍스트 줄바꿈 ───
// CJK 문자는 글자 폭 1.0, 라틴/숫자는 0.55로 추정해 maxWidth 단위로 나눈다.

function wrapText(text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    if (!para) { lines.push(""); continue; }
    let current = "";
    let lineW = 0;
    for (const ch of para) {
      const cw = /[ᄀ-鿿가-힣豈-﫿]/.test(ch) ? 1.0 : 0.55;
      if (lineW + cw > maxWidth && current) {
        lines.push(current);
        current = ch;
        lineW = cw;
      } else {
        current += ch;
        lineW += cw;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

// ─── SVG 오버레이 생성 ───

function buildSvgOverlay(p: {
  canvasW: number;
  canvasH: number;
  text: string;
  position: TextPosition;
  fontStyle: FontStyle;
  textColor: string;
  barOpacity: number;
}): Buffer {
  const fontSize = Math.max(16, Math.round(p.canvasW * 0.033));
  const lineH = Math.round(fontSize * 1.45);
  const padH = Math.round(p.canvasW * 0.05);   // 좌우 여백
  const padV = Math.round(fontSize * 0.75);     // 상하 여백

  // 한 줄 최대 폭(글자 수 단위): 가용 폭 ÷ 글자 폭(px)
  const maxCharsWide = (p.canvasW - padH * 2) / fontSize;
  const allLines = wrapText(p.text, maxCharsWide);

  // 바 높이의 최대를 캔버스 40%로 제한해 텍스트를 너무 많이 잘라내지 않도록 함
  const maxLines = Math.max(1, Math.floor((p.canvasH * 0.40 - padV * 2) / lineH));
  const lines = allLines.slice(0, maxLines);

  const barH = lines.length * lineH + padV * 2;
  let barY: number;
  switch (p.position) {
    case "top":    barY = 0; break;
    case "center": barY = Math.round((p.canvasH - barH) / 2); break;
    default:       barY = p.canvasH - barH;
  }
  const textBaseY = barY + padV + fontSize;

  // 폰트 @font-face — 파일이 있으면 base64 내장, 없으면 생략
  const fontB64 = getFontBase64(p.fontStyle);
  const customFamilyName = fontB64 ? FONT_FILES[p.fontStyle].replace(".ttf", "") : null;
  const fontFaceDecl = fontB64 && customFamilyName
    ? `@font-face{font-family:'${customFamilyName}';src:url('data:font/truetype;base64,${fontB64}');}`
    : "";
  const fontFamily = customFamilyName
    ? `'${customFamilyName}',${FONT_FALLBACKS[p.fontStyle]}`
    : FONT_FALLBACKS[p.fontStyle];

  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const textEls = lines
    .map((line, i) =>
      `<text x="${padH}" y="${textBaseY + i * lineH}" ` +
      `font-family="${esc(fontFamily)}" font-size="${fontSize}" ` +
      `fill="${p.textColor}" xml:space="preserve">${esc(line)}</text>`,
    )
    .join("\n  ");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${p.canvasW}" height="${p.canvasH}">
  <defs><style>${fontFaceDecl}</style></defs>
  <rect x="0" y="${barY}" width="${p.canvasW}" height="${barH}" fill="rgba(0,0,0,${p.barOpacity})"/>
  ${textEls}
</svg>`;

  return Buffer.from(svg, "utf-8");
}

// ─── 데이터 URL 파서 ───

const DATA_URL_RE = /^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/;

// ─── Route Handler ───

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return jsonNoStore({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }

  type LogoPosition = "top-left" | "top-right" | "bottom-left" | "bottom-right";

  const {
    imageDataUrl,
    text,
    pageWidthMm,
    pageHeightMm,
    textPosition = "bottom",
    fontStyle = "sans",
    textColor: rawTextColor = "#ffffff",
    backgroundColor = "#1a1a1a",
    logoDataUrl,
    logoPosition = "top-right",
    logoSizeRatio = 0.18,
  } = body as {
    imageDataUrl?: string;
    text?: string;
    pageWidthMm?: number;
    pageHeightMm?: number;
    textPosition?: TextPosition;
    fontStyle?: FontStyle;
    textColor?: string;
    backgroundColor?: string;
    logoDataUrl?: string;
    logoPosition?: LogoPosition;
    logoSizeRatio?: number;
  };

  // text는 선택적 — 빈 문자열이면 텍스트 오버레이 없이 이미지·로고만 합성한다.
  if (
    typeof pageWidthMm !== "number" ||
    typeof pageHeightMm !== "number" ||
    pageWidthMm <= 0 ||
    pageHeightMm <= 0
  ) {
    return jsonNoStore(
      { error: "pageWidthMm, pageHeightMm 값이 필요합니다." },
      { status: 400 },
    );
  }

  const canvasW = Math.round(pageWidthMm * PX_PER_MM);
  const canvasH = Math.round(pageHeightMm * PX_PER_MM);

  const validFontStyles: FontStyle[] = ["sans", "serif", "handwriting"];
  const resolvedFontStyle: FontStyle = validFontStyles.includes(fontStyle as FontStyle)
    ? (fontStyle as FontStyle)
    : "sans";

  const validPositions: TextPosition[] = ["top", "center", "bottom"];
  const resolvedPosition: TextPosition = validPositions.includes(textPosition as TextPosition)
    ? (textPosition as TextPosition)
    : "bottom";

  const hexRe = /^#[0-9a-fA-F]{6}$/;
  // 반투명 dark bar의 체감 배경색 (rgba(0,0,0,0.55) 위): WCAG 계산 기준
  const BAR_EFFECTIVE_BG = "#737373";
  const safeTextColor = hexRe.test(rawTextColor) ? rawTextColor : "#ffffff";
  // WCAG AA(4.5:1) 미달이면 bar 명도에 따라 흰색/검정으로 자동 전환
  const textColor =
    contrastRatio(safeTextColor, BAR_EFFECTIVE_BG) >= 4.5
      ? safeTextColor
      : relativeLuminance(BAR_EFFECTIVE_BG) > 0.5
        ? "#000000"
        : "#ffffff";

  // SVG 오버레이 생성 — text가 없으면 텍스트 레이어를 추가하지 않는다
  const hasText = typeof text === "string" && text.trim().length > 0;
  const svgBuffer = hasText
    ? buildSvgOverlay({
        canvasW,
        canvasH,
        text: text.trim(),
        position: resolvedPosition,
        fontStyle: resolvedFontStyle,
        textColor,
        barOpacity: 0.55,
      })
    : null;

  try {
    let base: Sharp;

    if (typeof imageDataUrl === "string") {
      const match = imageDataUrl.match(DATA_URL_RE);
      if (!match) {
        return jsonNoStore({ error: "imageDataUrl 형식이 올바르지 않습니다." }, { status: 400 });
      }
      base = sharp(Buffer.from(match[1], "base64")).resize(canvasW, canvasH, {
        fit: "cover",
        position: "centre",
      });
    } else {
      // 이미지 없음 → 단색 배경
      const bg = hexRe.test(backgroundColor) ? backgroundColor : "#1a1a1a";
      const rgb = hexToRgb(bg) ?? { r: 26, g: 26, b: 26 };
      base = sharp({
        create: { width: canvasW, height: canvasH, channels: 3, background: rgb },
      });
    }

    // 합성 레이어: [로고(선택), SVG 텍스트 오버레이] — 로고가 먼저 깔리고 텍스트 바가 위에 올라옴
    const composites: OverlayOptions[] = [];

    // 로고 합성 (logoDataUrl 제공 시)
    if (typeof logoDataUrl === "string") {
      try {
        const logoMatch = logoDataUrl.match(DATA_URL_RE);
        if (logoMatch) {
          const logoBuf = Buffer.from(logoMatch[1], "base64");
          const safeRatio = typeof logoSizeRatio === "number" && isFinite(logoSizeRatio)
            ? Math.min(0.35, Math.max(0.05, logoSizeRatio))
            : 0.18;
          const targetW = Math.round(canvasW * safeRatio);

          // PNG로 변환해 투명도 유지 (JPEG 로고도 커버)
          const resizedLogo = await sharp(logoBuf)
            .resize(targetW, undefined, { fit: "inside" })
            .png()
            .toBuffer();

          const meta = await sharp(resizedLogo).metadata();
          const lw = meta.width ?? targetW;
          const lh = meta.height ?? targetW;
          const pad = Math.round(canvasW * 0.03);

          const validPos: LogoPosition[] = ["top-left", "top-right", "bottom-left", "bottom-right"];
          const pos: LogoPosition = validPos.includes(logoPosition as LogoPosition)
            ? (logoPosition as LogoPosition)
            : "top-right";

          let left: number, top: number;
          if (pos === "top-left")      { left = pad;             top = pad; }
          else if (pos === "top-right")    { left = canvasW - lw - pad; top = pad; }
          else if (pos === "bottom-left")  { left = pad;             top = canvasH - lh - pad; }
          else                             { left = canvasW - lw - pad; top = canvasH - lh - pad; }

          composites.push({ input: resizedLogo, left, top });
        }
      } catch {
        // 로고 처리 실패 시 로고 없이 계속 진행
      }
    }

    if (svgBuffer) composites.push({ input: svgBuffer, top: 0, left: 0 });

    const pngBuffer = await base
      .composite(composites)
      .png({ compressionLevel: 6 })
      .toBuffer();

    return new NextResponse(new Uint8Array(pngBuffer), {
      headers: {
        "Content-Type": "image/png",
        // inline: 브라우저 미리보기, attachment: 강제 다운로드
        "Content-Disposition": 'inline; filename="overlay.png"',
        ...NO_STORE_HEADER,
      },
    });
  } catch (err) {
    console.error("[create-overlay-image]", err);
    return jsonNoStore({ error: "이미지 합성에 실패했습니다." }, { status: 500 });
  }
}
