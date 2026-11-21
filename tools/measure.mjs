// 브라우저 성능 측정: Chrome 을 DevTools 프로토콜로 움직여 결함 100만 개 예시를 열고(읽기 · 검증 · 그리기 시간),
// 3초 동안 지도를 끌어 옮기며 프레임 간격을 잰다.
//   1) python -m http.server 8753 --bind 127.0.0.1      (저장소 루트에서)
//   2) node tools/measure.mjs [http://127.0.0.1:8753/] [--headed]
// --headed: 실제 창(화면 밖 위치)으로 띄워 GPU · 화면 주사율 그대로 잰다. 기본은 headless.
// 결과: docs/measurements/perf.json. Chrome 경로는 CHROME 환경 변수로 바꾼다.
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const URL0 = args.find((a) => a.startsWith("http")) || "http://127.0.0.1:8753/";
const HEADED = args.includes("--headed");
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "docs", "measurements");
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9343;
mkdirSync(OUT, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), "klv-measure-"));
const flags = [`--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--no-first-run", "--window-size=1280,900", "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows"];
if (HEADED) flags.push("--window-position=-3000,0"); else flags.push("--headless=new", "--enable-gpu", "--use-angle=d3d11", "--ignore-gpu-blocklist");
const proc = spawn(CHROME, [...flags, "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let ws, seq = 0;
const pending = new Map();
async function connect() {
  for (let i = 0; i < 50; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((x) => x.type === "page");
      if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); break; }
    } catch { /* 시작 중 */ }
    await sleep(200);
  }
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  ws.addEventListener("message", (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.rej(new Error(d.error.message)) : p.res(d.result); }
  });
}
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
async function js(expr) {
  const r = await send("Runtime.evaluate", { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}

const out = { date: new Date().toISOString(), mode: HEADED ? "headed" : "headless", runs: [] };
try {
  await connect();
  await send("Page.enable");
  await send("Page.navigate", { url: URL0 });
  for (let i = 0; i < 100 && !(await js("return !!window.klarfViewer?.ready")); i++) await sleep(200);
  out.renderer = await js(`const gl = document.createElement("canvas").getContext("webgl"); const d = gl.getExtension("WEBGL_debug_renderer_info"); return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);`);
  out.userAgent = await js("return navigator.userAgent");
  await js(`const d = document.querySelector("#ob-dlg"); if (d.open) d.close();`);
  for (const key of ["big", "big18"]) {
    const r = await js(`
      const S = window.klarfViewer.S; document.querySelector("#sample-pick").value = "${key}"; document.querySelector("#load-sample").click();
      await new Promise((res) => { const iv = setInterval(() => { const F = S.files[0]; if (F && F.sample === "${key}" && F.timing) { clearInterval(iv); res(); } }, 100); });
      const F = S.files[0];
      return { key: "${key}", version: F.res.version, defects: F.wafers[0].n, mb: +(F.size / 1048576).toFixed(1), workerParseS: +(F.ms / 1000).toFixed(2), readCheckS: +F.timing.read.toFixed(2), firstDrawS: +F.timing.draw.toFixed(2), totalS: +(F.timing.read + F.timing.draw).toFixed(2), errors: F.wafers[0].chk.errors, heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null };`);
    // 끌어 옮기기 3초: 매 프레임 map.pan → 프레임 간격
    r.pan = await js(`
      const { map } = window.klarfViewer; map.fit(); map.zoom(2.5); await new Promise((res) => setTimeout(res, 300));
      const ts = []; const t0 = performance.now(); let k = 0;
      await new Promise((res) => { function step(t) { ts.push(t); map.pan(Math.sin(k++ / 20) * 6, 2); if (performance.now() - t0 < 3000) requestAnimationFrame(step); else res(); } requestAnimationFrame(step); });
      const dt = ts.slice(1).map((v, i) => v - ts[i]).sort((a, b) => a - b);
      return { frames: ts.length, fps: +((ts.length - 1) / ((ts[ts.length - 1] - ts[0]) / 1000)).toFixed(1), medianMs: +dt[dt.length >> 1].toFixed(2), p95Ms: +dt[Math.floor(dt.length * 0.95)].toFixed(2), maxMs: +dt[dt.length - 1].toFixed(2) };`);
    r.zoom = await js(`
      const { map } = window.klarfViewer; map.fit(); await new Promise((res) => setTimeout(res, 200));
      const ts = []; const t0 = performance.now(); let k = 0;
      await new Promise((res) => { function step(t) { ts.push(t); map.zoom(k++ % 120 < 60 ? 1.03 : 1 / 1.03); if (performance.now() - t0 < 3000) requestAnimationFrame(step); else res(); } requestAnimationFrame(step); });
      const dt = ts.slice(1).map((v, i) => v - ts[i]).sort((a, b) => a - b);
      return { fps: +((ts.length - 1) / ((ts[ts.length - 1] - ts[0]) / 1000)).toFixed(1), medianMs: +dt[dt.length >> 1].toFixed(2), p95Ms: +dt[Math.floor(dt.length * 0.95)].toFixed(2) };`);
    console.log(JSON.stringify(r));
    out.runs.push(r);
  }
  writeFileSync(join(OUT, HEADED ? "perf-headed.json" : "perf-headless.json"), JSON.stringify(out, null, 2));
  console.log("renderer:", out.renderer);
} finally {
  try { await send("Browser.close"); } catch { proc.kill(); }
}
