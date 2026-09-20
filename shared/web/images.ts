/**
 * Shrink a photo in the browser before upload. Phones produce 12MP HEIC and
 * 4MB JPEGs; a listing needs neither. Output is always JPEG at most 1600px
 * on the long side, which also sidesteps formats the server cannot serve.
 */
const MAX_EDGE = 1600;
const QUALITY = 0.86;

export interface ResizedImage {
  blob: Blob;
  width: number;
  height: number;
}

export async function resizeImage(file: File): Promise<ResizedImage> {
  const bitmap = await decode(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Your browser could not process the photo.");
  ctx.drawImage(bitmap, 0, 0, width, height);
  if ("close" in bitmap) bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", QUALITY),
  );
  if (!blob) throw new Error("Your browser could not encode the photo.");
  return { blob, width, height };
}

async function decode(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if ("createImageBitmap" in window) {
    try {
      // imageOrientation honours EXIF rotation, so portrait phone shots stay upright.
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      // Fall through to the <img> path for formats createImageBitmap rejects.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () =>
        reject(new Error("That file is not an image this browser can read."));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
