// KLARF 파서 (1.1 · 1.2 평면형, 1.8 레코드형). 줄 묶음을 차례로 받아(push) 끝에 웨이퍼 목록을 낸다(end).
// 형식은 공개 오픈소스(jklarfreader · klarfkit · klarf_reader · klarfio)의 코드와 시험 파일로 확인했다 (docs/klarf-format.md).
// 좌표: 웨이퍼 중심 기준 X = XINDEX·DiePitchX + XREL − SampleCenterLocationX (Y 도 같음, +Y 위쪽). 단위 µm.
// 1.8 의 길이는 nm 정수 → µm 로 바꾼다 (SampleSize 가 1e5 보다 크면 nm 로 본다).

const MAX_ERR = 1000;
const NEED = ["XREL", "YREL", "XINDEX", "YINDEX"];
const KEEP = ["DEFECTID", "XREL", "YREL", "XINDEX", "YINDEX", "XSIZE", "YSIZE", "DEFECTAREA", "DSIZE", "CLASSNUMBER", "TEST", "ROUGHBINNUMBER", "FINEBINNUMBER", "IMAGECOUNT"];
const F64 = new Set(["XREL", "YREL"]);
const I32 = new Set(["DEFECTID", "XINDEX", "YINDEX", "CLASSNUMBER", "TEST", "ROUGHBINNUMBER", "FINEBINNUMBER", "IMAGECOUNT"]);
const LEN = new Set(["XREL", "YREL", "XSIZE", "YSIZE", "DSIZE"]);
const TOP12 = new Set(["FILEVERSION", "FILETIMESTAMP", "INSPECTIONSTATIONID", "SAMPLETYPE", "RESULTTIMESTAMP", "LOTID", "SAMPLESIZE", "DEVICEID", "SETUPID", "STEPID",
  "SAMPLEORIENTATIONMARKTYPE", "ORIENTATIONMARKLOCATION", "DIEPITCH", "DIEORIGIN", "WAFERID", "SLOT", "SAMPLECENTERLOCATION", "CLASSLOOKUP", "INSPECTIONTEST",
  "SAMPLETESTPLAN", "SAMPLEDIEMAP", "AREAPERTEST", "DEFECTRECORDSPEC", "DEFECTLIST", "SUMMARYSPEC", "SUMMARYLIST", "ENDOFFILE", "TIFFSPEC", "RESULTSID", "WAFERSTATUS", "LOTSTATUS"]);
const DEG = { 0: "DOWN", 90: "LEFT", 180: "UP", 270: "RIGHT" };

// ---- 숫자 빨리 읽기: 정수부 · 소수부를 정수로 모아 10 의 거듭제곱으로 나눈다 (15자리까지 정확). 그 밖은 Number() ----
const P10 = Array.from({ length: 23 }, (_, k) => 10 ** k);
export function num(s, a, b) {
  let i = a, neg = false, m = 0, dig = 0, frac = 0, c = s.charCodeAt(i);
  if (c === 45 || c === 43) { neg = c === 45; i++; }
  for (; i < b; i++) { c = s.charCodeAt(i); if (c < 48 || c > 57) break; m = m * 10 + (c - 48); dig++; }
  if (i < b && c === 46) { for (i++; i < b; i++) { c = s.charCodeAt(i); if (c < 48 || c > 57) break; m = m * 10 + (c - 48); dig++; frac++; } }
  let e = 0;
  if (i < b && (c === 101 || c === 69)) {
    i++; let en = false; c = s.charCodeAt(i);
    if (c === 45 || c === 43) { en = c === 45; i++; }
    let ed = 0; for (; i < b; i++) { c = s.charCodeAt(i); if (c < 48 || c > 57) break; e = e * 10 + (c - 48); ed++; }
    if (!ed) return NaN;
    if (en) e = -e;
  }
  if (i !== b || !dig) return Number(s.slice(a, b)); // "NA" 등은 NaN
  if (dig > 15) return Number(s.slice(a, b));
  const k = e - frac;
  const v = k >= 0 ? (k < 23 ? m * P10[k] : m * 10 ** k) : (-k < 23 ? m / P10[-k] : m / 10 ** -k);
  return neg ? -v : v;
}

// 줄을 낱말로: 따옴표 문자열은 한 낱말(따옴표 뺌), ; { } , 는 따로 (머리글 · 작은 목록용)
function tokens(line) {
  const out = [];
  for (let i = 0, L = line.length; i < L;) {
    const c = line[i];
    if (c === " " || c === "\t" || c === "\r") { i++; continue; }
    if (c === '"') { const j = line.indexOf('"', i + 1); const e = j < 0 ? L : j; out.push({ s: line.slice(i + 1, e), q: true }); i = e + 1; continue; }
    if (c === ";" || c === "{" || c === "}" || c === ",") { out.push({ s: c, p: true }); i++; continue; }
    let j = i; while (j < L && !" \t\r;{},\"".includes(line[j])) j++;
    out.push({ s: line.slice(i, j) }); i = j;
  }
  return out;
}

// 결함 열 저장소: 열마다 typed array, 꽉 차면 두 배로
function colStore(names) {
  const mk = (k, n) => new (F64.has(k) ? Float64Array : I32.has(k) ? Int32Array : Float32Array)(n);
  const s = { names, cap: 4096, n: 0 };
  s.arrs = names.map((k) => mk(k, s.cap));
  s.grow = () => { s.cap *= 2; s.arrs = s.arrs.map((o, i) => { const a = mk(names[i], s.cap); a.set(o); return a; }); };
  s.done = () => Object.fromEntries(names.map((k, i) => [k, s.arrs[i].slice(0, s.n)]));
  return s;
}

// 행(값 배열) → 열 저장소. img = 1.2 IMAGELIST 위치 (그 뒤 열은 2·개수만큼 밀림), 없으면 -1
function rowSink(cols, img) {
  const pos = {}; cols.forEach((k, i) => { if (pos[k] == null) pos[k] = i; });
  const missing = NEED.filter((k) => pos[k] == null);
  if (missing.length) return { missing };
  const keep = KEEP.filter((k) => pos[k] != null);
  return { st: colStore(keep), keep, src: keep.map((k) => pos[k]), need: NEED.map((k) => pos[k]), img, ncol: cols.length };
}
function emit(sk, row) {
  const img = sk.img, ni = img >= 0 ? 2 * (row[img] | 0) : 0;
  for (let q = 0; q < 4; q++) { const p = sk.need[q], v = row[img >= 0 && p > img ? p + ni : p]; if (typeof v !== "number" || v !== v) return false; }
  const st = sk.st;
  if (st.n === st.cap) st.grow();
  const A = st.arrs, n = st.n, src = sk.src;
  for (let q = 0; q < A.length; q++) { const p = src[q], v = row[img >= 0 && p > img ? p + ni : p]; A[q][n] = typeof v === "number" ? v : NaN; }
  st.n++;
  return true;
}

function newWafer(base) {
  return { id: "", slot: null, classes: new Map(base?.classes || []), plan: [], areaPerTest: 0, tests: 0, summary: null, sumSpec: null,
    pitch: base?.pitch ? [...base.pitch] : null, center: base?.center ? [...base.center] : null, dieOrigin: base?.dieOrigin ? [...base.dieOrigin] : null,
    sk: null, spec: base?.spec || null, cols: [], line: 0 };
}

export function createParser({ name = "" } = {}) {
  const res = { name, version: null, lot: {}, wafers: [], errors: [], nErrors: 0, warnings: [], lines: 0, skipped: 0 };
  const err = (line, reason, text = "") => {
    res.nErrors++;
    if (res.errors.length < MAX_ERR) res.errors.push({ line, reason, text: String(text).trim().slice(0, 160) });
  };
  let mode = null; // "12" | "18"
  let lineNo = 0;

  // ================= 1.2 =================
  let st = null, stLine = 0;          // 쌓는 중인 문장 낱말
  const file = newWafer();            // WaferID 앞의 머리글
  let cur = null;                     // 지금 웨이퍼
  let dl = null;                      // DefectList 읽는 중
  const waf = () => cur || file;

  function startDefects(line) {
    const w = waf();
    if (!w.spec) { err(line, "nospec"); dl = { skip: true }; return; }
    const sk = rowSink(w.spec, w.spec.indexOf("IMAGELIST"));
    if (sk.missing) { err(line, "needcol", sk.missing.join(" ")); dl = { skip: true }; return; }
    w.sk = sk; w.cols = w.spec; w.line = line;
    dl = { w, sk, row: new Array(64).fill(0), len: 0, needNow: sk.ncol, rowLine: line, rowText: "", aligned: null };
  }
  function endDefects() {
    if (dl && !dl.skip && dl.len) err(dl.rowLine, "cols", dl.rowText);
    dl = null;
  }
  function defectLine(s, line) {
    const d = dl;
    // DefectList 안의 TiffFileName · FILENAME 같은 줄은 건너뛴다. 머리글 낱말이 나오면 ; 이 빠진 것
    let a = 0; const L = s.length;
    while (a < L && (s.charCodeAt(a) === 32 || s.charCodeAt(a) === 9)) a++;
    const c0 = s.charCodeAt(a);
    if ((c0 >= 65 && c0 <= 90) || (c0 >= 97 && c0 <= 122)) {
      const word = s.slice(a).split(/[\s;]/)[0];
      if (word !== "NA") {
        if (TOP12.has(word.toUpperCase())) { err(line, "unterminated", "DefectList"); endDefects(); return false; }
        res.skipped++; return true;
      }
    }
    if (d.skip) { if (s.includes(";")) dl = null; return true; }
    const sk = d.sk, row = d.row, img = sk.img;
    const startRow = d.len === 0;
    let ended = false;
    for (let i = a; i < L;) {
      let c = s.charCodeAt(i);
      if (c === 32 || c === 9 || c === 13) { i++; continue; }
      if (c === 59) { ended = true; break; } // ;
      let j = i + 1; while (j < L) { c = s.charCodeAt(j); if (c === 32 || c === 9 || c === 13 || c === 59) break; j++; }
      if (!d.len) { d.rowLine = line; d.rowText = s; }
      if (d.len >= row.length) { err(d.rowLine, "cols", s); d.len = 0; d.needNow = sk.ncol; i = j; continue; }
      row[d.len++] = num(s, i, j);
      i = j;
      if (d.len === img + 1) d.needNow = sk.ncol + 2 * Math.max(0, Math.min(16, row[img] | 0));
      if (d.len >= d.needNow) {
        let k = j; while (k < L && (s.charCodeAt(k) === 32 || s.charCodeAt(k) === 9 || s.charCodeAt(k) === 13)) k++;
        const atEnd = k === L || s.charCodeAt(k) === 59;
        if (d.aligned === null) d.aligned = startRow && atEnd; // 첫 행이 한 줄에 딱 맞으면 "한 줄 = 한 행" 파일
        if (d.aligned && !atEnd) {
          if (d.rowLine !== line) { // 앞 줄에서 넘어온 행이 이 줄 중간에서 찼다 → 앞 줄의 열이 모자랐던 것. 이 줄은 처음부터 다시
            err(d.rowLine, "cols", d.rowText); d.len = 0; d.needNow = sk.ncol;
            return defectLine(s, line);
          }
          if (!emit(sk, row)) err(d.rowLine, "num", d.rowText);
          d.len = 0; d.needNow = sk.ncol;
          err(line, "cols", s); // 한 줄에 열이 넘친다: 나머지는 버린다
          ended = s.indexOf(";", k) >= 0;
          break;
        }
        if (!emit(sk, row)) err(d.rowLine, "num", d.rowText);
        d.len = 0; d.needNow = sk.ncol;
      }
    }
    // 줄이 끝났는데 행이 덜 찼으면 다음 줄로 이어 본다 (긴 행이 줄을 넘는 파일). 다음 줄 중간에서 차거나 다음 줄로도 모자라면 앞 줄의 오류
    if (d.aligned && d.len && d.rowLine !== line && !ended) { err(d.rowLine, "cols", d.rowText); d.len = 0; d.needNow = sk.ncol; return defectLine(s, line); }
    if (ended) endDefects();
    return true;
  }

  function statement(t, line) {
    const kw = t[0].s.toUpperCase(), a = t.slice(1).map((x) => x.s), w = waf();
    const nums = (k) => a.slice(k).map(Number);
    switch (kw) {
      case "FILEVERSION": res.version = a.slice(0, 2).join("."); break;
      case "FILETIMESTAMP": res.lot.fileTime = a.join(" "); break;
      case "RESULTTIMESTAMP": res.lot.resultTime = a.join(" "); break;
      case "INSPECTIONSTATIONID": res.lot.station = a.join(" "); break;
      case "LOTID": res.lot.lot = a[0]; break;
      case "DEVICEID": res.lot.device = a[0]; break;
      case "SETUPID": res.lot.setup = a[0]; break;
      case "STEPID": res.lot.step = a[0]; break;
      case "SAMPLETYPE": res.lot.sampleType = a[0]; break;
      case "SAMPLESIZE": res.lot.diameter = Number(a[1]); break;
      case "SAMPLEORIENTATIONMARKTYPE": res.lot.mark = a[0]; break;
      case "ORIENTATIONMARKLOCATION": res.lot.notch = String(a[0]).toUpperCase(); break;
      case "DIEPITCH": w.pitch = nums(0).slice(0, 2); break;
      case "DIEORIGIN": w.dieOrigin = nums(0).slice(0, 2); break;
      case "SAMPLECENTERLOCATION": w.center = nums(0).slice(0, 2); break;
      case "WAFERID":
        if (cur) finishWafer(cur);
        cur = newWafer(file); cur.id = a[0] ?? ""; cur.line = line; break;
      case "SLOT": w.slot = Number(a[0]); break;
      case "CLASSLOOKUP": {
        const k = Number(a[0]);
        for (let i = 0; i < k; i++) { const c = Number(a[1 + 2 * i]); if (Number.isFinite(c)) w.classes.set(c, a[2 + 2 * i] ?? ""); }
        if (a.length !== 1 + 2 * k) err(line, "count", `ClassLookup ${k}`);
        break;
      }
      case "INSPECTIONTEST": w.tests++; break;
      case "SAMPLETESTPLAN": case "SAMPLEDIEMAP": {
        const k = Number(a[0]);
        for (let i = 0; i < k; i++) w.plan.push(Number(a[1 + 2 * i]) | 0, Number(a[2 + 2 * i]) | 0);
        if (a.length !== 1 + 2 * k) err(line, "count", `${t[0].s} ${k}`);
        break;
      }
      case "AREAPERTEST": w.areaPerTest += Number(a[0]) || 0; break;
      case "DEFECTRECORDSPEC":
        w.spec = a.slice(1).map((s) => s.toUpperCase());
        if (Number(a[0]) !== w.spec.length) res.warnings.push({ line, code: "specCount", v: [Number(a[0]), w.spec.length] });
        break;
      case "SUMMARYSPEC": w.sumSpec = a.slice(1).map((s) => s.toUpperCase()); break;
      case "SUMMARYLIST": w.summary = summaryFrom(w.sumSpec, nums(0)); break;
      case "ENDOFFILE": break;
      default: if (!TOP12.has(kw)) res.skipped++;
    }
  }

  function line12(s) {
    if (dl && defectLine(s, lineNo)) return;
    const t = tokens(s);
    for (let k = 0; k < t.length; k++) {
      const tk = t[k];
      if (!st) {
        if (tk.p && tk.s === ";") continue;
        st = []; stLine = lineNo;
        if (!tk.q && tk.s.toUpperCase() === "DEFECTLIST") {
          st = null; startDefects(lineNo);
          const rest = s.slice(s.toUpperCase().indexOf("DEFECTLIST") + 10); // 같은 줄에 행이 이어지면
          if (rest.trim()) defectLine(rest, lineNo);
          return;
        }
      }
      if (tk.p && tk.s === ";") { statement(st, stLine); st = null; continue; }
      if (tk.p && tk.s === ",") continue;
      st.push(tk);
    }
  }

  // ================= 1.8 =================
  const stack = [];   // { kind: "rec"|"list", type, id, fields, lists }
  let pend = null;    // 여러 줄에 걸친 Field · Columns
  let data = null;    // List 의 Data 블록 읽는 중
  let pendOpen = false;
  const done18 = [];  // 닫힌 WaferRecord (단위는 끝에서 정한다: 필드 순서가 자유라서)

  const fieldVals = (txt) => {
    const out = []; let depth = 0;
    for (const x of tokens(txt)) { if (x.p) { if (x.s === "{") depth++; else if (x.s === "}") depth--; continue; } if (depth) out.push(x.q ? x.s : (Number.isNaN(Number(x.s)) ? x.s : Number(x.s))); }
    return out;
  };
  const top = () => stack[stack.length - 1];
  const recOf = (type) => { for (let i = stack.length - 1; i >= 0; i--) if (stack[i].kind === "rec" && stack[i].type === type) return stack[i]; return null; };
  const balanced = (t) => { let d = 0, seen = false; for (const c of t.replace(/"[^"]*"/g, "")) { if (c === "{") { d++; seen = true; } else if (c === "}") d--; } return seen && d <= 0; };

  function line18(s) {
    if (data) { dataLine(s); return; }
    const tr = s.trim();
    if (!tr) return;
    if (pend) { pend.text += " " + tr; if (balanced(pend.text)) { const p = pend; pend = null; finishPend(p); } return; }
    if (tr === "{") { if (pendOpen) pendOpen = false; else err(lineNo, "brace", tr); return; }
    if (tr === "}") { closeCtx(); return; }
    const m = /^(\w+)\s*(.*)$/.exec(tr);
    if (!m) { err(lineNo, "unknown", tr); return; }
    const kw = m[1], rest = m[2];
    if (kw === "Record") {
      const t = tokens(rest), type = t[0]?.s, id = t[1] && !t[1].p ? t[1].s : "";
      const rec = { kind: "rec", type, id, fields: {}, lists: {}, line: lineNo };
      stack.push(rec);
      if (type === "FileRecord") res.version = id || "1.8";
      if (type === "WaferRecord") { rec.w = newWafer(); rec.w.id = id; rec.w.line = lineNo; }
      pendOpen = !rest.includes("{");
      return;
    }
    if (kw === "Field") { const p = { kind: "field", text: tr, line: lineNo }; if (balanced(tr)) finishPend(p); else pend = p; return; }
    if (kw === "List") { stack.push({ kind: "list", name: tokens(rest)[0]?.s, cols: null, types: null, rows: [], line: lineNo }); pendOpen = !rest.includes("{"); return; }
    if (kw === "Columns") { const p = { kind: "cols", text: tr, line: lineNo }; if (balanced(tr)) finishPend(p); else pend = p; return; }
    if (kw === "Data") {
      const L = top();
      if (!L || L.kind !== "list" || !L.cols) { err(lineNo, "unknown", tr); return; }
      data = { L, open: rest.includes("{"), row: new Array(64).fill(0), len: 0, rowLine: lineNo, rowText: "", skipDepth: 0,
        isList: L.types.map((x) => /list$/i.test(x)), sk: null };
      if (L.name === "DefectList") {
        const rw = recOf("WaferRecord");
        if (!rw) { err(lineNo, "nowafer"); data.skip = true; return; }
        const sk = rowSink(L.cols, -1);
        if (sk.missing) { err(lineNo, "needcol", sk.missing.join(" ")); data.skip = true; return; }
        data.sk = sk; rw.w.sk = sk; rw.w.cols = L.cols; rw.w.line = lineNo;
      }
      return;
    }
    if (kw === "EndOfFile") return;
    err(lineNo, "unknown", tr);
  }

  function finishPend(p) {
    const ctx = top();
    if (p.kind === "field") {
      const name = /^Field\s+(\w+)/.exec(p.text)?.[1];
      if (!name || !ctx) { err(p.line, "unknown", p.text); return; }
      ctx.fields[name] = fieldVals(p.text.slice(p.text.indexOf("{")));
      return;
    }
    if (!ctx || ctx.kind !== "list") { err(p.line, "unknown", p.text); return; }
    const inner = p.text.slice(p.text.indexOf("{") + 1, p.text.lastIndexOf("}"));
    const parts = inner.split(",").map((x) => x.trim().split(/\s+/)).filter((x) => x.length >= 2);
    ctx.types = parts.map((x) => x[0]); ctx.cols = parts.map((x) => x[1].toUpperCase());
  }

  // 목록 칸 "{ ... }" 건너뛰기 (따옴표 안의 괄호는 무시). 줄이 끝나도 깊이는 data.skipDepth 에 남는다
  function skipBraces(s, i, d) {
    for (const L = s.length; i < L; i++) {
      const c = s.charCodeAt(i);
      if (c === 34) { const j = s.indexOf('"', i + 1); i = j < 0 ? L : j; continue; }
      if (c === 123) d.skipDepth++;
      else if (c === 125 && --d.skipDepth === 0) return i + 1;
    }
    return s.length;
  }

  function dataLine(s) {
    const d = data, L = s.length, row = d.row;
    let i = 0;
    if (!d.open) { const tr = s.trim(); if (tr === "{") d.open = true; else if (tr) err(lineNo, "brace", tr); return; }
    if (d.skipDepth) { i = skipBraces(s, 0, d); if (d.skipDepth) return; }
    while (i < L) {
      let c = s.charCodeAt(i);
      if (c === 32 || c === 9 || c === 13 || c === 44) { i++; continue; }
      if (c === 59) { rowDone(d); i++; continue; }
      if (c === 125) { if (d.len) rowDone(d); data = null; return; }
      if (d.skip) { i++; continue; }
      if (!d.len) { d.rowLine = lineNo; d.rowText = s; }
      if (d.len >= row.length) row.push(0);
      if (c === 34) { const j = s.indexOf('"', i + 1), e = j < 0 ? L : j; row[d.len++] = d.sk ? NaN : s.slice(i + 1, e); i = e + 1; continue; }
      let j = i + 1; while (j < L) { c = s.charCodeAt(j); if (c === 32 || c === 9 || c === 13 || c === 59 || c === 44 || c === 123 || c === 125) break; j++; }
      if (d.isList[d.len]) { // 목록 칸: "N" 또는 "이름 개수 { ... }" → 개수
        if (j - i === 1 && (s[i] === "N" || s[i] === "n")) { row[d.len++] = 0; i = j; continue; }
        let k = j; while (k < L && s.charCodeAt(k) === 32) k++;
        let k2 = k; while (k2 < L && s.charCodeAt(k2) >= 48 && s.charCodeAt(k2) <= 57) k2++;
        row[d.len++] = Number(s.slice(k, k2)) || 0;
        i = k2; while (i < L && s.charCodeAt(i) === 32) i++;
        if (s.charCodeAt(i) === 123) { d.skipDepth = 1; i = skipBraces(s, i + 1, d); if (d.skipDepth) return; }
        continue;
      }
      row[d.len++] = num(s, i, j);
      i = j;
    }
  }

  function rowDone(d) {
    const n = d.len; d.len = 0;
    if (d.skip) return;
    if (n !== d.L.cols.length) { err(d.rowLine, "cols", d.rowText); return; }
    if (d.sk) { if (!emit(d.sk, d.row)) err(d.rowLine, "num", d.rowText); }
    else d.L.rows.push(d.row.slice(0, n));
  }

  function closeCtx() {
    const c = stack.pop();
    if (!c) { err(lineNo, "brace", "}"); return; }
    if (c.kind === "list") { const p = top(); if (p) p.lists[c.name] = c; return; }
    const f = c.fields;
    if (c.type === "FileRecord") { if (f.FileTimestamp) res.lot.fileTime = f.FileTimestamp.join(" "); return; }
    if (c.type === "TestRecord") {
      const w = recOf("WaferRecord")?.w;
      if (!w) return;
      w.tests++;
      w.areaPerTest += Number(f.AreaPerTest?.[0]) || 0;
      const L = c.lists.SampleTestPlanList || c.lists.SampleDieList;
      if (L) { const ix = L.cols.indexOf("XINDEX"), iy = L.cols.indexOf("YINDEX"); for (const r of L.rows) w.plan.push(r[ix] | 0, r[iy] | 0); }
      return;
    }
    if (c.type === "SummaryRecord") {
      const w = recOf("WaferRecord")?.w, L = c.lists.TestSummaryList;
      if (w && L) w.summary = summaryFrom(L.cols, L.rows.flat());
      return;
    }
    if (c.type === "WaferRecord") done18.push({ rec: c, lot: recOf("LotRecord") });
  }

  // 1.8 마무리: 로트 머리(단위 · 클래스 · pitch)를 읽은 뒤 웨이퍼마다 nm → µm
  function finish18() {
    for (const { rec, lot } of done18) {
      const w = rec.w, f = rec.fields, lf = lot?.fields || {};
      const ss = Number(lf.SampleSize?.[0] ?? f.SampleSize?.[0]);
      const sc = Number.isFinite(ss) && ss <= 1e5 ? 1 : 1e-3;
      if (lot) {
        const L = res.lot;
        L.lot = lot.id; L.device = lf.DeviceID?.[0]; L.step = lf.StepID?.[0]; L.setup = lf.RecipeID?.[0] ?? lf.SetupID?.[0];
        L.station = (lf.InspectionStationID || []).join(" "); L.resultTime = (lf.ResultTimestamp || []).join(" ");
        L.mark = lf.SampleOrientationMarkType?.[0]; L.sampleType = lf.SampleType?.[0];
        if (Number.isFinite(ss)) L.diameter = ss > 1e5 ? ss / 1e6 : ss;
        const o = lf.OrientationMarkLocation?.[0];
        L.notch = typeof o === "number" ? DEG[((o % 360) + 360) % 360] || `${o}°` : String(o ?? "").toUpperCase();
        L.unit = sc === 1 ? "µm" : "nm";
      }
      w.slot = Number(f.SlotNumber?.[0] ?? NaN);
      if (f.DieOrigin) w.dieOrigin = f.DieOrigin.map((v) => v * sc);
      if (f.SampleCenterLocation) w.center = f.SampleCenterLocation.map((v) => v * sc);
      const dp = f.DiePitch || lf.DiePitch;
      if (dp) w.pitch = dp.map((v) => v * sc);
      w.areaPerTest *= sc * sc;
      const cl = rec.lists.ClassLookupList || lot?.lists?.ClassLookupList;
      if (cl) { const a = cl.cols.indexOf("CLASSNUMBER"), b = cl.cols.indexOf("CLASSNAME"); for (const r of cl.rows) w.classes.set(Number(r[a]), String(r[b] ?? "")); }
      if (w.sk && sc !== 1) {
        const { st, keep } = w.sk;
        keep.forEach((k, q) => { const m = LEN.has(k) ? sc : k === "DEFECTAREA" ? sc * sc : 1; if (m !== 1) { const A = st.arrs[q]; for (let i = 0; i < st.n; i++) A[i] *= m; } });
      }
      finishWafer(w);
    }
  }

  // ================= 공통 =================
  function finishWafer(w) {
    const g = res.lot;
    const cols = w.sk ? w.sk.st.done() : {};
    const n = w.sk ? w.sk.st.n : 0;
    const R = ((g.diameter || 0) * 1000) / 2;
    const W = {
      id: w.id, slot: Number.isFinite(w.slot) ? w.slot : null, version: res.version, name: res.name,
      pitch: w.pitch, center: w.center || [0, 0], dieOrigin: w.dieOrigin || [0, 0], classes: w.classes,
      plan: Int32Array.from(w.plan), areaPerTest: w.areaPerTest, tests: w.tests, summary: w.summary, cols: w.cols, n, line: w.line,
      xr: cols.XREL || new Float64Array(0), yr: cols.YREL || new Float64Array(0), xi: cols.XINDEX || new Int32Array(0), yi: cols.YINDEX || new Int32Array(0),
      did: cols.DEFECTID || null, cls: cols.CLASSNUMBER || new Int32Array(n), test: cols.TEST || null,
      xsize: cols.XSIZE || null, ysize: cols.YSIZE || null, area: cols.DEFECTAREA || null, dsize: cols.DSIZE || null,
      rough: cols.ROUGHBINNUMBER || null, fine: cols.FINEBINNUMBER || null, images: cols.IMAGECOUNT || null,
    };
    if (!w.pitch) err(w.line || lineNo, "nopitch");
    if (!w.center) res.warnings.push({ line: w.line, code: "noCenter" });
    if (W.dieOrigin[0] || W.dieOrigin[1]) res.warnings.push({ line: w.line, code: "dieOrigin", v: W.dieOrigin });
    if (!R) res.warnings.push({ line: w.line, code: "noSize" });
    const [px, py] = w.pitch || [0, 0], [cx, cy] = W.center;
    W.geo = { R: R || 150000, pitch: [px, py], grid: [-cx, -cy], notch: g.notch || "DOWN" };
    const x = new Float64Array(n), y = new Float64Array(n), size = new Float32Array(n);
    for (let i = 0; i < n; i++) { x[i] = W.xi[i] * px + W.xr[i] - cx; y[i] = W.yi[i] * py + W.yr[i] - cy; }
    for (let i = 0; i < n; i++) size[i] = W.dsize ? W.dsize[i] : Math.max(W.xsize?.[i] || 0, W.ysize?.[i] || 0);
    W.x = x; W.y = y; W.size = size;
    res.wafers.push(W);
  }

  return {
    res,
    push(lines) {
      for (const s of lines) {
        lineNo++;
        if (mode === null) {
          const tr = s.trim().replace(/^﻿/, "");
          if (!tr) continue;
          mode = /^Record\b/.test(tr) ? "18" : /^FileVersion\b/i.test(tr) || /;/.test(tr) ? "12" : "bad";
          if (mode === "bad") { err(lineNo, "notKlarf", tr); continue; }
        }
        if (mode === "bad") continue;
        if (mode === "18") line18(s); else line12(s);
      }
      res.lines = lineNo;
    },
    end() {
      if (mode === "12") {
        if (dl) { err(lineNo, "unterminated", "DefectList"); endDefects(); }
        if (st && st.length) err(stLine, "unterminated", st[0].s);
        if (cur) finishWafer(cur);
        else if (file.sk || file.plan.length) { file.id = "1"; finishWafer(file); }
        if (!res.version) res.version = "1.2";
      } else if (mode === "18") {
        if (data) err(lineNo, "unterminated", "Data");
        if (stack.length) err(lineNo, "unterminated", stack[stack.length - 1].type || stack[stack.length - 1].name);
        finish18();
      }
      if (!res.wafers.length && !res.errors.some((e) => e.reason === "notKlarf")) err(lineNo, "noWafer");
      return res;
    },
  };
}

function summaryFrom(spec, vals) {
  if (!spec || !spec.length) return null;
  const k = spec.length, s = { ndefect: 0, ndie: 0, ndefdie: 0, rows: 0 };
  const at = (name) => spec.indexOf(name);
  for (let r = 0; r + k <= vals.length; r += k) {
    s.rows++;
    const get = (name) => (at(name) < 0 ? 0 : Number(vals[r + at(name)]) || 0);
    s.ndefect += get("NDEFECT"); s.ndie += get("NDIE"); s.ndefdie += get("NDEFDIE");
  }
  if (at("NDEFECT") < 0) s.ndefect = null;
  return s;
}

// 한 번에 읽기 (테스트 · 작은 파일)
export function parseText(text, name) {
  const p = createParser({ name });
  p.push(text.split("\n"));
  return p.end();
}
