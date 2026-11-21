// 매뉴얼 · 보고서용 화면 캡처 (합성 데이터만). headless Chrome 을 DevTools 프로토콜로 움직인다.
//   1) python tools/serve.py 8753        (저장소 루트에서)
//   2) node docs/manual/capture.mjs [http://127.0.0.1:8753/]
// 결과: docs/manual/shots/*.png (1280 x 800, 배율 1.5) + marks.json (말풍선 자리). Chrome 경로는 CHROME 환경 변수로 바꾼다.
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const URL0 = process.argv[2] || "http://127.0.0.1:8753/";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "shots");
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9353;
mkdirSync(OUT, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), "klv-capture-"));
const proc = spawn(CHROME, ["--headless=new", "--enable-gpu", "--use-angle=d3d11", "--ignore-gpu-blocklist", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  "--hide-scrollbars", "--no-first-run", "--window-size=1280,800", "about:blank"], { stdio: "ignore" });
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
async function view(w, h, scheme = "light", mobile = false) {
  await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1.5, mobile });
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }, { name: "prefers-reduced-motion", value: "reduce" }] });
}
// 요소를 화면 맨 위로 올리고 화면을 찍는다. marks: 말풍선 자리로 쓸 요소들 → CSS px 사각형 [x0, y0, x1, y1] (화면 밖이면 null)
const MARKS = {};
async function shot(name, sel, offset = 66, marks = []) {
  if (sel) await js(`const el = document.querySelector(${JSON.stringify(sel)}); window.scrollTo(0, el.getBoundingClientRect().top + scrollY - ${offset});`);
  await js(`document.querySelectorAll(".toast").forEach((x) => x.remove())`);
  await sleep(450);
  MARKS[name] = await js(`return ${JSON.stringify(marks)}.map((m) => { const el = document.querySelector(m); if (!el) return null;
    const r = el.getBoundingClientRect(); if (r.bottom < 0 || r.top > innerHeight || !r.width) return null;
    return [r.left, r.top, r.right, Math.min(r.bottom, innerHeight)].map(Math.round); });`);
  const r = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(OUT, name + ".png"), Buffer.from(r.data, "base64"));
  console.log("shot", name, MARKS[name].map((x) => (x ? "o" : "-")).join(""));
}
const click = (sel) => js(`document.querySelector(${JSON.stringify(sel)}).click()`);
const until = (cond, ms = 30000) => js(`const t0 = Date.now(); while (!(${cond}) && Date.now() - t0 < ${ms}) await new Promise((r) => setTimeout(r, 100));`);
async function sample(key) {
  await js(`document.querySelector("#sample-pick").value = "${key}"; document.querySelector("#load-sample").click();`);
  await until(`window.klarfViewer?.S.files[0]?.sample === "${key}" && window.klarfViewer.S.files[0].timing`, 60000);
  await sleep(500);
}
async function load(lang = "ko") {
  await send("Page.navigate", { url: URL0 });
  await until(`window.klarfViewer?.ready`);
  await js(`await document.fonts.ready; const d = document.querySelector("#ob-dlg"); if (d.open) d.close();
    const s = document.querySelector("#lang"); if (s.value !== "${lang}") { s.value = "${lang}"; s.dispatchEvent(new Event("change", { bubbles: true })); }`);
  await sleep(500);
}
const mode = (m) => click(`[data-mode="${m}"]`);
const focus = (code) => click(`[data-focus="${code}"]`);

try {
  await connect();
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Page.navigate", { url: URL0 });
  await sleep(1500);
  await js(`for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister(); await new Promise(r => { const q = indexedDB.deleteDatabase("klarf-viewer"); q.onsuccess = q.onerror = q.onblocked = r; });`);

  await view(1280, 800);
  await send("Page.navigate", { url: URL0 });
  await until(`window.klarfViewer?.ready && document.querySelector("#ob-dlg").open`);
  await js(`await document.fonts.ready`); await sleep(600);
  await shot("Onboard");
  await load("ko");
  await shot("Home", null, 66, ["#lang", "#theme", "#open-help", "#open-settings", "#sample-pick", "#load-sample", ".file-btn", "#files li"]);
  await shot("Map", ".work", 66, ["#modes", "#map", "#chk-body", "#classes", "#legend", ".row-btns"]);
  await shot("Info", "#info-h", 80, ["#info .kv"]);

  // 맵 오류 5종
  await sample("pitch"); await focus("pitch");
  await shot("Pitch", ".work", 66, ["#chk-body .fi.error", "[data-focus=pitch]", "#map", "#fix-toggle"]);
  await click("#fix-toggle"); await sleep(300); await mode("diestack");
  await shot("PitchFixed", ".work", 66, ["#chk-body .ok-line", "#fix-toggle", "#map"]);
  await sample("scribe"); await focus("scribe");
  await shot("Scribe", ".work", 66, ["#chk-body .fi.error", "#map"]);
  await sample("origin"); await focus("origin");
  await shot("Origin", ".work", 66, ["#chk-body .fi.error", "#chk-body .fi.info", "#map"]);
  await sample("outside"); await focus("outside");
  await shot("Outside", ".work", 66, ["#chk-body .fi.error", "#map"]);
  await sample("index"); await focus("index");
  await shot("Index", ".work", 66, ["#chk-body .fi.error", "#map"]);
  await click("#tt-dies"); await sleep(300);
  await shot("IndexDies", ".tables", 66, ["#tp tbody tr:first-child", "#tp .bad-t"]);

  // 보기 모드
  await sample("ok18"); await mode("heat");
  await shot("Heat", ".work", 66, ["#modes [data-mode=heat]", "#map", "#legend"]);
  await mode("stack");
  await shot("Stack", ".work", 66, ["#modes [data-mode=stack]", "#map", "#legend"]);
  await click("#tt-rep"); await sleep(400);
  await shot("Repeaters", ".tables", 66, ["#tp h3:first-of-type", "#tp h3:last-of-type"]);
  await mode("diestack");
  await shot("DieStack", ".work", 66, ["#map", "#legend"]);
  await sample("pair");
  await click("#tt-cmp"); await sleep(400);
  await shot("Compare", ".work", 66, ["#cmp-pick", "#map", "#legend"]);
  await shot("CompareTable", ".tables", 66, ["#tp p b", "#tp table"]);
  await mode("defects"); await click("#tt-defects"); await sleep(300);
  await js(`const c = document.querySelector('#classes input[data-cls="1"]'); c.click();`); await sleep(300);
  await shot("Filter", ".work", 66, ["#classes", ".size-row", "#f-flag", "#flt-count"]);
  await js(`const c = document.querySelector('#classes input[data-cls="1"]'); c.click();`); await sleep(200);
  await shot("Defects", ".tables", 66, ["#ttabs", "#tp .pager", "#tp tbody tr:first-child"]);

  // 깨진 파일
  await sample("broken");
  await shot("Broken", "#drop", 66, ["#files li", "#bad summary", "#bad tbody tr"]);

  // 현장 검증
  await click("#vt-repro"); await sleep(600);
  await shot("Repro", "#verify", 66, ["#vt-repro", "#vp .kpis", "#vp tbody tr:nth-child(3)", "#save-case"]);
  await click("#vt-compare"); await sleep(300);
  await click("#make-draft"); await sleep(300);
  await js(`const e = document.querySelector('#draft-form [data-rule="pitchTol"]'); e.value = 3; e.dispatchEvent(new Event("change", { bubbles: true }));
    const g = document.querySelector('#draft-form [data-rule="edgeTol"]'); g.value = 300; g.dispatchEvent(new Event("change", { bubbles: true })); document.querySelector("#run-compare").click();`);
  await sleep(1500);
  await shot("CompareRules", "#verify", 66, ["#vp .cfg:first-child", "#draft-form", "#run-compare", "#vp td.changed"]);
  // 초안을 되돌려 Shadow 를 쌓는다 (pitchTol 3 은 놓침이 생겨 전환 조건을 못 넘는 것을 보여준 뒤, 2 로)
  await js(`const e = document.querySelector('#draft-form [data-rule="pitchTol"]'); e.value = 2; e.dispatchEvent(new Event("change", { bubbles: true })); document.querySelector("#run-compare").click();`);
  await sleep(1200);
  for (const k of ["ok12", "pitch", "outside"]) await sample(k);
  await click("#vt-shadow"); await sleep(400);
  await shot("Shadow", "#verify", 66, ["#vt-shadow", "#vp .kpis", "#vp tbody tr:first-child"]);
  await click("#vt-switch"); await sleep(600);
  await shot("Switch", "#verify", 66, ["#vp .kpis", "#switch-b", "#vp tbody"]);
  await click("#switch-b"); await sleep(800);
  await click("#vt-switch"); await sleep(400);
  await shot("Rollback", "#verify", 66, ["#vp tbody tr:first-child", "[data-rollback]"]);
  await click("[data-rollback]"); await sleep(600);

  // 대화 상자
  await click("#open-settings"); await sleep(300);
  await shot("Settings", null, 66, ["#s-point", "#s-reptol", "#s-stacktol", "#backup-export", "#reset-all"]);
  await js(`document.querySelector("#set-dlg").close()`);
  await click("#open-help"); await sleep(400);
  await shot("Help");
  await js(`document.querySelector("#help-dlg").close()`);

  // 영어 · 모바일 · 다크
  await load("en");
  await sample("scribe"); await focus("scribe");
  await shot("EnHome", ".work", 66);
  await view(390, 844, "dark", true);
  await load("ko");
  await mode("defects");
  await sample("origin");
  await shot("MobileDark", "#map", 120);
  await shot("MobileChecks", "#checks", 66);
  await view(1280, 800, "dark");
  await load("ko");
  await sample("ok18"); await mode("heat");
  await shot("DarkHeat", ".work", 66);

  // 성능: 결함 100만 개
  await view(1280, 800);
  await load("ko");
  await mode("defects");
  await sample("big");
  await shot("Big", "#drop", 66, ["#files li small", "#map"]);
  writeFileSync(join(OUT, "marks.json"), JSON.stringify(MARKS, null, 1));
} finally {
  try { ws?.close(); } catch { /* */ }
  proc.kill();
  await sleep(500);
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* 잠긴 파일은 남긴다 */ }
}
