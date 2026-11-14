import { speechSettings } from "./speech-settings.js";

const micIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/></svg>';
const voiceLanguages = { a: "English · US", b: "English · UK", e: "Spanish", f: "French", h: "Hindi", i: "Italian", p: "Portuguese", j: "Japanese · phonemes", z: "Chinese · phonemes" };
const paradeeVoices = ["af_heart", "bf_isabella", "am_puck", "bm_fable", "hf_alpha", "hm_omega", "ff_siwis", "em_alex"];
const runtime = () => import("../resources/speech/speech.js");
let catalog;
async function voiceCatalog() {
  catalog ||= fetch(new URL("../resources/speech/assets.lock.json", import.meta.url)).then(async (response) => {
    if (!response.ok) throw Error("Speech catalog could not be loaded.");
    return response.json();
  }).catch((error) => { catalog = null; throw error; });
  return catalog;
}
function button(label, action) {
  const node = document.createElement("button"); node.type = "button"; node.textContent = label; node.onclick = action; return node;
}
function select(values) {
  const node = document.createElement("select");
  for (const [value, label] of values) { const option = document.createElement("option"); option.value = value; option.textContent = label; node.append(option); }
  return node;
}
function field(label, node) {
  const wrapper = document.createElement("label"); wrapper.append(document.createTextNode(label), node); return wrapper;
}

export function createSpeechUI({ getSettings, saveSettings, getSession, appendText, busy, changed, notify }) {
  const micButton = document.querySelector("#microphone");
  const strip = document.querySelector("#speech-strip"), wave = document.querySelector("#speech-wave");
  const status = document.querySelector("#speech-status"), pending = document.querySelector("#speech-pending");
  const bark = document.querySelector("#stt-bark"), language = document.querySelector("#stt-language");
  const modes = [...document.querySelectorAll('[name="stt-mode"]')];
  let recording = null, player = null;
  micButton.innerHTML = micIcon;
  const settings = () => speechSettings(getSettings());
  const save = (patch) => saveSettings(speechSettings({ ...settings(), ...patch }));
  const active = () => Boolean(recording);
  function refresh() {
    const value = settings();
    for (const mode of modes) { mode.checked = mode.value === value.stt; mode.disabled = active(); }
    bark.value = value.bark; bark.disabled = active() || value.stt !== "v1";
    language.value = value.language; language.disabled = active() || value.stt !== "v2";
    micButton.disabled = !recording && (value.stt === "off" || busy());
    micButton.title = value.stt === "off" ? "Enable local speech input in Browser tools" : recording ? "Stop microphone" : "Start microphone";
    micButton.setAttribute("aria-label", micButton.title);
    micButton.setAttribute("aria-pressed", String(active()));
    micButton.classList.toggle("recording", active());
  }
  for (const mode of modes) mode.onchange = () => { save({ stt: mode.value }); refresh(); };
  bark.onchange = () => save({ bark: bark.value });
  language.onchange = () => save({ language: language.value });
  function finish(record) {
    if (recording !== record) return;
    recording = null;
    record.mic?.cancel(); record.engine?.close();
    if (record.context?.state !== "closed") void record.context?.close();
    pending.textContent = ""; strip.hidden = true; refresh(); changed();
  }
  function cancelRecording() { if (recording) finish(recording); }
  async function stopRecording() {
    const record = recording;
    if (!record) return;
    if (!record.mic) { finish(record); return; }
    status.textContent = "Finishing transcription…";
    try { await record.mic.stop(); }
    catch (error) { if (error.name !== "AbortError") notify(error.message); }
    finally { finish(record); }
  }
  micButton.onclick = async () => {
    if (recording) { await stopRecording(); return; }
    if (busy() || settings().stt === "off") return;
    if (!navigator.mediaDevices?.getUserMedia) { notify("Microphone requires HTTPS or localhost."); return; }
    player?.close();
    const value = settings(), model = value.stt === "v1" ? value.bark : "whistle";
    const record = { target: getSession(), context: null, engine: null, mic: null };
    recording = record; strip.hidden = false; pending.textContent = "";
    status.textContent = "Loading local speech input…"; refresh(); changed();
    try {
      record.context = new AudioContext();
      await record.context.resume();
      const [{ SpeechEngine }, { Microphone, paintWave }] = await Promise.all([runtime(), import("../resources/speech/microphone.js")]);
      if (recording !== record) return;
      record.engine = new SpeechEngine({ onStatus: (text) => { if (recording === record) status.textContent = text; } });
      await record.engine.load(model, { language: value.language });
      if (recording !== record) return;
      record.mic = new Microphone({ context: record.context,
        onWave: (data) => paintWave(wave, data),
        onResult: (result) => {
          if (recording !== record) return;
          if (result.text) appendText(record.target, result.text);
          pending.textContent = result.pending || "";
        },
        onError: (error) => notify(error.message),
        onEnd: () => finish(record),
      });
      await record.mic.start(record.engine, { stream: model === "whistle" });
      if (recording === record) status.textContent = "Listening · tap microphone to finish";
    } catch (error) {
      if (recording === record) { notify(error.message); finish(record); }
    }
  };
  function speak(text) {
    cancelRecording(); player?.close();
    const dialog = document.createElement("dialog"); dialog.className = "speech-player";
    dialog.setAttribute("aria-label", "Speak aloud");
    const heading = document.createElement("h2"); heading.textContent = "Speak aloud";
    const top = document.createElement("header"); top.append(heading, button("Close", () => dialog.close()));
    const model = select([["paradee", "Paradee 1.3 · 8M"], ["kokoro", "Kokoro · full 82M"]]);
    const voice = select([]), inputMode = select([["text", "Text"], ["phonemes", "Model phonemes"]]);
    const speed = document.createElement("input"); speed.type = "number"; speed.min = "0.5"; speed.max = "2"; speed.step = "0.05"; speed.required = true;
    const script = document.createElement("textarea"); script.rows = 6; script.value = text; script.setAttribute("aria-label", "Text to speak");
    const info = document.createElement("p"); info.className = "hint"; info.setAttribute("role", "status");
    const audio = document.createElement("audio"); audio.controls = true; audio.preload = "metadata";
    const controls = document.createElement("div"); controls.className = "speech-player-actions";
    const download = document.createElement("a"); download.textContent = "Save WAV"; download.download = "speech.wav"; download.hidden = true;
    const play = button("Play / pause", () => { if (audio.src) { if (audio.paused) void audio.play().catch((error) => { info.textContent = error.message; }); else audio.pause(); } });
    controls.append(button("−10s", () => { if (audio.src) audio.currentTime = Math.max(0, audio.currentTime - 10); }), play,
      button("+10s", () => { if (audio.src) audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 10); }), download);
    let engine = null, audioURL = null, job = 0, closed = false, catalogJob = 0;
    const initial = settings(); model.value = initial.tts; speed.value = String(initial.speed); inputMode.value = initial.phonemes ? "phonemes" : "text";
    const remember = () => save({ tts: model.value, [`${model.value}Voice`]: voice.value, speed: Number(speed.value), phonemes: inputMode.value === "phonemes" });
    const clearAudio = () => {
      audio.pause(); audio.removeAttribute("src"); audio.load();
      if (audioURL) URL.revokeObjectURL(audioURL);
      audioURL = null; download.hidden = true; download.removeAttribute("href");
    };
    const setBusy = (value) => { model.disabled = voice.disabled = inputMode.disabled = speed.disabled = script.disabled = value; generate.disabled = value || !voice.value; cancel.hidden = !value; };
    const cancel = button("Cancel", () => { job++; engine?.close(); engine = null; setBusy(false); info.textContent = "Cancelled"; }); cancel.hidden = true;
    const generate = button("Generate", async () => {
      if (!speed.reportValidity()) return;
      if (!script.value.trim()) { info.textContent = "Enter text to speak."; return; }
      const phonemes = inputMode.value === "phonemes";
      if (!phonemes && ["j", "z"].includes(voice.value[0])) { info.textContent = "This voice needs model-native phonemes. Select Model phonemes and supply phonetic input."; return; }
      remember(); clearAudio(); const id = ++job; setBusy(true);
      const options = { voice: voice.value, speed: Number(speed.value), phonemes };
      try {
        const { SpeechEngine, speechSegments, wavBlob } = await runtime();
        if (closed || id !== job) return;
        engine = new SpeechEngine({ onStatus: (text) => { if (!closed && id === job) info.textContent = text; } });
        await engine.load(model.value, options);
        const parts = speechSegments(script.value), chunks = [];
        for (let i = 0; i < parts.length; i++) {
          if (closed || id !== job) return;
          info.textContent = `Speaking · phrase ${i + 1} of ${parts.length}`;
          try { chunks.push((await engine.call("speak", { text: parts[i] })).pcm); }
          catch (error) {
            if (error.message.includes("510 phonemes") && parts[i].length > 2) {
              const mid = Math.floor(parts[i].length / 2), space = parts[i].lastIndexOf(" ", mid), cut = space > 0 ? space : mid;
              parts.splice(i, 1, parts[i].slice(0, cut), parts[i].slice(cut)); i--; continue;
            }
            throw error;
          }
        }
        if (closed || id !== job) return;
        audioURL = URL.createObjectURL(wavBlob(chunks)); audio.src = audioURL;
        download.href = audioURL; download.hidden = false; info.textContent = "Ready";
        void audio.play().catch(() => { if (!closed) info.textContent = "Ready · press play"; });
      } catch (error) { if (!closed && id === job) info.textContent = error.message; }
      finally { if (id === job) { engine?.close(); engine = null; if (!closed) setBusy(false); } }
    });
    async function voices() {
      const id = ++catalogJob; generate.disabled = true; voice.replaceChildren();
      try {
        const names = model.value === "paradee" ? paradeeVoices : Object.keys((await voiceCatalog()).kokoro).filter((key) => key.startsWith("voices/")).map((key) => key.slice(7, -4));
        if (closed || id !== catalogJob) return;
        for (const name of names) { const option = document.createElement("option"); option.value = name; option.textContent = `${voiceLanguages[name[0]] || name[0]} · ${name.slice(3).replaceAll("_", " ")}`; voice.append(option); }
        const previous = settings()[`${model.value}Voice`]; voice.value = names.includes(previous) ? previous : names[0];
        info.textContent = model.value === "paradee" ? "Eight voices · English, Hindi, French, Spanish" : "Full model · selected voice loads on demand. Japanese/Chinese use model phonemes.";
        generate.disabled = false; remember();
      } catch (error) { if (!closed && id === catalogJob) info.textContent = error.message; }
    }
    model.onchange = () => { save({ tts: model.value }); void voices(); };
    voice.onchange = speed.onchange = inputMode.onchange = remember;
    const fields = document.createElement("div"); fields.className = "speech-player-fields";
    fields.append(field("Model", model), field("Voice", voice), field("Speed", speed), field("Input", inputMode));
    const actions = document.createElement("div"); actions.className = "speech-player-actions"; actions.append(generate, cancel);
    dialog.append(top, fields, field("Script", script), info, actions, audio, controls);
    dialog.addEventListener("close", () => { closed = true; job++; engine?.close(); engine = null; clearAudio(); dialog.remove(); if (player === dialog) player = null; }, { once: true });
    document.body.append(dialog); player = dialog; dialog.showModal(); void voices();
  }
  function dispose() { cancelRecording(); player?.close(); }
  return { refresh, active, speak, stopRecording, cancelRecording, dispose };
}
