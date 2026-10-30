export function normalizeOcrSettings(value = {}) {
  return {
    enabled: value?.enabled !== false,
    engine: value?.engine === "paddle" ? "paddle" : "tesseract",
  };
}

export function ocrMode(value) {
  const settings = normalizeOcrSettings(value);
  return settings.enabled ? (settings.engine === "paddle" ? "v2" : "v1") : "off";
}

export function ocrSettings(mode, previous) {
  const settings = normalizeOcrSettings(previous);
  if (mode === "off") return { ...settings, enabled: false };
  return { enabled: true, engine: mode === "v2" ? "paddle" : "tesseract" };
}
