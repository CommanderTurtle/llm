export function speechSettings(value = {}) {
  const pick = (key, allowed, fallback) => allowed.includes(value[key]) ? value[key] : fallback;
  return {
    stt: pick("stt", ["off", "v1", "v2"], "off"),
    bark: pick("bark", ["bark", "bark-plus", "bark-clean"], "bark"),
    language: pick("language", ["", "en", "es", "fr", "de", "it", "pl", "nl"], ""),
    tts: pick("tts", ["paradee", "kokoro"], "paradee"),
    paradeeVoice: typeof value.paradeeVoice === "string" ? value.paradeeVoice : "af_heart",
    kokoroVoice: typeof value.kokoroVoice === "string" ? value.kokoroVoice : "af_heart",
    speed: Math.max(0.5, Math.min(2, Number(value.speed) || 1)),
    phonemes: value.phonemes === true,
  };
}
