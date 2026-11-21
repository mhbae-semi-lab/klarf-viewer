// 파일 읽기 Worker: File 을 8MB 조각으로 읽어 디코딩 → 줄 나누기 → 파싱. 결함 열(typed array)은 복사 없이 넘긴다.
// 예시 생성도 여기서 한다 (100만 개 예시를 화면 멈춤 없이 만들려고).
import { createParser } from "./klarf.js";
import { SAMPLES } from "./gen.js";

const CHUNK = 8 << 20;
let stop = false;

const ARRS = ["xr", "yr", "xi", "yi", "x", "y", "size", "cls", "did", "test", "xsize", "ysize", "area", "dsize", "rough", "fine", "images", "plan"];

self.onmessage = async ({ data }) => {
  if (data.type === "cancel") { stop = true; return; }
  if (data.type === "sample") {
    const s = SAMPLES.find((x) => x.key === data.key);
    const t0 = performance.now();
    const text = s.make();
    self.postMessage({ type: "sampleText", text, ms: performance.now() - t0 });
    return;
  }
  if (data.type !== "parse") return;
  stop = false;
  const { file } = data;
  const t0 = performance.now();
  try {
    const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
    const enc = head[0] === 0xff && head[1] === 0xfe ? "utf-16le" : head[0] === 0xfe && head[1] === 0xff ? "utf-16be" : "utf-8";
    const dec = new TextDecoder(enc);
    const p = createParser({ name: file.name });
    let rest = "";
    for (let off = 0; off < file.size && !stop; off += CHUNK) {
      const text = rest + dec.decode(await file.slice(off, off + CHUNK).arrayBuffer(), { stream: off + CHUNK < file.size });
      const cut = text.lastIndexOf("\n");
      if (cut < 0 && off + CHUNK < file.size) { rest = text; continue; }
      p.push((cut >= 0 ? text.slice(0, cut) : text).split("\n"));
      rest = cut >= 0 ? text.slice(cut + 1) : "";
      self.postMessage({ type: "progress", done: Math.min(file.size, off + CHUNK), total: file.size });
    }
    if (stop) { self.postMessage({ type: "canceled" }); return; }
    if (rest) p.push([rest]);
    const res = p.end();
    const transfer = [];
    for (const w of res.wafers) {
      w.classes = [...w.classes];
      for (const k of ARRS) if (w[k]?.buffer) transfer.push(w[k].buffer);
    }
    self.postMessage({ type: "done", res, ms: performance.now() - t0 }, transfer);
  } catch (e) {
    self.postMessage({ type: "error", code: e.message || String(e) });
  }
};
