"use client";

// Uploading a picture: check it, shrink it to 256x256, hand back a data URL.
// Everything runs in the browser; the file is never sent anywhere.

export const MAX_BYTES = 2 * 1024 * 1024;
export const SIZE = 256;
export const ACCEPT = "image/png,image/jpeg,image/webp,image/svg+xml";

const TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/svg+xml"]);

function mb(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export type UploadResult = { ok: true; dataUrl: string } | { ok: false; error: string };

/** Square-crops to the centre, so a portrait is not squashed. */
function draw(img: CanvasImageSource, w: number, h: number): string | null {
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const side = Math.min(w, h);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, (w - side) / 2, (h - side) / 2, side, side, 0, 0, SIZE, SIZE);
  const webp = canvas.toDataURL("image/webp", 0.88);
  return webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/jpeg", 0.88);
}

function readAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("read"));
    r.readAsDataURL(file);
  });
}

export async function processUpload(file: File): Promise<UploadResult> {
  if (!TYPES.has(file.type))
    return { ok: false, error: "That file type is not supported. Pick a PNG, JPG, WEBP or SVG picture." };
  if (file.size > MAX_BYTES)
    return { ok: false, error: `That picture is ${mb(file.size)}. Pick one under 2 MB.` };

  let src: string;
  try {
    src = await readAsDataUrl(file);
  } catch {
    return { ok: false, error: "That picture could not be read. Try a different file." };
  }

  const img = new Image();
  img.decoding = "sync";
  const loaded = await new Promise<boolean>((resolve) => {
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = src;
  });
  if (!loaded || !img.naturalWidth || !img.naturalHeight)
    return { ok: false, error: "That picture could not be read. Try a PNG or JPG instead." };

  const dataUrl = draw(img, img.naturalWidth, img.naturalHeight);
  if (!dataUrl) return { ok: false, error: "This browser could not resize that picture. Try a different file." };
  return { ok: true, dataUrl };
}
