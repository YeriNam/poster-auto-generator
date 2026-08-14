import { computeLayout, type LayoutImageInput } from "@/app/lib/layoutEngine";
import { describeLayoutError } from "@/app/lib/layoutError";
import { jsonNoStore } from "@/app/lib/httpResponse";

export async function POST(request: Request) {
  let body: {
    text?: unknown;
    images?: unknown;
    pageWidthMm?: unknown;
    pageHeightMm?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return jsonNoStore(
      { error: "요청 형식이 올바르지 않습니다." },
      { status: 400 },
    );
  }

  const { text, images, pageWidthMm, pageHeightMm } = body;
  if (
    typeof text !== "string" ||
    typeof pageWidthMm !== "number" ||
    typeof pageHeightMm !== "number" ||
    pageWidthMm <= 0 ||
    pageHeightMm <= 0 ||
    !Array.isArray(images)
  ) {
    return jsonNoStore(
      {
        error:
          "text, images(배열), pageWidthMm, pageHeightMm 값이 필요합니다.",
      },
      { status: 400 },
    );
  }

  const parsedImages: LayoutImageInput[] = [];
  for (const item of images) {
    if (
      typeof item !== "object" ||
      item === null ||
      typeof (item as { number?: unknown }).number !== "number"
    ) {
      return jsonNoStore(
        { error: "images 배열의 각 항목은 { number } 형태여야 합니다." },
        { status: 400 },
      );
    }
    const { number, aspectRatio, requiredMinDisplayWidthPx } = item as {
      number: number;
      aspectRatio?: unknown;
      requiredMinDisplayWidthPx?: unknown;
    };
    parsedImages.push({
      number,
      aspectRatio: typeof aspectRatio === "number" ? aspectRatio : undefined,
      requiredMinDisplayWidthPx:
        typeof requiredMinDisplayWidthPx === "number"
          ? requiredMinDisplayWidthPx
          : undefined,
    });
  }

  const layout = computeLayout({
    text,
    images: parsedImages,
    pageWidthMm,
    pageHeightMm,
  });
  const layoutError = describeLayoutError(layout);
  return jsonNoStore({ ...layout, ...layoutError });
}
