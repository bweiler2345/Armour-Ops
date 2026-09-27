// Browser-only preparation of a chosen file before upload, using built-in
// browser features (no extra packages). Pictures are turned into a JPEG of
// at most 5 MB; videos have their length read.

import { checkVideoLength, fitWithin, PHOTO_LIMITS } from "./files";

export class PrepareError extends Error {}

const UNREADABLE_PICTURE =
  "This phone couldn’t open that picture. Take it again, or choose a JPEG or PNG. On iPhone, Settings › Camera › Formats › Most Compatible also works.";

// Decodes the picture upright (phones store rotation separately).
async function decode(file: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch {
      // Some browsers only decode HEIC through an <img>; try that below.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => undefined };
  } catch {
    throw new PrepareError(UNREADABLE_PICTURE);
  } finally {
    // The decoded image stays usable after the link is released.
    URL.revokeObjectURL(url);
  }
}

function toJpeg(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

// Resizes and compresses one picture until it fits the 5 MB limit: the
// largest size first, then lower quality, then smaller sizes.
export async function preparePhoto(file: Blob): Promise<Blob> {
  const image = await decode(file);
  const canvas = document.createElement("canvas");
  try {
    if (image.width < 1 || image.height < 1) throw new PrepareError(UNREADABLE_PICTURE);
    for (const edge of PHOTO_LIMITS.longEdges) {
      const size = fitWithin(image.width, image.height, edge);
      canvas.width = size.width;
      canvas.height = size.height;
      const context = canvas.getContext("2d");
      if (!context) throw new PrepareError(UNREADABLE_PICTURE);
      context.fillStyle = "#fff";
      context.fillRect(0, 0, size.width, size.height);
      context.drawImage(image.source, 0, 0, size.width, size.height);
      for (const quality of PHOTO_LIMITS.qualities) {
        const blob = await toJpeg(canvas, quality);
        if (!blob) throw new PrepareError(UNREADABLE_PICTURE);
        if (blob.size <= PHOTO_LIMITS.compressedMaxBytes) return blob;
      }
    }
    throw new PrepareError("That picture couldn’t be made small enough to upload. Take it again.");
  } finally {
    image.close();
    // Frees the canvas memory right away on phones.
    canvas.width = 0;
    canvas.height = 0;
  }
}

// Reads a video's length without loading the whole file.
export function readVideoDuration(file: Blob): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    const done = (fn: () => void) => {
      window.clearTimeout(timer);
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
      fn();
    };
    const timer = window.setTimeout(
      () => done(() => reject(new PrepareError("Couldn’t read how long that video is. Try recording it again."))),
      20_000,
    );
    video.preload = "metadata";
    video.muted = true;
    video.onloadedmetadata = () => {
      const seconds = video.duration;
      done(() => {
        const problem = checkVideoLength(seconds);
        if (problem) reject(new PrepareError(problem));
        else resolve(seconds);
      });
    };
    video.onerror = () =>
      done(() => reject(new PrepareError("This phone couldn’t open that video. Use a MOV or MP4 video.")));
    video.src = url;
  });
}
