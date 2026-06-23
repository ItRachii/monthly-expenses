// In-browser OCR via Tesseract.js. The library, its WASM core, and the English
// model are fetched lazily from jsDelivr the first time scanning is used (so
// nothing is added to the main bundle), and the image itself is processed
// entirely on-device — it is never uploaded anywhere.

export interface OcrProgress {
  /** 1-based index of the image being read. */
  file: number;
  files: number;
  /** 0..1 recognition progress for the current image. */
  progress: number;
}

/** Runs OCR over one or more images and returns their concatenated text. */
export async function ocrImages(
  files: File[],
  onProgress?: (p: OcrProgress) => void,
): Promise<string> {
  const { createWorker } = await import("tesseract.js");
  let current = 0;
  const worker = await createWorker("eng", 1, {
    logger: (m: { status: string; progress: number }) => {
      if (onProgress && m.status === "recognizing text") {
        onProgress({ file: current + 1, files: files.length, progress: m.progress });
      }
    },
  });
  try {
    const texts: string[] = [];
    for (let i = 0; i < files.length; i++) {
      current = i;
      const { data } = await worker.recognize(files[i]);
      texts.push(data.text);
    }
    return texts.join("\n");
  } finally {
    await worker.terminate();
  }
}
