// Klarf 웨이퍼 맵 뷰어 화면. 파일 읽기는 Worker, 그리기는 map.js(WebGL), 검증은 check.js.
import { t, setLang, getLang, applyStatic } from "./i18n.js";
import * as db from "./store.js";
import { createMap } from "./map.js";
import { buildIndex, nearest, dieCounts, matchDefects, dieRepeaters, waferRepeaters } from "./analyze.js";
import { checkWafer, applyFix, DEFAULT_RULES, CODES } from "./check.js";
import { SAMPLES, sampleName } from "./gen.js";
import { parseText } from "./klarf.js";

const VERSION = "1.0.0";
const SHADOW_RUNS = 3;
const SAVE_LIMIT = 200 << 20, CASE_LIMIT = 20 << 20;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtN = (n) => Number(n).toLocaleString(getLang() === "en" ? "en-US" : "ko-KR");
const f1 = (v) => (Math.round(v * 10) / 10).toLocaleString("en-US");
const clone = (o) => JSON.parse(JSON.stringify(o));
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

const S = {
  files: [], seq: 0, cur: null, mode: "defects", cmpA: null, cmpB: null, cmpTol: 20,
  filter: { hidden: [], smin: null, smax: null, flagged: false },
  settings: { lang: null, theme: "auto", point: 2.5, rows: 200, repTol: 15, repMin: 3, stackTol: 100 },
  rules: { ...DEFAULT_RULES }, draft: null, history: [], shadow: [], cases: [],
  ttab: "defects", vtab: "repro", page: 0, fix: false, focus: null, view: null, cmpRes: null, repro: null,
};
let map = null, worker = null;

function toast(msg, action) {
  $(".toast")?.remove();
  const el = document.createElement("div");
  el.className = "toast"; el.setAttribute("role", "status");
  el.innerHTML = `<span>${esc(msg)}</span>`;
  if (action) { const b = document.createElement("button"); b.textContent = action.label; b.onclick = () => { el.remove(); action.run(); }; el.appendChild(b); }
  document.body.appendChild(el);
  setTimeout(() => el.remove(), action ? 12000 : 4500);
}
const download = (name, data, type) => {
  const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
};

// ---------- 색 ----------
const CAT = { light: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"], dark: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#0ca30c", "#9085e9", "#e66767"] };
const SEQ = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95", "#0d366b"];
const dark = () => document.documentElement.dataset.theme === "dark" || (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
// 클래스 → 색: 번호 순서로 고정 슬롯 (UNCLASSIFIED · 9번째 이후는 회색)
function classColors(W) {
  const pal = CAT[dark() ? "dark" : "light"], gray = dark() ? "#8a8a8a" : "#8c8c8c", m = new Map();
  let k = 0;
  for (const c of [...classCounts(W).keys()].sort((a, b) => a - b)) {
    const name = W.classes.get(c) || "";
    m.set(c, c === 0 || /^UNCLASS/i.test(name) || k >= pal.length ? gray : pal[k++]);
  }
  return m;
}
function classCounts(W) {
  if (W._cc) return W._cc;
  const m = new Map();
  for (let i = 0; i < W.n; i++) m.set(W.cls[i], (m.get(W.cls[i]) || 0) + 1);
  return (W._cc = m);
}
const seqColor = (f) => { const s = dark() ? [...SEQ].reverse() : SEQ, k = Math.min(s.length - 1, Math.floor(f * s.length)); return s[k]; };

// ---------- 파일 · 웨이퍼 ----------
const wafers = () => S.files.flatMap((f) => f.wafers);
const byKey = (k) => wafers().find((w) => w.key === k);
const curW = () => byKey(S.cur);
const viewW = () => { const W = curW(); return W && S.fix && W.fixed ? W.fixed : W; };
const label = (W) => `${W.file.name}${W.file.wafers.length > 1 ? ` · ${t("wafer")} ${W.id}` : ""}`;

function readFile(file) {
  return new Promise((resolve) => {
    worker ||= new Worker("src/worker.js", { type: "module" });
    $("#progress").hidden = false; $("#progress-txt").textContent = `${t("reading")} ${file.name}`; $("#progress-bar").style.width = "0";
    if (file.size > 50 << 20) toast(t("big"));
    worker.onmessage = ({ data }) => {
      if (data.type === "progress") { $("#progress-bar").style.width = `${(100 * data.done) / data.total}%`; return; }
      $("#progress").hidden = true;
      if (data.type === "done") resolve({ res: data.res, ms: data.ms });
      else { if (data.type === "error") toast(`${t("readErr")}: ${data.code}`); resolve(null); }
    };
    worker.postMessage({ type: "parse", file });
  });
}

// 파일 여러 개 열기. keep=true 면 이미 열린 파일에 더한다
async function openFiles(list, { keep = true, sample = null } = {}) {
  if (!keep) S.files = [];
  let first = null;
  for (const file of list) {
    const t0 = performance.now();
    const out = await readFile(file);
    if (!out) continue;
    const { res } = out;
    if (!res.wafers.length) { toast(t("notKlarfToast", file.name)); addFile(file, res, sample, out.ms); continue; }
    const F = addFile(file, res, sample, out.ms);
    F.t0 = t0;
    first ||= F;
  }
  if (first) {
    S.cur = first.wafers[0].key;
    if (S.mode === "compare" || S.mode === "stack") { pickCompare(); }
    S.fix = false; S.focus = null; S.page = 0;
    renderAll(true);
    const tDraw = performance.now();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const now = performance.now();
      first.timing = { read: (tDraw - first.t0) / 1000, draw: (now - tDraw) / 1000 };
      renderFiles();
    }));
  } else renderAll(false);
  saveOpen();
}

function addFile(file, res, sample, ms) {
  const F = { fid: ++S.seq, name: file.name, size: file.size, blob: file, sample, res, ms, wafers: [] };
  res.wafers.forEach((W, i) => {
    W.classes = new Map(W.classes);
    W.key = `${F.fid}:${i}`; W.file = F;
    runChecks(W, true);
  });
  F.wafers = res.wafers;
  S.files.push(F);
  return F;
}

// 검증: A(적용 규칙)로 판정, B 초안이 있으면 Shadow 로 같이 돌려 기록
function setChk(W, chk) {
  W.chk = chk;
  W.flag = new Uint8Array(W.n);
  for (const f of chk.findings) if (f.members) for (const i of f.members) W.flag[i] |= 1 << CODES.indexOf(f.code);
}
function runChecks(W, log) {
  setChk(W, checkWafer(W, S.rules));
  W.fixed = W.chk.errors.some((c) => c !== "outside") ? applyFix(W, W.chk) : null;
  if (W.fixed) setChk(W.fixed, checkWafer(W.fixed, S.rules));
  if (log && S.draft) {
    const b = checkWafer(W, S.draft).errors, a = W.chk.errors;
    const rec = { t: new Date().toISOString(), file: W.file.name, wafer: W.id, a, b, same: a.join() === b.join(), draft: S.draft._id };
    S.shadow.push(rec); db.put("shadow", rec);
  }
}

async function loadSample(key, keep = false) {
  const s = SAMPLES.find((x) => x.key === key);
  let text;
  if (s.big) {
    toast(t("genBig"));
    worker ||= new Worker("src/worker.js", { type: "module" });
    text = await new Promise((res) => { worker.onmessage = ({ data }) => { if (data.type === "sampleText") res(data.text); }; worker.postMessage({ type: "sample", key }); });
  } else text = s.make();
  const files = (s.pair ? text : [text]).map((x, k) => new File([x], sampleName(s, k), { type: "text/plain" }));
  $("#sample-pick").value = key;
  if (s.pair && !keep) { S.mode = "compare"; S.cmpA = S.cmpB = null; }
  await openFiles(files, { keep, sample: key });
}

async function saveOpen() {
  const list = [];
  let total = 0;
  for (const F of S.files) {
    if (F.sample) { if (!list.some((o) => o.sample === F.sample)) list.push({ sample: F.sample, name: F.name }); continue; }
    total += F.size;
    list.push({ name: F.name, blob: total < SAVE_LIMIT ? F.blob : null });
  }
  await db.put("files", list, "open");
}
function saveUi() { db.put("kv", { mode: S.mode, ttab: S.ttab, vtab: S.vtab, filter: S.filter, cmpTol: S.cmpTol, curIdx: wafers().findIndex((w) => w.key === S.cur) }, "ui"); }

// ---------- 그리기 ----------
let lastPts = null;
function setPts(key, x, y, n) { if (lastPts !== key) { map.setPoints(x, y, n); lastPts = key; } }

function keepFn(W) {
  const hid = new Set(S.filter.hidden), { smin, smax, flagged } = S.filter;
  if (!hid.size && smin == null && smax == null && !flagged) return null;
  return (i) => !hid.has(W.cls[i]) && (smin == null || W.size[i] >= smin) && (smax == null || W.size[i] <= smax) && (!flagged || W.flag[i]);
}

function planImage(W, counts, maxC) {
  const p = W.plan, g = W.geo;
  let i0 = Infinity, i1 = -Infinity, j0 = Infinity, j1 = -Infinity;
  const dies = [];
  for (let k = 0; k < p.length; k += 2) dies.push([p[k], p[k + 1]]);
  if (counts) for (const k of counts.keys()) { const [a, b] = k.split(",").map(Number); dies.push([a, b]); }
  for (const [a, b] of dies) { i0 = Math.min(i0, a); i1 = Math.max(i1, a); j0 = Math.min(j0, b); j1 = Math.max(j1, b); }
  if (!dies.length || i1 - i0 > 4000 || j1 - j0 > 4000) return null;
  const w = i1 - i0 + 1, h = j1 - j0 + 1, c = document.createElement("canvas");
  c.width = w; c.height = h;
  const x = c.getContext("2d"), img = x.createImageData(w, h), u = img.data;
  const put = (a, b, rgb, al = 255) => { const o = ((j1 - b) * w + (a - i0)) * 4; u[o] = rgb[0]; u[o + 1] = rgb[1]; u[o + 2] = rgb[2]; u[o + 3] = al; };
  const planRgb = hex(css("--plan") || "#e6e6e6");
  for (let k = 0; k < p.length; k += 2) put(p[k], p[k + 1], planRgb);
  if (counts) for (const [k, v] of counts) { const [a, b] = k.split(",").map(Number); put(a, b, hex(seqColor(Math.log1p(v) / Math.log1p(maxC)))); }
  x.putImageData(img, 0, 0);
  const [px, py] = g.pitch, [gx, gy] = g.grid;
  return { img: c, box: { x0: gx + i0 * px, x1: gx + (i1 + 1) * px, y0: gy + j0 * py, y1: gy + (j1 + 1) * py } };
}

function renderMap() {
  const W = viewW();
  $("#cmp-pick").hidden = S.mode !== "compare";
  $$("#modes button").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.mode === S.mode)));
  map.M.pointPx = S.settings.point;
  if (!W) { map.setGeo(null); map.setPoints(new Float32Array(0), new Float32Array(0), 0); lastPts = null; $("#legend").innerHTML = ""; return; }
  const legend = [];
  let n = W.n, aria = "";
  $("#flt-count").textContent = "";
  if (S.mode === "defects" || S.mode === "heat") {
    if (map.M.geo !== W.geo) map.setGeo(W.geo);
    setPts(`w:${W.key}:${S.fix}`, W.x, W.y, W.n);
    const keep = keepFn(W), col = new Uint8Array(n * 4), cm = classColors(W);
    let shown = 0;
    if (S.mode === "defects") {
      const rgb = new Map([...cm].map(([k, v]) => [k, hex(v)]));
      for (let i = 0; i < n; i++) { if (keep && !keep(i)) continue; const c = rgb.get(W.cls[i]); col[4 * i] = c[0]; col[4 * i + 1] = c[1]; col[4 * i + 2] = c[2]; col[4 * i + 3] = 255; shown++; }
      const pi = planImage(W);
      map.setDies(pi?.img, pi?.box);
    } else {
      const counts = dieCounts(W.xi, W.yi, n, keep);
      const maxC = Math.max(1, ...counts.values());
      const pi = planImage(W, counts, maxC);
      map.setDies(pi?.img, pi?.box);
      shown = [...counts.values()].reduce((a, b) => a + b, 0);
      legend.push(`<span>${t("heatLegend")}</span><span class="ramp" style="background:linear-gradient(90deg,${(dark() ? [...SEQ].reverse() : SEQ).join(",")})"></span><span>1 – ${fmtN(maxC)}</span>`);
    }
    map.setColors(col);
    map.setNearest(nearestFn(W.x, W.y, n, W.geo.pitch, (i) => col[4 * i + 3] > 0));
    $("#flt-count").textContent = t("shown", fmtN(shown), fmtN(W.n));
    aria = `${label(W)} · ${fmtN(shown)} ${t("defects")}`;
  } else if (S.mode === "diestack") {
    const [px, py] = W.geo.pitch, g = { kind: "die", R: Math.max(px, py) * 0.62, pitch: [px, py], grid: [-px / 2, -py / 2], notch: "" };
    if (map.M.geo?.kind !== "die" || map.M.geo.pitch[0] !== px || map.M.geo.pitch[1] !== py) map.setGeo(g);
    const x = new Float32Array(n), y = new Float32Array(n);
    for (let i = 0; i < n; i++) { x[i] = W.xr[i] - px / 2; y[i] = W.yr[i] - py / 2; }
    setPts(`d:${W.key}:${S.fix}`, x, y, n);
    // 다이 안 밀도(로그 색): 반복 결함은 점, pitch 가 틀리면 줄무늬, 스크라이브는 빈 띠. 다이 밖으로 나간 상대 좌표만 점으로
    const keep = keepFn(W), col = new Uint8Array(n * 4), bad = hex(CAT[dark() ? "dark" : "light"][7]);
    const BX = 240, BY = Math.max(40, Math.round((BX * py) / px)), h = new Float32Array(BX * BY);
    let hmax = 1;
    for (let i = 0; i < n; i++) {
      if (keep && !keep(i)) continue;
      const a = W.xr[i] / px, b = W.yr[i] / py;
      if (a < 0 || a >= 1 || b < 0 || b >= 1) { col.set([bad[0], bad[1], bad[2], 255], 4 * i); continue; }
      const k = (BY - 1 - ((b * BY) | 0)) * BX + ((a * BX) | 0);
      if (++h[k] > hmax) hmax = h[k];
    }
    const cv = document.createElement("canvas"); cv.width = BX; cv.height = BY;
    const cx2 = cv.getContext("2d"), img = cx2.createImageData(BX, BY), lm = Math.log1p(hmax);
    for (let k = 0; k < h.length; k++) if (h[k]) { const c = hex(seqColor(Math.log1p(h[k]) / lm)); img.data.set([c[0], c[1], c[2], 255], 4 * k); }
    cx2.putImageData(img, 0, 0);
    map.setColors(col); map.setDies(cv, { x0: -px / 2, x1: px / 2, y0: -py / 2, y1: py / 2 });
    map.setNearest(() => -1);
    legend.push(`<span>${t("diestackLegend")}</span><span class="ramp" style="background:linear-gradient(90deg,${(dark() ? [...SEQ].reverse() : SEQ).join(",")})"></span><span>1 – ${fmtN(hmax)}</span><span class="hint">${t("diestackNote")}</span>`);
    aria = `${label(W)} · ${t("diestackLegend")}`;
  } else if (S.mode === "stack") {
    const st = stackData(W);
    if (!st) { legend.push(`<span class="hint">${t("stackNeed")}</span>`); }
    else {
      if (map.M.geo !== W.geo) map.setGeo(W.geo);
      setPts(`s:${st.keys}`, st.x, st.y, st.n);
      const col = new Uint8Array(st.n * 4), base = hex(dark() ? "#9a9a9a" : "#8c8c8c"), hot = hex(CAT[dark() ? "dark" : "light"][7]);
      for (let i = 0; i < st.n; i++) { const c = st.rep[i] ? hot : base; col.set([c[0], c[1], c[2], st.rep[i] ? 255 : 120], 4 * i); }
      map.setColors(col);
      const pi = planImage(W);
      map.setDies(pi?.img, pi?.box);
      map.setNearest(nearestFn(st.x, st.y, st.n, W.geo.pitch, () => true));
      legend.push(`<span>${t("stackLegend", st.list.length)}</span><span class="li"><span class="sw" style="background:${CAT[dark() ? "dark" : "light"][7]}"></span>${t("repeaterL")} ${fmtN(st.reps.length)}</span>${st.dropped ? `<span class="hint">${t("stackPitch", st.dropped)}</span>` : ""}`);
      aria = t("stackLegend", st.list.length);
    }
  } else if (S.mode === "compare") {
    const c = compareData();
    if (!c) legend.push(`<span class="hint">${t("cmpNeed")}</span>`);
    else {
      if (map.M.geo !== c.A.geo) map.setGeo(c.A.geo);
      setPts(`c:${c.A.key}:${c.B.key}`, c.x, c.y, c.n);
      const pal = CAT[dark() ? "dark" : "light"], ca = hex(pal[0]), cb = hex(pal[1]), cc = hex(dark() ? "#9a9a9a" : "#8c8c8c");
      const col = new Uint8Array(c.n * 4);
      for (let i = 0; i < c.A.n; i++) { const k = c.m.sa[i] ? ca : cc; col.set([k[0], k[1], k[2], c.m.sa[i] ? 255 : 110], 4 * i); }
      for (let j = 0; j < c.B.n; j++) { if (!c.m.sb[j]) continue; col.set([cb[0], cb[1], cb[2], 255], 4 * (c.A.n + j)); }
      map.setColors(col);
      const pi = planImage(c.A); map.setDies(pi?.img, pi?.box);
      map.setNearest(nearestFn(c.x, c.y, c.n, c.A.geo.pitch, (i) => col[4 * i + 3] > 0));
      legend.push(`<span class="li"><span class="sw" style="background:${pal[0]}"></span>${t("onlyA")} ${fmtN(c.onlyA)}</span><span class="li"><span class="sw" style="background:${pal[1]}"></span>${t("onlyB")} ${fmtN(c.onlyB)}</span><span class="li"><span class="sw" style="background:#8c8c8c"></span>${t("common")} ${fmtN(c.m.common)}</span>`);
      aria = t("cmpCounts", { c: fmtN(c.m.common), a: fmtN(c.onlyA), b: fmtN(c.onlyB), tol: S.cmpTol });
    }
  }
  if (S.mode === "defects" || S.mode === "diestack") {
    const cm = classColors(W), cc = classCounts(W);
    legend.unshift(...[...cm].map(([k, v]) => `<span class="li"><span class="sw" style="background:${v}"></span>${esc(W.classes.get(k) || k)} ${fmtN(cc.get(k))}</span>`));
  }
  $("#legend").innerHTML = legend.join("");
  $("#map").setAttribute("aria-label", t("mapAria", aria));
  $("#map-sub").textContent = label(W) + (S.fix && W.fixed ? ` · ${t("fixView")}` : "");
  setMarks();
}

function nearestFn(x, y, n, pitch, keep) {
  let ix = null;
  return (X, Y, r) => { ix ||= buildIndex(x, y, n, Math.max(50, Math.min(pitch[0], pitch[1]) / 4)); return nearest(ix, X, Y, r, keep); };
}

function stackData(W) {
  const p = W.geo.pitch, list = wafers().filter((w) => Math.abs(w.geo.pitch[0] - p[0]) < 1e-3 * p[0] && Math.abs(w.geo.pitch[1] - p[1]) < 1e-3 * p[1]);
  if (list.length < 2) return null;
  const keys = list.map((w) => w.key).join(",");
  if (S._stack?.keys === keys && S._stack.tol === S.settings.stackTol) return S._stack;
  let n = 0; for (const w of list) n += w.n;
  const x = new Float32Array(n), y = new Float32Array(n), rep = new Uint8Array(n), off = [];
  let o = 0;
  for (const w of list) { off.push(o); x.set(w.x, o); y.set(w.y, o); o += w.n; }
  const reps = waferRepeaters(list, { tol: S.settings.stackTol, minWafers: 2, R: W.geo.R });
  for (const r of reps) for (let q = 0; q < r.members.length; q += 2) rep[off[r.members[q]] + r.members[q + 1]] = 1;
  const dieWafers = new Map();
  for (const w of list) { const s = new Set(); for (let i = 0; i < w.n; i++) s.add(`${w.xi[i]},${w.yi[i]}`); for (const k of s) dieWafers.set(k, (dieWafers.get(k) || 0) + 1); }
  return (S._stack = { keys, tol: S.settings.stackTol, list, x, y, n, rep, reps, off, dieWafers, dropped: wafers().length - list.length });
}

function pickCompare() {
  const ws = wafers();
  if (!byKey(S.cmpA)) S.cmpA = ws[0]?.key ?? null;
  if (!byKey(S.cmpB) || S.cmpB === S.cmpA) S.cmpB = ws.find((w) => w.key !== S.cmpA)?.key ?? null;
}
function compareData() {
  pickCompare();
  const A = byKey(S.cmpA), B = byKey(S.cmpB);
  if (!A || !B || A === B) return null;
  const key = `${A.key}|${B.key}|${S.cmpTol}`;
  if (S._cmp?.key === key) return S._cmp;
  const m = matchDefects(A, B, S.cmpTol), n = A.n + B.n;
  const x = new Float32Array(n), y = new Float32Array(n);
  x.set(A.x, 0); y.set(A.y, 0); x.set(B.x, A.n); y.set(B.y, A.n);
  let onlyA = 0, onlyB = 0; for (const v of m.sa) if (v) onlyA++; for (const v of m.sb) if (v) onlyB++;
  return (S._cmp = { key, A, B, m, x, y, n, onlyA, onlyB });
}

// 검증 결과 강조 (선택한 항목)
function setMarks() {
  const W = viewW(), f = S.focus;
  const marks = [];
  if (W && f && (S.mode === "defects" || S.mode === "heat")) {
    const F = W.chk.findings.find((x) => x.code === f.code && (f.axis == null || x.axis === f.axis));
    if (F?.dies) for (const d of F.dies.slice(0, 400)) marks.push({ die: d, color: css("--mark") });
    if (F?.members) for (const i of F.members.slice(0, 300)) marks.push({ pt: [W.x[i], W.y[i]], color: css("--mark"), r: 6 });
    if (F?.code === "outside") marks.push({ circle: [0, 0, W.geo.R], color: css("--mark"), width: 1.5 });
  }
  if (W && f && S.mode === "diestack") {
    const F = W.chk.findings.find((x) => x.code === "scribe" && x.axis === f.axis);
    if (F && F.v.lo < F.v.hi) { const p = W.geo.pitch; marks.push({ band: [F.axis, F.v.lo - p[F.axis] / 2, F.v.hi - p[F.axis] / 2], color: css("--mark") }); }
  }
  if (S.pick) marks.push(S.pick);
  map.setMarks(marks);
}

// ---------- 화면 조각 ----------
function renderFiles() {
  const ul = $("#files");
  ul.innerHTML = S.files.map((F) => {
    const r = F.res, tm = F.timing;
    const ws = F.wafers.map((W) => `<button type="button" class="wchip${W.key === S.cur ? " on" : ""}" data-w="${W.key}" aria-pressed="${W.key === S.cur}">${F.wafers.length > 1 ? `${esc(W.id)} · ` : ""}${fmtN(W.n)}${W.chk.errors.length ? ` <b class="bad-t" aria-label="${t("lvError")}">!${W.chk.errors.length}</b>` : ""}</button>`).join("");
    return `<li><span class="fname" title="${esc(F.name)}">${esc(F.name)}</span><span class="ver">KLARF ${esc(r.version || "?")}</span>${ws}
      ${tm ? `<small>${t("readDone", { n: fmtN(F.wafers.reduce((a, w) => a + w.n, 0)), read: tm.read.toFixed(2), draw: tm.draw.toFixed(2) })}</small>` : ""}
      <button type="button" class="x" data-rm="${F.fid}" aria-label="${t("removeFile")} ${esc(F.name)}">×</button></li>`;
  }).join("");
  const errs = S.files.flatMap((F) => F.res.errors.map((e) => ({ ...e, file: F.name })));
  const nErr = S.files.reduce((a, F) => a + F.res.nErrors, 0);
  const warns = S.files.flatMap((F) => F.res.warnings.map((w) => ({ ...w, file: F.name })));
  $("#bad").innerHTML = (nErr ? `<details class="bad" ${nErr < 20 ? "open" : ""}><summary>${t("lineErrors", fmtN(nErr))}</summary><div class="tbl-wrap"><table class="t"><thead><tr><th>${t("i_file")}</th><th>${t("lineNo")}</th><th>${t("reason")}</th><th>${t("text")}</th></tr></thead><tbody>${errs.slice(0, 200).map((e) => `<tr><td class="nw">${esc(e.file)}</td><td class="num">${e.line}</td><td>${esc(t("r_" + e.reason))}</td><td class="mono">${esc(e.text)}</td></tr>`).join("")}</tbody></table></div></details>` : "")
    + (warns.length ? `<details class="bad warnings"><summary>${t("warnTitle")} ${warns.length}</summary><ul>${warns.map((w) => `<li>${esc(w.file)} · ${t("lineNo")} ${w.line || "-"}: ${esc(t("w_" + w.code, w.v))}</li>`).join("")}</ul></details>` : "");
}

function renderChecks() {
  const W = viewW(), body = $("#chk-body");
  if (!W) { body.innerHTML = `<p class="empty">${t("noFile")}</p>`; $("#chk-badge").innerHTML = ""; return; }
  const c = W.chk, errs = c.findings.filter((f) => f.level === "error");
  $("#chk-badge").innerHTML = errs.length ? `<span class="state bad">${t("lvError")} ${errs.length}</span>` : `<span class="state ok">${t("chkOk")}</span>`;
  const item = (f) => {
    const title = t("t_" + f.code, f.axis);
    const has = typeof title === "string" && title !== "t_" + f.code;
    const body = t("chk_" + f.code, f.v || {}, f.axis);
    const lv = { error: "lvError", warn: "lvWarn", info: "lvInfo" }[f.level];
    const on = S.focus && S.focus.code === f.code && (S.focus.axis ?? null) === (f.axis ?? null);
    const btn = f.level === "error" ? `<button type="button" class="btn ghost sm" data-focus="${f.code}" data-axis="${f.axis ?? ""}" aria-pressed="${!!on}">${t("showOnMap")}</button>` : "";
    return `<li class="fi ${f.level}${on ? " on" : ""}"><span class="lv">${t(lv)}</span>${has ? `<b>${esc(title)}</b>` : ""}<p>${esc(body)}</p>${btn}</li>`;
  };
  const W0 = curW();
  const fix = W0.fixed ? `<div class="fixrow"><button type="button" class="btn sm${S.fix ? "" : " ghost"}" id="fix-toggle" aria-pressed="${S.fix}">${S.fix ? t("fixOff") : t("fixView")}</button>${S.fix ? `<small>${esc(t("fixedNote", fixText(W0.fixed.fixNotes)))}</small>` : ""}</div>` : "";
  body.innerHTML = (errs.length ? "" : `<p class="ok-line"><b class="ok-t">✓ ${t("chkOk")}</b><br><small>${t("chkOkSub")}</small></p>`)
    + `<ul class="chks">${c.findings.map(item).join("")}</ul>` + fix;
}
function fixText(notes) {
  return notes.map((n) => {
    if (n.code === "index") return `${t("t_index")} (${n.v.join(", ")})`;
    if (n.code === "origin") return `${t("t_origin")} (${n.v.join(", ")})`;
    if (n.code === "pitch") return `pitch ${n.axis ? "Y" : "X"} → ${f1(n.v)} µm`;
    if (n.code === "scribe") return `${n.axis ? "Y" : "X"} grid ${n.v > 0 ? "+" : ""}${f1(n.v)} µm`;
    return t("fixedPlan");
  }).join(" · ");
}

function renderFilters() {
  const W = curW();
  if (!W) { $("#classes").innerHTML = ""; return; }
  const cm = classColors(W), cc = classCounts(W), hid = new Set(S.filter.hidden);
  $("#classes").innerHTML = [...cm].map(([k, col]) => `<label class="cls"><input type="checkbox" data-cls="${k}" ${hid.has(k) ? "" : "checked"}><span class="sw" style="background:${col}"></span><span>${esc(W.classes.get(k) || `${t("noClass")} ${k}`)}</span><small>${fmtN(cc.get(k))}</small></label>`).join("");
  $("#f-smin").value = S.filter.smin ?? ""; $("#f-smax").value = S.filter.smax ?? ""; $("#f-flag").checked = S.filter.flagged;
}

function renderInfo() {
  const W = viewW();
  if (!W) { $("#info").innerHTML = ""; return; }
  const L = W.file.res.lot, g = W.geo;
  const rows = [
    ["i_file", W.file.name], ["i_ver", `KLARF ${W.version}`], ["i_lot", L.lot], ["i_device", L.device], ["i_step", L.step], ["i_setup", L.setup], ["i_station", L.station], ["i_time", L.resultTime],
    ["i_wafer", `${W.id}${W.slot != null ? ` · ${W.slot}` : ""}`], ["i_size", `${L.diameter || 300} mm`], ["i_notch", L.notch || "-"],
    ["i_pitch", `${f1(g.pitch[0])} × ${f1(g.pitch[1])} µm`], ["i_center", `${f1(W.center[0])}, ${f1(W.center[1])} µm`],
    ["i_plan", `${fmtN(W.plan.length / 2)} ${t("dies")}`], ["i_defects", fmtN(W.n)], ...(L.unit === "nm" ? [["i_unit", t("nmUnit")]] : []),
  ];
  $("#info").innerHTML = `<dl class="kv">${rows.filter((r) => r[1] != null && r[1] !== "").map(([k, v]) => `<dt>${t(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>`;
}

// ---------- 표 ----------
function filteredIdx(W) {
  const keep = keepFn(W), out = [];
  for (let i = 0; i < W.n; i++) if (!keep || keep(i)) out.push(i);
  return out;
}
const flagText = (v) => CODES.filter((c, k) => v & (1 << k)).map((c) => t("t_" + c, 0).replace(/ \(X\)$/, "")).join(", ");
function pager(total) {
  const per = S.settings.rows, a = Math.min(S.page * per, Math.max(0, total - 1));
  const b = Math.min(total, a + per);
  return { a, b, html: total > per ? `<div class="row pager"><button type="button" class="btn ghost sm" data-page="-1" ${a ? "" : "disabled"}>${t("prev")}</button><span>${t("pageOf", fmtN(a + 1), fmtN(b), fmtN(total))}</span><button type="button" class="btn ghost sm" data-page="1" ${b < total ? "" : "disabled"}>${t("next")}</button></div>` : "" };
}
function renderTables() {
  $$("#ttabs button").forEach((b) => { b.setAttribute("aria-selected", String(b.dataset.t === S.ttab)); b.tabIndex = b.dataset.t === S.ttab ? 0 : -1; });
  $("#tp").setAttribute("aria-labelledby", `tt-${S.ttab}`);
  const W = viewW(), tp = $("#tp");
  if (!W) { tp.innerHTML = `<p class="empty">${t("noFile")}</p>`; return; }
  if (S.ttab === "defects") {
    const idx = filteredIdx(W), pg = pager(idx.length), rows = [];
    for (let k = pg.a; k < pg.b; k++) {
      const i = idx[k];
      rows.push(`<tr data-def="${i}" tabindex="0"><td class="num">${W.did ? W.did[i] : i + 1}</td><td class="num">${W.xi[i]}, ${W.yi[i]}</td><td class="num">${f1(W.xr[i])}, ${f1(W.yr[i])}</td><td class="num">${(W.x[i] / 1000).toFixed(3)}, ${(W.y[i] / 1000).toFixed(3)}</td><td>${esc(W.classes.get(W.cls[i]) || W.cls[i])}</td><td class="num">${f1(W.size[i])}</td><td>${W.flag[i] ? `<span class="bad-t">${esc(flagText(W.flag[i]))}</span>` : ""}</td></tr>`);
    }
    tp.innerHTML = idx.length ? `${pg.html}<div class="tbl-wrap"><table class="t"><thead><tr><th>${t("thId")}</th><th>${t("thDie")}</th><th>${t("thRel")}</th><th>${t("thPos")}</th><th>${t("thClass")}</th><th>${t("thSize")}</th><th>${t("thFlag")}</th></tr></thead><tbody>${rows.join("")}</tbody></table></div>` : `<p class="empty">${t("noRows")}</p>`;
  } else if (S.ttab === "dies") {
    const keep = keepFn(W), counts = dieCounts(W.xi, W.yi, W.n, keep);
    const plan = new Set(); for (let k = 0; k < W.plan.length; k += 2) plan.add(`${W.plan[k]},${W.plan[k + 1]}`);
    const list = [...counts].sort((a, b) => b[1] - a[1]), pg = pager(list.length);
    const top = new Map();
    for (let i = 0; i < W.n; i++) { if (keep && !keep(i)) continue; const k = `${W.xi[i]},${W.yi[i]}`; let m = top.get(k); if (!m) top.set(k, (m = new Map())); m.set(W.cls[i], (m.get(W.cls[i]) || 0) + 1); }
    tp.innerHTML = list.length ? `${pg.html}<div class="tbl-wrap"><table class="t"><thead><tr><th>${t("thDie")}</th><th>${t("thCount")}</th><th>${t("thInPlan")}</th><th>${t("thTopClass")}</th></tr></thead><tbody>${list.slice(pg.a, pg.b).map(([k, v]) => `<tr data-die="${k}" tabindex="0"><td class="num">${k}</td><td class="num">${fmtN(v)}</td><td>${plan.size ? (plan.has(k) ? t("yes") : `<span class="bad-t">${t("no")}</span>`) : "-"}</td><td>${[...top.get(k)].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c, m]) => `${esc(W.classes.get(c) || c)} ${m}`).join(", ")}</td></tr>`).join("")}</tbody></table></div>` : `<p class="empty">${t("noRows")}</p>`;
  } else if (S.ttab === "rep") {
    const keep = keepFn(W);
    W._rep ||= {};
    const rk = `${S.settings.repTol}:${S.settings.repMin}:${S.filter.hidden.join()}:${S.filter.smin}:${S.filter.smax}:${S.filter.flagged}`;
    const reps = (W._rep[rk] ||= dieRepeaters(W.xr, W.yr, W.xi, W.yi, W.n, { tol: S.settings.repTol, minDies: S.settings.repMin, keep, pitch: W.geo.pitch }));
    const st = stackData(W);
    tp.innerHTML = `<h3>${t("repDie")}</h3>${reps.length ? `<div class="tbl-wrap"><table class="t"><thead><tr><th>${t("thPosIn")}</th><th>${t("thDiesN")}</th><th>${t("thHits")}</th><th></th></tr></thead><tbody>${reps.slice(0, 50).map((r, k) => `<tr><td class="num">${f1(r.xr)}, ${f1(r.yr)}</td><td class="num">${r.dies}</td><td class="num">${r.members.length}</td><td><button type="button" class="rowbtn" data-rep="${k}">${t("go")}</button></td></tr>`).join("")}</tbody></table></div>` : `<p class="empty">${t("noRep")}</p>`}
      <h3>${t("repWafer")}</h3>${st ? (st.reps.length ? `<div class="tbl-wrap"><table class="t"><thead><tr><th>${t("thPos")}</th><th>${t("thWafersN")}</th><th>${t("thHits")}</th><th></th></tr></thead><tbody>${st.reps.slice(0, 50).map((r, k) => `<tr><td class="num">${(r.x / 1000).toFixed(2)}, ${(r.y / 1000).toFixed(2)}</td><td class="num">${r.wafers}</td><td class="num">${r.hits}</td><td><button type="button" class="rowbtn" data-wrep="${k}">${t("go")}</button></td></tr>`).join("")}</tbody></table></div>` : `<p class="empty">${t("noRep")}</p>`) : `<p class="empty">${t("stackNeed")}</p>`}`;
    S._reps = reps;
  } else {
    const c = compareData();
    if (!c) { tp.innerHTML = `<p class="empty">${t("cmpNeed")}</p>`; return; }
    const A = c.A, B = c.B;
    const items = [
      ["i_file", label(A), label(B)], ["i_ver", A.version, B.version], ["i_pitch", A.geo.pitch.map(f1).join(" × "), B.geo.pitch.map(f1).join(" × ")],
      ["i_center", A.center.map(f1).join(", "), B.center.map(f1).join(", ")], ["i_size", A.file.res.lot.diameter, B.file.res.lot.diameter],
      ["i_notch", A.file.res.lot.notch, B.file.res.lot.notch], ["i_plan", A.plan.length / 2, B.plan.length / 2], ["i_defects", fmtN(A.n), fmtN(B.n)],
      ["checksTitle", A.chk.errors.join(", ") || t("none"), B.chk.errors.join(", ") || t("none")],
    ];
    const differ = (a, b, k) => k !== "i_file" && k !== "i_defects" && String(a) !== String(b);
    const defDiff = items.slice(2, 7).some(([k, a, b]) => differ(a, b, k));
    tp.innerHTML = `<p><b>${t("cmpCounts", { c: fmtN(c.m.common), a: fmtN(c.onlyA), b: fmtN(c.onlyB), tol: S.cmpTol })}</b></p>${defDiff ? `<p class="bad-t">${t("cmpPitchDiff")}</p>` : ""}
      <h3>${t("cmpHeader")}</h3><div class="tbl-wrap"><table class="t"><thead><tr><th>${t("thItem")}</th><th>A</th><th>B</th><th></th></tr></thead><tbody>${items.map(([k, a, b]) => `<tr${differ(a, b, k) ? ' class="changed"' : ""}><td>${t(k)}</td><td>${esc(a)}</td><td>${esc(b)}</td><td>${k === "i_file" || k === "i_defects" ? "" : differ(a, b, k) ? t("diff") : t("same")}</td></tr>`).join("")}</tbody></table></div>`;
  }
}

// ---------- 현장 검증 ----------
const RULE_KEYS = Object.keys(DEFAULT_RULES);
const builtinCases = () => SAMPLES.filter((s) => !s.big && !s.pair).map((s) => ({ id: "b:" + s.key, name: t("s_" + s.key), ver: s.ver, expect: s.expect, builtin: true, sample: s.key }));
const allCases = () => [...builtinCases(), ...S.cases];
const parsedCache = new Map();
function caseWafers(c) {
  if (parsedCache.has(c.id)) return parsedCache.get(c.id);
  const text = c.builtin ? SAMPLES.find((s) => s.key === c.sample).make() : c.text;
  const ws = parseText(text, c.name).wafers;
  parsedCache.set(c.id, ws);
  return ws;
}
function evalCase(c, rules) {
  const found = new Set();
  for (const W of caseWafers(c)) for (const e of checkWafer(W, rules).errors) found.add(e);
  const f = [...found].sort((a, b) => CODES.indexOf(a) - CODES.indexOf(b));
  const missed = c.expect.filter((e) => !found.has(e)), fa = f.filter((e) => !c.expect.includes(e));
  return { found: f, missed, fa, ok: !missed.length && !fa.length };
}
const evalMemo = new Map();
function evalSet(rules) {
  const key = JSON.stringify(RULE_KEYS.map((k) => rules[k])) + allCases().map((c) => c.id).join();
  if (!evalMemo.has(key)) evalMemo.set(key, evalSet0(rules));
  return evalMemo.get(key);
}
function evalSet0(rules) {
  const rows = allCases().map((c) => ({ c, r: evalCase(c, rules) }));
  const sum = { caught: 0, expect: 0, missed: 0, fa: 0 };
  for (const { c, r } of rows) { sum.expect += c.expect.length; sum.missed += r.missed.length; sum.caught += c.expect.length - r.missed.length; sum.fa += r.fa.length; }
  return { rows, sum };
}
const codesText = (a) => (a.length ? a.map((c) => t("t_" + c, 0).replace(/ \(X\)$/, "")).join(", ") : t("none"));
const kpis = (s) => `<div class="kpis"><div class="kpi ${s.missed ? "fail" : "pass"}"><b>${s.caught} / ${s.expect}</b><small>${t("kCaught")}</small></div><div class="kpi ${s.missed ? "fail" : "pass"}"><b>${s.missed}</b><small>${t("kMissed")}</small></div><div class="kpi ${s.fa ? "fail" : "pass"}"><b>${s.fa}</b><small>${t("kFalse")}</small></div></div>`;

function renderVerify() {
  $$("#vtabs button").forEach((b) => { b.setAttribute("aria-selected", String(b.dataset.v === S.vtab)); b.tabIndex = b.dataset.v === S.vtab ? 0 : -1; });
  $("#vp").setAttribute("aria-labelledby", `vt-${S.vtab}`);
  const vp = $("#vp");
  if (S.vtab === "repro") {
    const ev = evalSet(S.rules);
    vp.innerHTML = `<h3>${t("reproTitle")} <small>${t("reproHint")}</small></h3>${kpis(ev.sum)}
      <div class="tbl-wrap"><table class="t"><thead><tr><th>${t("thCase")}</th><th>${t("thFmt")}</th><th>${t("thExpect")}</th><th>${t("thFound")}</th><th>${t("thResult")}</th><th></th></tr></thead><tbody>
      ${ev.rows.map(({ c, r }) => `<tr><td>${esc(c.name)} <small>${c.builtin ? t("builtin") : t("mine")}</small></td><td>${esc(c.ver)}</td><td>${codesText(c.expect)}</td><td>${codesText(r.found)}</td>
        <td>${r.ok ? `<span class="ok-t">${t("resOk")}</span>` : `<span class="bad-t">${[r.missed.length ? t("resMiss") : "", r.fa.length ? t("resFalse") : ""].filter(Boolean).join(" · ")}</span>`}</td>
        <td class="nw"><button type="button" class="rowbtn" data-case="${esc(c.id)}">${t("open")}</button>${c.builtin ? "" : ` <button type="button" class="rowbtn" data-delcase="${esc(c.id)}">${t("del")}</button>`}</td></tr>`).join("")}
      </tbody></table></div><div class="row"><button type="button" class="btn ghost sm" id="save-case" ${curW() ? "" : "disabled"}>${t("saveCase")}</button></div>`;
  } else if (S.vtab === "compare") {
    const A = S.rules, B = S.draft;
    const field = (k, cfg, edit) => `<label class="field"><span>${t("rl_" + k)}</span><input type="number" step="any" data-rule="${k}" value="${cfg[k]}" ${edit ? "" : "disabled"}></label>`;
    let table = "";
    if (B && S.cmpRes) {
      const { a, b } = S.cmpRes;
      table = `<div class="vs"><div>${kpis(a.sum)}</div><div>${kpis(b.sum)}</div></div><div class="tbl-wrap"><table class="t"><thead><tr><th>${t("thCase")}</th><th>${t("thExpect")}</th><th>A</th><th>B</th></tr></thead><tbody>
        ${a.rows.map((ra, k) => { const rb = b.rows[k].r, ch = ra.r.found.join() !== rb.found.join(); return `<tr><td>${esc(ra.c.name)}</td><td>${codesText(ra.c.expect)}</td><td>${codesText(ra.r.found)}${ra.r.ok ? "" : ` <span class="bad-t">✕</span>`}</td><td class="${ch ? "changed" : ""}">${ch ? "<b>" : ""}${codesText(rb.found)}${ch ? "</b>" : ""}${rb.ok ? "" : ` <span class="bad-t">✕</span>`}</td></tr>`; }).join("")}</tbody></table></div>`;
    }
    vp.innerHTML = `<h3>${t("cmpTitle")} <small>${t("cmpHint")}</small></h3><div class="vs"><div class="cfg"><h4>${t("cfgA")} · v${S.history.length ? S.history[S.history.length - 1].v : 1}</h4>${RULE_KEYS.map((k) => field(k, A, false)).join("")}</div>
      <div class="cfg">${B ? `<h4>${t("cfgB")}</h4><form id="draft-form">${RULE_KEYS.map((k) => field(k, B, true)).join("")}</form><div class="row"><button type="button" class="btn sm" id="run-compare">${t("runCompare")}</button><button type="button" class="btn ghost sm" id="drop-draft">${t("dropDraft")}</button></div>` : `<button type="button" class="btn sm" id="make-draft">${t("makeDraft")}</button>`}</div></div>${table}`;
  } else if (S.vtab === "shadow") {
    const recs = S.draft ? S.shadow.filter((r) => r.draft === S.draft._id) : [];
    const agree = recs.filter((r) => r.same).length;
    vp.innerHTML = `<h3>${t("shadowTitle")} <small>${t("shadowHint")}</small></h3>${!S.draft ? `<p class="empty">${t("shadowNone")}</p>` : !recs.length ? `<p class="empty">${t("shadowEmpty")}</p>` : `
      <div class="kpis"><div class="kpi"><b>${recs.length}</b><small>${t("kRuns")}</small></div><div class="kpi"><b>${agree} / ${recs.length}</b><small>${t("kAgree")}</small></div></div>
      <div class="tbl-wrap"><table class="t"><thead><tr><th>${t("thTime")}</th><th>${t("thFile")}</th><th>A</th><th>B</th><th>${t("thSame")}</th></tr></thead><tbody>${recs.slice(-100).reverse().map((r) => `<tr class="${r.same ? "" : "changed"}"><td class="nw">${esc(r.t.slice(5, 19).replace("T", " "))}</td><td>${esc(r.file)} · ${esc(r.wafer)}</td><td>${codesText(r.a)}</td><td>${codesText(r.b)}</td><td>${r.same ? t("yes") : `<b>${t("no")}</b>`}</td></tr>`).join("")}</tbody></table></div>`}`;
  } else {
    const recs = S.draft ? S.shadow.filter((r) => r.draft === S.draft._id) : [];
    const evB = S.draft ? evalSet(S.draft) : null;
    const okRepro = evB && !evB.sum.missed && !evB.sum.fa, okShadow = recs.length >= SHADOW_RUNS;
    const cur = S.history.length ? S.history[S.history.length - 1].v : 1;
    vp.innerHTML = `<h3>${t("switchTitle")}</h3><p>${t("crit", { runs: SHADOW_RUNS })}</p>
      ${S.draft ? `<div class="kpis"><div class="kpi ${okRepro ? "pass" : "fail"}"><b>${evB.sum.missed} / ${evB.sum.fa}</b><small>${t("critRepro")} · ${t("kMissed")} / ${t("kFalse")}</small></div><div class="kpi ${okShadow ? "pass" : "fail"}"><b>${recs.length} / ${SHADOW_RUNS}</b><small>${t("critShadow")}</small></div></div>
      <button type="button" class="btn" id="switch-b" ${okRepro && okShadow ? "" : "disabled"} aria-describedby="sw-why">${t("switchBtn")}</button>${okRepro && okShadow ? "" : ` <small id="sw-why">${t("notReady")}</small>`}` : `<p class="empty">${t("shadowNone")}</p>`}
      <h3>${t("histTitle")}</h3><div class="tbl-wrap"><table class="t"><thead><tr><th>${t("thVer")}</th><th>${t("thTime")}</th><th>${t("thWhat")}</th><th></th></tr></thead><tbody>${[...S.history].reverse().map((h) => `<tr><td>v${h.v}</td><td class="nw">${esc(h.t.slice(0, 16).replace("T", " "))}</td><td>${esc(Array.isArray(h.what) ? t(h.what[0], h.what[1]) : t(h.what))}</td><td>${h.v === cur ? `<small>${t("current")}</small>` : `<button type="button" class="rowbtn" data-rollback="${h.v}">${t("rollback")}</button>`}</td></tr>`).join("")}</tbody></table></div>`;
  }
}

async function pushHistory(what) {
  const v = (S.history.length ? S.history[S.history.length - 1].v : 0) + 1;
  const h = { v, t: new Date().toISOString(), rules: clone(S.rules), what };
  S.history.push(h); await db.put("history", h);
  await db.put("kv", S.rules, "rules");
}
function recheckAll() { for (const W of wafers()) runChecks(W, false); renderAll(false); }

// ---------- 전체 ----------
function renderAll(newData) {
  if (newData) { S._stack = null; S._cmp = null; }
  renderFiles(); renderFilters(); renderChecks(); renderInfo(); renderMap(); renderTables(); renderVerify(); renderCmpPick();
  saveUi();
}
function renderCmpPick() {
  const ws = wafers(), opt = (k) => ws.map((w) => `<option value="${w.key}" ${w.key === k ? "selected" : ""}>${esc(label(w))}</option>`).join("");
  $("#cmp-a").innerHTML = opt(S.cmpA); $("#cmp-b").innerHTML = opt(S.cmpB); $("#cmp-tol").value = S.cmpTol;
}

function selectWafer(key) {
  if (!byKey(key)) return;
  S.cur = key; S.fix = false; S.focus = null; S.page = 0; S.pick = null;
  renderAll(false);
}

function showTip(h, x, y) {
  const tip = $("#tip");
  if (!h) { tip.hidden = true; return; }
  const W = viewW();
  let html = "";
  if (S.mode === "compare" || S.mode === "stack") {
    html = h.idx >= 0 ? `${t("hvPos")} <b>${(map.M.x[h.idx] / 1000).toFixed(3)}, ${(map.M.y[h.idx] / 1000).toFixed(3)}</b> mm` : "";
  } else if (W) {
    if (S.mode === "diestack") html = `${t("hvRel")} <b>${f1(h.X + W.geo.pitch[0] / 2)}, ${f1(h.Y + W.geo.pitch[1] / 2)}</b> µm`;
    else html = `${t("hvDie")} <b>${h.die[0]}, ${h.die[1]}</b>`;
    if (h.idx >= 0) { const i = h.idx; html += `<br>${t("hvDefect")} <b>${W.did ? W.did[i] : i + 1}</b> · ${esc(W.classes.get(W.cls[i]) || W.cls[i])} · ${f1(W.size[i])} µm<br>${t("hvRel")} ${f1(W.xr[i])}, ${f1(W.yr[i])} µm${W.flag[i] ? `<br><b>${esc(flagText(W.flag[i]))}</b>` : ""}`; }
  }
  if (!html) { tip.hidden = true; return; }
  tip.innerHTML = html; tip.hidden = false;
  const r = $("#map").getBoundingClientRect(), pr = $(".map-panel").getBoundingClientRect();
  tip.style.left = `${Math.min(r.left - pr.left + x + 14, pr.width - 240)}px`; tip.style.top = `${r.top - pr.top + y + 14}px`;
}

function focusDefect(i) {
  const W = viewW(); if (!W) return;
  if (S.mode !== "defects" && S.mode !== "heat") { S.mode = "defects"; renderMap(); }
  S.pick = { pt: [W.x[i], W.y[i]], r: 10, width: 3, color: css("--ink") };
  map.center(W.x[i], W.y[i], Math.max(map.M.view.s, 40 / Math.min(...W.geo.pitch)));
  setMarks();
  $("#map").scrollIntoView({ block: "nearest", behavior: "smooth" });
}

// ---------- 내보내기 ----------
const baseName = () => (curW()?.file.name || "klarf").replace(/\.[^.]+$/, "");
function exportPng() {
  const W = viewW(); if (!W) return;
  map.snapshot(`${label(W)} · ${t({ defects: "modeDefects", heat: "modeHeat", stack: "modeStack", diestack: "modeDieStack", compare: "modeCompare" }[S.mode])}`).toBlob((b) => download(`${baseName()}_${S.mode}.png`, b));
}
function exportCsv() {
  const W = viewW(); if (!W) return;
  const head = "DEFECTID,XINDEX,YINDEX,XREL_um,YREL_um,X_um,Y_um,CLASSNUMBER,CLASSNAME,SIZE_um,CHECK";
  const rows = filteredIdx(W).map((i) => [W.did ? W.did[i] : i + 1, W.xi[i], W.yi[i], W.xr[i].toFixed(3), W.yr[i].toFixed(3), W.x[i].toFixed(3), W.y[i].toFixed(3), W.cls[i], `"${String(W.classes.get(W.cls[i]) || "").replace(/"/g, '""')}"`, W.size[i].toFixed(3), `"${CODES.filter((c, k) => W.flag[i] & (1 << k)).join(" ")}"`].join(","));
  download(`${baseName()}_defects.csv`, "﻿" + [head, ...rows].join("\r\n"), "text/csv");
}
function exportSummary() {
  const W = viewW(); if (!W) return;
  const L = W.file.res.lot, cc = classCounts(W);
  const out = {
    app: `klarf-viewer ${VERSION}`, generated: new Date().toISOString(), file: W.file.name, format: `KLARF ${W.version}`, lot: L.lot, device: L.device, step: L.step, wafer: W.id, slot: W.slot,
    mapDefinition: { diameterMm: L.diameter, notch: L.notch, diePitchUm: W.geo.pitch, sampleCenterLocationUm: W.center, testPlanDies: W.plan.length / 2 },
    defects: W.n, classes: Object.fromEntries([...cc].map(([k, v]) => [W.classes.get(k) || String(k), v])), defectDies: dieCounts(W.xi, W.yi, W.n).size,
    mapCheck: { rules: S.rules, errors: W.chk.errors, findings: W.chk.findings.map(({ members, dies, ...f }) => ({ ...f, members: members?.length, dies: dies?.length, message: t("chk_" + f.code, f.v || {}, f.axis) })) },
    lineErrors: W.file.res.nErrors, fixedView: S.fix && W.fixed ? W.fixed.fixNotes : undefined,
  };
  download(`${baseName()}_summary.json`, JSON.stringify(out, null, 2), "application/json");
}

// ---------- 대화 상자 ----------
function ask(title, body, { input, checks } = {}) {
  return new Promise((res) => {
    const d = $("#ask-dlg");
    $("#ask-h").textContent = title; $("#ask-body").innerHTML = body || "";
    $("#ask-field").hidden = !input; $("#ask-label").textContent = input || ""; $("#ask-input").value = "";
    $("#ask-yes").onclick = () => { d.close(); res({ value: $("#ask-input").value, checks: $$("#ask-body input[type=checkbox]:checked").map((x) => x.value) }); };
    d.onclose = () => res(null);
    d.showModal();
    (input ? $("#ask-input") : $("#ask-yes")).focus();
  });
}

async function saveCase() {
  const W = curW(); if (!W) return;
  const F = W.file;
  if (F.size > CASE_LIMIT) { toast(t("caseTooBig")); return; }
  const r = await ask(t("saveCase"), `<p>${t("caseExpect")}</p>${CODES.map((c) => `<label class="field chk"><input type="checkbox" value="${c}" ${W.chk.errors.includes(c) ? "checked" : ""}> ${esc(t("t_" + c, 0).replace(/ \(X\)$/, ""))}</label>`).join("")}`, { input: t("caseName") });
  if (!r) return;
  const c = { id: "u:" + Date.now(), name: r.value || F.name, ver: W.version, expect: r.checks, text: await F.blob.text() };
  S.cases.push(c); await db.put("cases", c);
  renderVerify(); toast(t("caseSaved"));
}

// ---------- 도움말 ----------
async function renderHelp() {
  const errs = (await db.all("errors")).slice(-20).reverse();
  const ko = getLang() === "ko";
  const H = ko ? {
    use: ["사용 순서", ["Klarf 를 열면 맵 정의 검증이 먼저 돌고, 결과가 오른쪽 '맵 정의 검증'에 나옵니다. 오류마다 '지도에서 보기'로 걸린 다이 · 결함을 강조합니다.", "원인을 추정한 오류(pitch · 스크라이브 · 원점 · 인덱스)는 '추정값으로 고쳐 보기'로 고친 맵을 보고 다시 검증할 수 있습니다. 파일은 바꾸지 않습니다.", "보기: 결함(클래스 색) · 다이 히트맵(다이당 결함 수) · 웨이퍼 겹치기(여러 장의 같은 자리 결함) · 다이 겹치기(모든 다이를 한 다이에 겹침, 스크라이브 · 레티클 반복이 보임) · 두 파일 비교(A 에만 · B 에만 · 공통).", "필터: 클래스 · 크기 · 검증에 걸린 결함만. 표(결함 · 다이 · 반복 결함 · 비교 결과)는 지도와 같은 내용을 글로 보여줍니다."]],
    fmt: ["읽는 형식", ["KLARF 1.1 · 1.2 (평면형): <code>DiePitch</code> · <code>SampleCenterLocation</code> · <code>SampleTestPlan</code> · <code>DefectRecordSpec</code> · <code>DefectList</code> 등. 한 파일에 웨이퍼 여러 장, 줄을 넘는 행, IMAGELIST, DefectList 안의 TiffFileName 줄을 읽습니다.", "KLARF 1.8 (레코드형): <code>Record FileRecord / LotRecord / WaferRecord</code>, <code>Field</code>, <code>List … Columns … Data</code>. 길이가 nm 정수이면 µm 로 바꿉니다 (SampleSize 로 판단). ImageList 칸은 이미지 수만 읽습니다.", "좌표: 웨이퍼 중심 기준 X = XINDEX × DiePitchX + XREL − SampleCenterLocationX (Y 도 같음, 위쪽이 +Y). 공개 오픈소스 구현(klarfkit · klarf_reader)과 같은 식입니다.", "읽지 못한 줄은 줄 번호와 사유를 보여주고, 나머지는 계속 읽습니다. 인코딩은 UTF-8 (BOM 있으면 UTF-16)."]],
    chk: ["맵 정의 검증 5가지", ["<b>pitch</b>: 결함의 웨이퍼 좌표를 X · Y 로 모아 선언 pitch ±5% 안에서 다이 주기(1~8차 고조파)를 찾습니다. 주기가 1% 넘게 다르면 오류.", "<b>스크라이브</b>: 모든 결함을 한 다이에 겹쳐(XREL · YREL) 결함이 없는 띠를 찾습니다. 띠가 다이 경계가 아닌 다이 안쪽에 있으면 격자 원점이 어긋난 것.", "<b>원점 다이</b>: 테스트 플랜 다이가 웨이퍼 원 밖에 통째로 있으면 오류. 맵을 몇 다이 옮기면 맞는지 함께 보여줍니다.", "<b>웨이퍼 밖 결함</b>: 반지름 + 여유(기본 500 µm) 밖 결함. 원점 · 인덱스 오류로 설명되는 것은 세지 않습니다.", "<b>다이 인덱스</b>: XREL · YREL 이 0 ~ pitch 밖이거나, 결함의 다이가 테스트 플랜에 없으면 오류.", "결함이 적거나(기본 2,000개 미만) 스크라이브까지 검사한 파일처럼 신호가 없으면 판정하지 않고 '참고'로 적습니다."]],
    flow: ["현장 검증 절차", ["재현: 맵 오류가 하나씩 들어간 합성 파일 7개가 기본으로 있고, 내 파일을 '사례로 저장'해 있어야 할 오류 라벨과 함께 더합니다.", "비교: 검증 규칙(허용 차이 · 여유 등)을 바꾼 초안 B 를 지금 규칙 A 와 같은 세트에서 계산해 바뀐 칸만 강조합니다.", "Shadow: 초안 B 가 있으면 파일을 열 때마다 B 도 함께 돌려 결과만 기록합니다. 화면 판정은 A 가 합니다.", "전환 · 롤백: B 가 재현 세트에서 놓침 0 · 오검 0 이고 Shadow 기록이 3건 이상이면 전환할 수 있습니다. 모든 규칙 변경은 버전으로 남아 한 번에 되돌립니다."]],
    keys: ["키보드", ["지도에서 <kbd>←</kbd> <kbd>→</kbd> <kbd>↑</kbd> <kbd>↓</kbd> 이동, <kbd>+</kbd> <kbd>−</kbd> 확대 · 축소, <kbd>0</kbd> 전체", "표 · 탭에서 <kbd>Tab</kbd> · <kbd>Enter</kbd>, 탭 사이 <kbd>←</kbd> <kbd>→</kbd>", "<kbd>?</kbd> 이 도움말"]],
    priv: ["개인정보", ["Klarf 파일은 이 브라우저 안에서만 읽습니다. 서버가 없고, 외부 오류 수집도 없습니다.", "저장: 설정 · 검증 규칙 이력 · Shadow 기록 · 재현 사례 · 마지막으로 연 파일(합계 200MB 미만)이 이 브라우저의 IndexedDB 에만 남습니다. 설정 → 데이터에서 백업 · 삭제합니다.", "LLM 은 쓰지 않습니다."]],
    faq: ["FAQ", ["<b>맵이 비어 보여요</b> — '읽지 못한 줄'을 펼쳐 사유를 보세요. DefectRecordSpec 에 XREL · YREL · XINDEX · YINDEX 가 있어야 합니다.", "<b>정상 파일인데 오류가 나요</b> — 검증 규칙의 허용값이 내 장비와 다를 수 있습니다. '현장 검증 → 비교'에서 초안을 만들어 재현 세트로 확인한 뒤 전환하세요.", "<b>스크라이브 판정을 안 해요</b> — 스크라이브까지 검사한 파일이면 결함 없는 띠가 없어 판정하지 않습니다. 정상입니다.", "<b>큰 파일은요</b> — 결함 100만 개(약 70MB)를 2 ~ 3초 안에 엽니다. 메모리는 결함 100만 개에 약 200MB 를 씁니다.", "<b>오프라인에서도 되나요</b> — 한 번 열면 앱 파일이 저장되어 오프라인으로 열립니다."]],
  } : {
    use: ["How to use", ["When a Klarf opens, the map-definition check runs first and its result appears under 'Map-definition check'. 'Show on map' highlights the dies and defects behind each error.", "For errors with an estimated cause (pitch · scribe · origin · index), 'View with estimated fix' shows the corrected map and re-runs the check. The file is not changed.", "Views: defects (class colors) · die heatmap (defects per die) · wafer overlay (same-spot defects across wafers) · die overlay (all dies folded into one; shows scribe and reticle repeaters) · compare two files (only A · only B · common).", "Filters: class · size · only flagged defects. The tables (defects · dies · repeaters · comparison) carry the same content as the map in text."]],
    fmt: ["Formats", ["KLARF 1.1 · 1.2 (flat): <code>DiePitch</code> · <code>SampleCenterLocation</code> · <code>SampleTestPlan</code> · <code>DefectRecordSpec</code> · <code>DefectList</code> and more. Several wafers per file, rows wrapped over lines, IMAGELIST, and TiffFileName lines inside DefectList are handled.", "KLARF 1.8 (record): <code>Record FileRecord / LotRecord / WaferRecord</code>, <code>Field</code>, <code>List … Columns … Data</code>. Integer nm lengths are converted to µm (decided by SampleSize). ImageList cells are read as image counts.", "Coordinates: from the wafer center, X = XINDEX × DiePitchX + XREL − SampleCenterLocationX (same for Y, +Y up), as in the public open-source implementations (klarfkit · klarf_reader).", "Unreadable lines are listed with line number and reason; reading continues. Encoding UTF-8 (UTF-16 with BOM)."]],
    chk: ["Five map-definition checks", ["<b>pitch</b>: defect wafer positions are projected on X and Y and the die period (harmonics 1–8) is searched within ±5% of the declared pitch. More than 1% apart is an error.", "<b>scribe</b>: all defects are folded into one die (XREL · YREL) to find a defect-free band. A band inside the die instead of at its boundary means the grid origin is off.", "<b>origin die</b>: test-plan dies entirely outside the wafer circle are an error; the die shift that fits is shown.", "<b>outside wafer</b>: defects beyond radius + margin (default 500 µm). Those explained by an origin or index error are not counted.", "<b>die index</b>: XREL · YREL outside 0 – pitch, or defects in dies not in the test plan.", "With few defects (default under 2,000) or no signal (e.g. the scribe was inspected), the check is not judged and is noted instead."]],
    flow: ["Field validation", ["Reproduce: seven synthetic files with one map error each are built in; add your files with 'Save as a case' and the errors they should have.", "Compare: a draft B of the check rules (tolerances, margins) runs on the same set as the current rules A; only changed cells are highlighted.", "Shadow: while draft B exists, B also runs on every file you open and only its result is logged. A decides what the screen shows.", "Switch · rollback: when B has 0 missed and 0 false alarms on the repro set and 3+ shadow records, you can switch. Every rules change is versioned and can be rolled back in one click."]],
    keys: ["Keyboard", ["Map: <kbd>←</kbd> <kbd>→</kbd> <kbd>↑</kbd> <kbd>↓</kbd> pan, <kbd>+</kbd> <kbd>−</kbd> zoom, <kbd>0</kbd> fit", "Tables · tabs: <kbd>Tab</kbd> · <kbd>Enter</kbd>, <kbd>←</kbd> <kbd>→</kbd> between tabs", "<kbd>?</kbd> this help"]],
    priv: ["Privacy", ["Klarf files are read only inside this browser. No server, no external error reporting.", "Stored only in this browser's IndexedDB: settings · rule history · shadow log · repro cases · last opened files (under 200 MB in total). Back up or erase in Settings → Data.", "No LLM is used."]],
    faq: ["FAQ", ["<b>The map is empty</b> — open 'unreadable lines' for the reasons. DefectRecordSpec needs XREL · YREL · XINDEX · YINDEX.", "<b>A good file shows errors</b> — the rule tolerances may not fit your tool. Create a draft in 'Field validation → Compare', test it on the repro set, then switch.", "<b>The scribe is not judged</b> — if the scribe was inspected too, there is no defect-free band. That is expected.", "<b>Large files</b> — 1 million defects (about 70 MB) open in 2–3 seconds, using about 200 MB of memory.", "<b>Offline</b> — after the first visit the app files are cached and open offline."]],
  };
  const sec = ([h, items]) => `<h3>${h}</h3><ul>${items.map((x) => `<li>${x}</li>`).join("")}</ul>`;
  $("#help-body").innerHTML = [H.use, H.fmt, H.chk, H.flow, H.keys, H.priv, H.faq].map(sec).join("") + `
    <h3>${ko ? "오류 기록" : "Error log"} <small>${ko ? "이 기기에만 저장 · 최근 200건" : "stored on this device · last 200"}</small></h3>
    ${errs.length ? `<pre class="pv">${esc(errs.map((e) => `${e.t}  ${e.msg}`).join("\n"))}</pre><div class="row"><button class="btn ghost sm" type="button" id="err-export">${ko ? "오류 기록 내보내기" : "Export error log"}</button><button class="btn ghost sm" type="button" id="err-clear">${ko ? "지우기" : "Clear"}</button></div>` : `<p class="hint">${ko ? "기록된 오류가 없습니다." : "No errors recorded."}</p>`}
    <h3>${ko ? "버전" : "Version"}</h3><p>klarf-viewer v${VERSION} · MIT License · Pretendard (OFL-1.1)</p>`;
}

// ---------- 언어 · 테마 ----------
function fillSamples() {
  const sel = $("#sample-pick"), v = sel.value;
  sel.innerHTML = SAMPLES.map((s) => `<option value="${s.key}">${esc(t("s_" + s.key))}</option>`).join("");
  if (v) sel.value = v;
}
function applyLang(l) {
  setLang(l);
  S.settings.lang = l;
  applyStatic();
  fillSamples();
  document.title = t("appName");
  document.body.dataset.drop = t("dropHere");
  $("#lang").value = l;
  renderAll(false);
}
function applyTheme() {
  const th = S.settings.theme;
  if (th === "auto") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = th;
  $("#theme").textContent = { auto: "◐", light: "☀", dark: "☾" }[th];
  renderAll(false);
}

// ---------- 이벤트 ----------
function bind() {
  map = createMap($("#map"), {
    onHover: (h, x, y) => showTip(h, x, y),
    onPick: (h) => {
      if (!h) return;
      if (h.idx >= 0 && (S.mode === "defects" || S.mode === "heat" || S.mode === "diestack")) {
        S.ttab = "defects";
        const W = viewW(), idx = filteredIdx(W), k = idx.indexOf(h.idx);
        if (k >= 0) S.page = Math.floor(k / S.settings.rows);
        renderTables();
        const row = $(`#tp tr[data-def="${h.idx}"]`);
        if (row) { row.classList.add("hl"); row.scrollIntoView({ block: "nearest" }); }
      }
    },
  });
  window.klarfViewer = { map, S };

  document.addEventListener("click", async (e) => {
    const b = e.target.closest("button, tr[data-def], tr[data-die]");
    if (!b) return;
    const d = b.dataset;
    if (d.w) return selectWafer(d.w);
    if (d.rm) { S.files = S.files.filter((F) => F.fid !== +d.rm); if (!byKey(S.cur)) S.cur = wafers()[0]?.key ?? null; S.fix = false; renderAll(true); saveOpen(); return; }
    if (d.mode) { S.mode = d.mode; S.pick = null; if (S.mode === "compare") pickCompare(); renderMap(); renderTables(); saveUi(); return; }
    if (d.focus) { const f = { code: d.focus, axis: d.axis === "" ? null : +d.axis }; S.focus = S.focus && S.focus.code === f.code && S.focus.axis === f.axis ? null : f; if (S.focus && ["pitch", "scribe"].includes(f.code)) S.mode = "diestack"; else if (S.focus && S.mode !== "heat") S.mode = "defects"; renderChecks(); renderMap(); return; }
    if (d.page) { S.page = Math.max(0, S.page + +d.page); renderTables(); return; }
    if (d.def) return focusDefect(+d.def);
    if (d.die) { const W = viewW(), [i, j] = d.die.split(",").map(Number), [px, py] = W.geo.pitch, [gx, gy] = W.geo.grid; S.pick = { die: [i, j], width: 3, color: css("--ink") }; map.center(gx + (i + 0.5) * px, gy + (j + 0.5) * py, Math.max(map.M.view.s, 300 / Math.max(px, py))); setMarks(); return; }
    if (d.rep) { const r = S._reps[+d.rep], W = viewW(); S.mode = "diestack"; renderMap(); S.pick = { pt: [r.xr - W.geo.pitch[0] / 2, r.yr - W.geo.pitch[1] / 2], r: 12, width: 3, color: css("--ink") }; setMarks(); return; }
    if (d.wrep) { const st = stackData(curW()), r = st.reps[+d.wrep]; S.mode = "stack"; renderMap(); S.pick = { pt: [r.x, r.y], r: 12, width: 3, color: css("--ink") }; map.center(r.x, r.y, Math.max(map.M.view.s, 0.02)); setMarks(); return; }
    if (d.case) { const c = allCases().find((x) => x.id === d.case); if (c.builtin) loadSample(c.sample); else openFiles([new File([c.text], c.name + ".klarf")], { keep: false }); return; }
    if (d.delcase) { S.cases = S.cases.filter((c) => c.id !== d.delcase); parsedCache.delete(d.delcase); await db.del("cases", d.delcase); renderVerify(); return; }
    if (d.rollback) {
      const h = S.history.find((x) => x.v === +d.rollback);
      S.rules = clone(h.rules); await pushHistory(["histRollback", h.v]); recheckAll(); toast(t("rolledBack", h.v)); return;
    }
    if (d.close != null) { b.closest("dialog").close(); return; }
    switch (b.id) {
      case "fix-toggle": S.fix = !S.fix; S.focus = null; S.pick = null; renderChecks(); renderInfo(); renderMap(); renderTables(); return;
      case "save-case": return saveCase();
      case "make-draft": S.draft = { ...clone(S.rules), _id: Date.now() }; S.cmpRes = null; await db.put("kv", S.draft, "draft"); renderVerify(); return;
      case "drop-draft": S.draft = null; S.cmpRes = null; await db.del("kv", "draft"); renderVerify(); return;
      case "run-compare": {
        readDraft(); b.classList.add("loading");
        await new Promise((r) => setTimeout(r, 20));
        S.cmpRes = { a: evalSet(S.rules), b: evalSet(S.draft) }; renderVerify(); return;
      }
      case "switch-b": {
        S.rules = Object.fromEntries(RULE_KEYS.map((k) => [k, S.draft[k]]));
        S.draft = null; S.cmpRes = null; await db.del("kv", "draft");
        await pushHistory("histSwitch"); recheckAll(); toast(t("switched")); return;
      }
    }
  });
  document.addEventListener("keydown", (e) => {
    const tr = e.target.closest?.("tr[data-def], tr[data-die]");
    if (tr && e.key === "Enter") { tr.click(); return; }
    const tab = e.target.closest?.('[role="tab"]');
    if (tab && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
      const list = $$('[role="tab"]', tab.parentElement), k = list.indexOf(tab), nx = list[(k + (e.key === "ArrowRight" ? 1 : list.length - 1)) % list.length];
      nx.click(); nx.focus(); e.preventDefault();
    }
    if (e.key === "?" && !/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) { openHelp(); }
  });
  $("#ttabs").addEventListener("click", (e) => { const b = e.target.closest("[data-t]"); if (b) { S.ttab = b.dataset.t; S.page = 0; renderTables(); saveUi(); } });
  $("#vtabs").addEventListener("click", (e) => { const b = e.target.closest("[data-v]"); if (b) { S.vtab = b.dataset.v; renderVerify(); saveUi(); } });
  $("#vp").addEventListener("change", (e) => { if (e.target.dataset.rule) { readDraft(); db.put("kv", S.draft, "draft"); } });

  $("#load-sample").onclick = () => loadSample($("#sample-pick").value);
  $("#download-sample").onclick = () => {
    const s = SAMPLES.find((x) => x.key === $("#sample-pick").value);
    if (s.big) toast(t("genBig"));
    setTimeout(() => { const v = s.make(); (s.pair ? v : [v]).forEach((x, k) => download(sampleName(s, k), x, "text/plain")); }, 30);
  };
  $("#file").onchange = (e) => { const fs = [...e.target.files]; e.target.value = ""; if (fs.length) openFiles(fs, { keep: S.files.length > 0 && S.files.every((F) => !F.sample) }); };
  $("#cancel-read").onclick = () => worker?.postMessage({ type: "cancel" });
  $("#fit").onclick = () => map.fit();
  $("#exp-png").onclick = exportPng; $("#exp-csv").onclick = exportCsv; $("#exp-sum").onclick = exportSummary;
  $("#classes").addEventListener("change", (e) => {
    const c = +e.target.dataset.cls, hid = new Set(S.filter.hidden);
    if (e.target.checked) hid.delete(c); else hid.add(c);
    S.filter.hidden = [...hid]; S.page = 0; renderMap(); renderTables(); saveUi();
  });
  const num = (v) => (v === "" ? null : Number(v));
  for (const id of ["f-smin", "f-smax"]) $("#" + id).addEventListener("change", () => { S.filter.smin = num($("#f-smin").value); S.filter.smax = num($("#f-smax").value); S.page = 0; renderMap(); renderTables(); saveUi(); });
  $("#f-flag").onchange = (e) => { S.filter.flagged = e.target.checked; S.page = 0; renderMap(); renderTables(); saveUi(); };
  $("#cmp-a").onchange = (e) => { S.cmpA = e.target.value; renderMap(); renderTables(); };
  $("#cmp-b").onchange = (e) => { S.cmpB = e.target.value; renderMap(); renderTables(); };
  $("#cmp-tol").onchange = (e) => { S.cmpTol = Math.max(1, Number(e.target.value) || 20); renderMap(); renderTables(); saveUi(); };

  // 끌어다 놓기
  let dragN = 0;
  addEventListener("dragenter", (e) => { e.preventDefault(); dragN++; document.body.classList.add("dragging"); });
  addEventListener("dragleave", () => { if (--dragN <= 0) { dragN = 0; document.body.classList.remove("dragging"); } });
  addEventListener("dragover", (e) => e.preventDefault());
  addEventListener("drop", (e) => {
    e.preventDefault(); dragN = 0; document.body.classList.remove("dragging");
    const fs = [...(e.dataTransfer?.files || [])];
    if (fs.length) openFiles(fs, { keep: S.files.length > 0 && S.files.every((F) => !F.sample) });
  });

  $("#lang").onchange = (e) => { applyLang(e.target.value); db.put("kv", S.settings, "settings"); };
  $("#theme").onclick = () => { S.settings.theme = { auto: "light", light: "dark", dark: "auto" }[S.settings.theme]; applyTheme(); db.put("kv", S.settings, "settings"); };
  matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => { if (S.settings.theme === "auto") renderAll(false); });
  $("#open-help").onclick = openHelp;
  $("#open-settings").onclick = () => {
    $("#s-point").value = S.settings.point; $("#s-rows").value = S.settings.rows; $("#s-reptol").value = S.settings.repTol; $("#s-repmin").value = S.settings.repMin; $("#s-stacktol").value = S.settings.stackTol;
    $("#set-msg").textContent = ""; $("#set-dlg").showModal();
  };
  $("#set-form").addEventListener("submit", () => {
    const v = (id, lo, hi, def) => Math.min(hi, Math.max(lo, Number($(id).value) || def));
    Object.assign(S.settings, { point: v("#s-point", 1, 8, 2.5), rows: v("#s-rows", 50, 2000, 200), repTol: v("#s-reptol", 1, 1000, 15), repMin: v("#s-repmin", 2, 1000, 3), stackTol: v("#s-stacktol", 1, 10000, 100) });
    db.put("kv", S.settings, "settings");
    for (const W of wafers()) W._rep = null;
    S._stack = null; renderAll(false); toast(t("saved"));
  });
  $("#backup-export").onclick = async () => download(`klarf-viewer-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(await db.exportBackup()), "application/json");
  $("#backup-import").onchange = async (e) => {
    const f = e.target.files[0]; e.target.value = "";
    if (!f) return;
    try { await db.importBackup(JSON.parse(await f.text())); await loadState(); recheckAll(); $("#set-msg").textContent = t("importDone"); }
    catch (err) { $("#set-msg").textContent = `${t("importErr")}: ${err.message}`; }
  };
  $("#reset-all").onclick = async () => {
    const r = await ask(t("resetAll"), esc(t("resetAsk")));
    if (!r) return;
    await db.clearAll(); S.cases = []; S.shadow = []; S.history = []; S.draft = null; S.rules = { ...DEFAULT_RULES }; parsedCache.clear();
    await pushHistory("histInit"); recheckAll(); toast(t("resetDone"));
  };
  $("#help-dlg").addEventListener("click", async (e) => {
    if (e.target.id === "err-export") download("klarf-viewer-errors.json", JSON.stringify(await db.all("errors"), null, 2), "application/json");
    if (e.target.id === "err-clear") { await db.clear("errors"); renderHelp(); }
  });
  $("#ob-dlg").addEventListener("close", () => db.put("kv", true, "onboarded"));
}
function readDraft() {
  if (!S.draft) return;
  for (const el of $$("#draft-form [data-rule]")) { const v = Number(el.value); if (Number.isFinite(v)) S.draft[el.dataset.rule] = v; }
}
async function openHelp() { await renderHelp(); $("#help-dlg").showModal(); }

// ---------- 시작 ----------
async function loadState() {
  const s = await db.get("kv", "settings");
  if (s) Object.assign(S.settings, s);
  const r = await db.get("kv", "rules");
  if (r) S.rules = { ...DEFAULT_RULES, ...r };
  S.draft = (await db.get("kv", "draft")) || null;
  S.history = (await db.all("history")).sort((a, b) => a.v - b.v);
  S.shadow = await db.all("shadow");
  S.cases = await db.all("cases");
  const ui = await db.get("kv", "ui");
  if (ui) { S.mode = ui.mode || S.mode; S.ttab = ui.ttab || S.ttab; S.vtab = ui.vtab || S.vtab; S.filter = { ...S.filter, ...ui.filter }; S.cmpTol = ui.cmpTol || S.cmpTol; }
  return ui;
}

function registerSW() {
  if (!("serviceWorker" in navigator) || location.protocol === "file:") return;
  navigator.serviceWorker.register("sw.js").then((reg) => {
    reg.addEventListener("updatefound", () => {
      const nw = reg.installing;
      nw?.addEventListener("statechange", () => { if (nw.state === "installed" && navigator.serviceWorker.controller) toast(t("updateReady"), { label: t("reload"), run: () => nw.postMessage("skip") }); });
    });
  }).catch((e) => db.logError(e));
  const had = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => { if (had && !reloaded) { reloaded = true; location.reload(); } });
}

async function start() {
  window.addEventListener("error", (e) => { db.logError(e.error || e.message); toast(t("errLogged")); });
  window.addEventListener("unhandledrejection", (e) => { db.logError(e.reason); toast(t("errLogged")); });
  const ui = await loadState();
  $("#ver-line").textContent = `klarf-viewer v${VERSION}`;
  bind();
  setLang(S.settings.lang || (navigator.language?.startsWith("ko") ? "ko" : "en"));
  applyStatic(); fillSamples();
  document.title = t("appName"); document.body.dataset.drop = t("dropHere"); $("#lang").value = getLang();
  const th = S.settings.theme; if (th !== "auto") document.documentElement.dataset.theme = th;
  $("#theme").textContent = { auto: "◐", light: "☀", dark: "☾" }[th];
  if (!S.history.length) await pushHistory("histInit");
  if (!(await db.get("kv", "onboarded"))) $("#ob-dlg").showModal();
  const open = await db.get("files", "open");
  if (open?.length) {
    for (const o of open) {
      if (o.sample) await loadSample(o.sample, true);
      else if (o.blob) await openFiles([new File([o.blob], o.name)], { keep: true });
    }
    if (ui?.curIdx >= 0 && wafers()[ui.curIdx]) selectWafer(wafers()[ui.curIdx].key);
    toast(t("restored", S.files.map((F) => F.name).join(", ")));
  } else await loadSample("ok12");
  registerSW();
  window.klarfViewer.ready = true;
}

start();
