import { executeTool } from "../src/tools.js";
import { terminateOcrWorker } from "../src/ocr.js";

const status = document.querySelector("#status");
const output = document.querySelector("#output");
const buttons = [...document.querySelectorAll("button")];

async function screenshot() {
  const image = new Image();
  image.src = new URL("./fixtures/ocr.svg", import.meta.url).href;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  canvas.getContext("2d").drawImage(image, 0, 0);
  return canvas.toDataURL("image/png");
}

async function check(engine) {
  for (const button of buttons) button.disabled = true;
  status.textContent = `Running ${engine}…`;
  try {
    const text = await executeTool({
      function: { name: "ocr_attachment", arguments: '{"attachment":"fixture.png"}' },
    }, {
      integrations: { ocr: { enabled: true, engine } },
      attachments: [{ id: "fixture", name: "fixture.png", kind: "image", dataUrl: await screenshot() }],
      onProgress(label) { status.textContent = `${engine}: ${label}`; },
    });
    output.textContent += `${engine}:\n${text}\n\n`;
    if (!["LOCAL OCR FIXTURE", "Paddle and Tesseract", "Browser only 12345"].every((line) => text.includes(line))) {
      throw new Error("Recognized output did not match all three fixture lines.");
    }
    status.textContent = `PASS: ${engine} recognized all three lines through ocr_attachment.`;
  } catch (error) {
    status.textContent = `FAIL: ${engine}: ${error.message}`;
  } finally {
    for (const button of buttons) button.disabled = false;
  }
}

for (const engine of ["tesseract", "paddle"]) document.querySelector(`#${engine}`).addEventListener("click", () => check(engine));
document.querySelector("#release").addEventListener("click", async () => {
  await terminateOcrWorker();
  status.textContent = "OCR worker released.";
});
