// Re-encodes a picked receipt image as JPEG before it is sent for scanning:
// it keeps the upload under the server's size limit (screenshots saved as
// PNG are often several MB) and turns formats the scanner cannot read, such
// as HEIC where the browser can open it, into one it can. Browser-only.

const MAX_WIDTH = 1600;
const MAX_PIXELS = 12_000_000;
const MAX_BYTES = 4 * 1024 * 1024;

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

/** The image as a JPEG within the size limits, or the original file if the browser cannot open it. */
export async function prepareImage(file: File): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file; // the scanner says whether it can read it
  }
  try {
    const scale = Math.min(1, MAX_WIDTH / bitmap.width, Math.sqrt(MAX_PIXELS / (bitmap.width * bitmap.height)));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    // JPEG has no transparency: put it on white, like paper.
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.9, 0.75, 0.6]) {
      const blob = await toBlob(canvas, quality);
      if (blob && blob.size <= MAX_BYTES) return blob;
    }
    return file;
  } finally {
    bitmap.close();
  }
}
