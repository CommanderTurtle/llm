export function isImageSizeError(error) {
  const value = `${error?.message ?? ""}\n${error?.detail ?? ""}`.toLowerCase();
  const looksLikeValueError = value.includes("valueerror") || value.includes("invalid image") || value.includes("image input");
  const looksLikeDimensions = /resolution|dimension|width|height|pixels?|image size|too (?:large|big)|maximum.*image|exceed/.test(value);
  return looksLikeValueError && looksLikeDimensions;
}

function dataUrlBlob(dataUrl) {
  const [header, body = ""] = String(dataUrl).split(",", 2);
  const type = header.match(/^data:([^;,]+)/i)?.[1] || "image/png";
  const binary = header.includes(";base64") ? atob(body) : decodeURIComponent(body);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type });
}

function blobDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result)), { once: true });
    reader.addEventListener("error", () => reject(reader.error || new Error("Could not encode resized image.")), { once: true });
    reader.readAsDataURL(blob);
  });
}

async function imageSource(dataUrl) {
  const blob = dataUrlBlob(dataUrl);
  if (globalThis.createImageBitmap) {
    const bitmap = await createImageBitmap(blob);
    return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
  }
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return { source: image, width: image.naturalWidth, height: image.naturalHeight, close() {} };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function nextImageDimensions(widthValue, heightValue, decrement = 128) {
  const width = Math.max(1, Math.trunc(Number(widthValue) || 0));
  const height = Math.max(1, Math.trunc(Number(heightValue) || 0));
  const step = Math.max(1, Math.trunc(Number(decrement) || 128));
  const longest = Math.max(width, height);
  if (longest <= step) throw new Error(`The image cannot be reduced by another ${step} pixels.`);
  const ratio = (longest - step) / longest;
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
}

export async function downscaleDataUrl(dataUrl, decrement = 128) {
  const image = await imageSource(dataUrl);
  try {
    const { width, height } = nextImageDimensions(image.width, image.height, decrement);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) throw new Error("Canvas is unavailable for image retry.");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(image.source, 0, 0, width, height);
    const originalType = dataUrl.match(/^data:([^;,]+)/i)?.[1]?.toLowerCase();
    const outputType = originalType === "image/jpeg" || originalType === "image/webp" ? originalType : "image/png";
    const blob = await new Promise((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("The browser could not resize the image.")), outputType, 0.92));
    return { dataUrl: await blobDataUrl(blob), width, height, originalWidth: image.width, originalHeight: image.height };
  } finally {
    image.close();
  }
}

export async function downscaleImageOverrides(attachments, previous = new Map(), decrement = 128) {
  const overrides = new Map(previous);
  const resized = [];
  for (const attachment of attachments) {
    if (attachment.kind !== "image" || !attachment.dataUrl) continue;
    const source = overrides.get(attachment.id)?.dataUrl || attachment.dataUrl;
    const next = await downscaleDataUrl(source, decrement);
    overrides.set(attachment.id, next);
    resized.push({ id: attachment.id, name: attachment.name, ...next });
  }
  if (!resized.length) throw new Error("The endpoint rejected image dimensions, but this request contains no browser-resizable image.");
  return { overrides, resized };
}
