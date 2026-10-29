// src/options.js
var e = Object.freeze({
	textDetLimitSideLen: 320,
	textDetLimitType: "min",
	textDetMaxSideLimit: 4e3,
	textDetThresh: .3,
	textDetBoxThresh: .5,
	textDetUnclipRatio: 1.6,
	textRecScoreThresh: .5
});
function t(t = {}) {
	let n = {};
	for (let [r, i] of Object.entries(t)) {
		if (!Object.hasOwn(e, r)) throw Error(`Unsupported OCR parameter: ${r}. Tesseract PSM/OEM/whitelist settings are not Paddle settings.`);
		if (r === "textDetLimitType") {
			if (!["min", "max"].includes(i)) throw Error(`${r} must be min or max.`);
		} else if (typeof i != "number" || !Number.isFinite(i) || (r.endsWith("Thresh") ? i < 0 || i > 1 : i <= 0) || r.includes("Side") && i > 8192 || r === "textDetUnclipRatio" && i > 10) throw Error(`Invalid OCR parameter: ${r}`);
		n[r] = i;
	}
	return n;
}
function n(e = {}, t = !1) {
	let n = e.backend ?? "wasm";
	if (![
		"wasm",
		"webgpu",
		"auto"
	].includes(n)) throw Error("backend must be wasm, webgpu, or auto.");
	let r = e.numThreads ?? 1;
	if (!Number.isInteger(r) || r < 1 || r > 8) throw Error("numThreads must be an integer from 1 to 8.");
	if (r > 1 && !t) throw Error("Threaded WASM requires cross-origin isolation (COOP/COEP). Use numThreads: 1 on ordinary static hosting.");
	return {
		backend: n,
		numThreads: r,
		simd: !0,
		proxy: !1
	};
}
// src/image.js
function r(e) {
	let t = e.indexOf(",");
	if (t < 5 || e.length > 50331648) throw Error("Invalid or oversized data URL.");
	let n = e.slice(5, t), r = e.slice(t + 1), i;
	if (/;base64$/i.test(n)) {
		let e = atob(decodeURIComponent(r));
		i = new Uint8Array(e.length);
		for (let t = 0; t < e.length; t++) i[t] = e.charCodeAt(t);
	} else {
		i = new Uint8Array(r.length);
		let e = 0;
		for (let t = 0; t < r.length; t++) if (r[t] === "%") {
			let n = r.slice(t + 1, t + 3);
			if (!/^[0-9a-f]{2}$/i.test(n)) throw Error("Invalid data URL escape.");
			i[e++] = parseInt(n, 16), t += 2;
		} else i[e++] = r.charCodeAt(t);
		i = i.subarray(0, e);
	}
	if (i.length > 33554432) throw Error("Image input exceeds 32 MiB.");
	return new Blob([i], { type: n.split(";")[0] || "application/octet-stream" });
}
async function i(e, t = {}) {
	let { signal: n, rectangle: i, maxPixels: a = 16e6 } = t;
	if (n?.throwIfAborted(), typeof e == "string" || e instanceof URL) {
		let t = new URL(String(e), document.baseURI);
		if (![
			"http:",
			"https:",
			"data:",
			"blob:"
		].includes(t.protocol)) throw Error("Unsupported image URL protocol.");
		if (t.protocol === "data:") e = r(t.href);
		else {
			let r = await fetch(t, {
				signal: n,
				credentials: "omit"
			});
			if (!r.ok) throw Error(`Image request failed: HTTP ${r.status}`);
			let i = r.body.getReader(), a = [], o = 0;
			try {
				for (;;) {
					let { value: e, done: t } = await i.read();
					if (t) break;
					if (o += e.length, o > 33554432) throw Error("Image input exceeds 32 MiB.");
					a.push(e);
				}
			} finally {
				await i.cancel().catch(() => {});
			}
			e = new Blob(a, { type: r.headers.get("Content-Type") || "" });
		}
	}
	if ((e instanceof ArrayBuffer || ArrayBuffer.isView(e)) && (e = new Blob([e])), e instanceof Blob && e.size > 33554432) throw Error("Image input exceeds 32 MiB.");
	e instanceof HTMLImageElement && await e.decode();
	let o = await createImageBitmap(e);
	try {
		n?.throwIfAborted();
		let e = i ?? {
			left: 0,
			top: 0,
			width: o.width,
			height: o.height
		};
		if (![
			e.left,
			e.top,
			e.width,
			e.height
		].every(Number.isInteger) || e.left < 0 || e.top < 0 || e.width < 1 || e.height < 1 || e.left + e.width > o.width || e.top + e.height > o.height) throw Error("Image rectangle is outside the source image.");
		if (!Number.isInteger(a) || a < 1 || a > 64e6 || e.width * e.height > a) throw Error("Image exceeds the pixel limit. Crop it or raise maxPixels explicitly (maximum 64 million).");
		let t = document.createElement("canvas");
		t.width = e.width, t.height = e.height;
		let r = t.getContext("2d", { willReadFrequently: !0 });
		return r.fillStyle = "#fff", r.fillRect(0, 0, e.width, e.height), r.drawImage(o, e.left, e.top, e.width, e.height, 0, 0, e.width, e.height), {
			pixels: r.getImageData(0, 0, e.width, e.height).data.buffer,
			width: e.width,
			height: e.height,
			offset: {
				x: e.left,
				y: e.top
			},
			image: {
				width: o.width,
				height: o.height
			}
		};
	} finally {
		o.close();
	}
}
// src/layout.js
var a = (e) => e.sort((e, t) => e - t)[Math.floor(e.length / 2)], o = (e) => Array.from(e).length, s = (e) => {
	let t = Math.floor(e);
	return e - t === .5 ? t + t % 2 : Math.round(e);
};
function c(e, t = !0) {
	return !t || /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/u.test(e) ? e : e.replace(/[\uff01-\uff5e\u3000]/gu, (e) => e.normalize("NFKC"));
}
function l(e, t = {}, n = {
	x: 0,
	y: 0
}) {
	let r = e.items.filter((e) => e.text.trim()).map((e) => {
		let r = e.poly.map(([e, t]) => [e + n.x, t + n.y]), i = r.map((e) => e[0]), a = r.map((e) => e[1]), o = {
			x0: Math.min(...i),
			y0: Math.min(...a),
			x1: Math.max(...i),
			y1: Math.max(...a)
		};
		return {
			text: c(e.text, t.asciiPunctuation !== !1),
			confidence: Math.max(0, Math.min(100, e.score * 100)),
			polygon: r,
			bbox: o,
			cy: (o.y0 + o.y1) / 2,
			height: o.y1 - o.y0
		};
	}).sort((e, t) => e.cy - t.cy), i = [];
	for (let e of r) {
		let t = i.at(-1), n = t && t.reduce((e, t) => e + t.cy, 0) / t.length, r = t && t.reduce((e, t) => e + t.height, 0) / t.length;
		t && Math.abs(e.cy - n) < .5 * Math.min(r, e.height) ? t.push(e) : i.push([e]);
	}
	let l = r.filter((e) => o(e.text) > 1).map((e) => (e.bbox.x1 - e.bbox.x0) / o(e.text)), u = Math.max(.1, l.length ? a(l) : 10), d = r.length ? Math.min(...r.map((e) => e.bbox.x0)) : 0, f = r.length ? a(r.map((e) => e.height)) : 0, p = [], m = [], h;
	for (let e of i) {
		e.sort((e, t) => e.bbox.x0 - t.bbox.x0);
		let t = {
			x0: Math.min(...e.map((e) => e.bbox.x0)),
			y0: Math.min(...e.map((e) => e.bbox.y0)),
			x1: Math.max(...e.map((e) => e.bbox.x1)),
			y1: Math.max(...e.map((e) => e.bbox.y1))
		};
		h !== void 0 && t.y0 - h > .9 * f && m.push(""), h = t.y1;
		let n = " ".repeat(Math.min(1e3, Math.max(0, s((e[0].bbox.x0 - d) / u)))) + e[0].text;
		for (let t = 1; t < e.length; t++) {
			let r = s((e[t].bbox.x0 - e[t - 1].bbox.x1) / u);
			n += " ".repeat(Math.min(1e3, Math.max(1, r >= 3 ? r : 1))) + e[t].text;
		}
		n = n.trimEnd();
		let r = e.reduce((e, t) => e + o(t.text), 0), i = e.reduce((e, t) => e + t.confidence * o(t.text), 0) / r;
		p.push({
			text: n,
			confidence: i,
			bbox: t,
			items: e,
			words: []
		}), m.push(n);
	}
	let g = r.reduce((e, t) => e + o(t.text), 0);
	return { data: {
		text: m.length ? m.join("\n") + "\n" : "",
		confidence: g ? r.reduce((e, t) => e + t.confidence * o(t.text), 0) / g : 0,
		lines: p,
		words: [],
		blocks: p.length ? [{ paragraphs: [{ lines: p }] }] : [],
		items: r,
		image: e.image,
		metrics: e.metrics,
		runtime: e.runtime,
		engine: "PP-OCRv6",
		geometryLevel: "line"
	} };
}
// src/index.js
async function u(r = "eng", a, o = {}) {
	if (r && typeof r == "object" && !Array.isArray(r)) o = r, r = "eng";
	else if (a && typeof a == "object") o = a;
	else if (a !== void 0 && a !== 1) throw Error("Tesseract OEM selection is not supported by PaddleOCR. Omit the OEM argument.");
	let s = Array.isArray(r) ? r : String(r).split("+");
	if (!s.length || s.some((e) => ![
		"eng",
		"en",
		"multi"
	].includes(e))) throw Error("This bundle uses the multilingual PP-OCRv6 small model. Use eng or multi; Tesseract traineddata packs are not supported.");
	for (let e of [
		"corePath",
		"langPath",
		"tessedit_pageseg_mode"
	]) if (e in o) throw Error(`${e} is a Tesseract setting. Supply runtimePath/modelPath or Paddle parameters instead.`);
	let c = n(o, globalThis.crossOriginIsolated === !0);
	o.signal?.throwIfAborted();
	let u = import.meta.url, d = (e, t) => new URL(e ? String(e).replace(/\/?$/, "/") : t, u).href, f = d(o.modelPath, "models/"), p = d(o.runtimePath, "runtime/"), m = o.timeoutMs ?? 12e4;
	if (!Number.isFinite(m) || m < 1e3) throw Error("timeoutMs must be at least 1000.");
	let h = (e) => {
		try {
			o.logger?.(e);
		} catch {}
	}, g = {
		...e,
		...t(o.parameters)
	}, _ = !1, v = 0, y = o.workerPath ? new Worker(new URL(o.workerPath, u), { type: "module" }) : new Worker(new URL(
		/* @vite-ignore */
		new URL("assets/worker-B_P0Qz0f.js", import.meta.url).href,
		"" + import.meta.url
	), { type: "module" }), b = /* @__PURE__ */ new Map();
	function x(e = Error("OCR worker was terminated.")) {
		if (!_) {
			_ = !0, y.terminate();
			for (let t of b.values()) clearTimeout(t.timer), t.reject(e);
			b.clear();
		}
	}
	function S(e, t, n = []) {
		return _ ? Promise.reject(Error("OCR worker was terminated. Create a new worker.")) : new Promise((r, i) => {
			let a = ++v, o = setTimeout(() => x(Error("OCR timed out. The worker was stopped.")), m);
			b.set(a, {
				resolve: r,
				reject: i,
				timer: o
			});
			try {
				y.postMessage({
					id: a,
					operation: e,
					payload: t
				}, n);
			} catch (e) {
				b.delete(a), clearTimeout(o), i(e);
			}
		});
	}
	y.onmessage = ({ data: e }) => {
		let t = b.get(e.id);
		t && (b.delete(e.id), clearTimeout(t.timer), e.error ? t.reject(Object.assign(Error(e.error.message), { name: e.error.name })) : t.resolve(e.result));
	}, y.onerror = (e) => {
		e.preventDefault(), x(Error(e.message || "OCR worker failed to load. Check the complete dist and CSP."));
	}, y.onmessageerror = () => x(Error("Could not read the OCR worker response.")), h({
		status: "loading OCR engine",
		progress: 0
	});
	let C, w = () => x(o.signal.reason ?? new DOMException("Aborted", "AbortError"));
	o.signal?.addEventListener("abort", w, { once: !0 });
	try {
		o.signal?.throwIfAborted(), C = await S("init", {
			runtime: c,
			runtimePath: p,
			parameters: g,
			detection: new URL("PP-OCRv6_small_det.tar", f).href,
			recognition: new URL("PP-OCRv6_small_rec.tar", f).href
		}), h({
			status: "initialized API",
			progress: 1
		}), o.signal?.throwIfAborted();
	} catch (e) {
		throw x(e), e;
	} finally {
		o.signal?.removeEventListener("abort", w);
	}
	return {
		async recognize(e, n = {}, r = { text: !0 }) {
			if (_) throw Error("OCR worker was terminated. Create a new worker.");
			for (let e of Object.keys(n)) if (![
				"rectangle",
				"signal",
				"maxPixels",
				"parameters",
				"asciiPunctuation"
			].includes(e)) throw Error(`Unsupported recognize option: ${e}`);
			for (let [e, t] of Object.entries(r)) if (t && !["text", "blocks"].includes(e)) throw Error(`Unsupported output: ${e}. Only text and line-level blocks are available.`);
			let a = n.signal, o = () => x(a.reason ?? new DOMException("Aborted", "AbortError"));
			a?.throwIfAborted(), a?.addEventListener("abort", o, { once: !0 });
			try {
				let r = await i(e, n);
				h({
					status: "recognizing text",
					progress: 0
				});
				let a = l({
					...await S("recognize", {
						pixels: r.pixels,
						width: r.width,
						height: r.height,
						parameters: {
							...g,
							...t(n.parameters)
						}
					}, [r.pixels]),
					image: r.image
				}, n, r.offset);
				return h({
					status: "recognizing text",
					progress: 1
				}), a;
			} finally {
				a?.removeEventListener("abort", o);
			}
		},
		async setParameters(e) {
			if (_) throw Error("OCR worker was terminated. Create a new worker.");
			return g = {
				...g,
				...t(e)
			}, { ...g };
		},
		getInitializationSummary() {
			return C;
		},
		async terminate() {
			x();
		}
	};
}
async function d(e, t = "eng", n = {}) {
	let r = await u(t, void 0, n);
	try {
		return await r.recognize(e);
	} finally {
		await r.terminate();
	}
}
var f = {
	createWorker: u,
	recognize: d
};
export { u as createWorker, f as default, d as recognize };
