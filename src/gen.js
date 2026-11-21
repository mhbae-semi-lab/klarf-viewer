// 합성 Klarf 생성기. 가상 300 mm 웨이퍼 · 가상 제품(다이 9.6 × 8.2 mm, 스크라이브 100 µm)의 결함을 만들고
// KLARF 1.2(평면형) 또는 1.8(레코드형)으로 쓴다. 실제 장비 · 제품 · 파일과 관련이 없다.
// 맵 오류 5종은 "검사기가 틀린 맵 정의로 좌표를 계산했다"는 상황으로 넣는다 (파일 안에서는 서로 앞뒤가 맞음):
//   pitch   DiePitch X 를 2.5% 크게 잡음          scribe  격자 원점을 X 로 2.4 mm 밀어 다이 경계가 스크라이브를 벗어남
//   origin  SampleCenterLocation 이 한 다이 어긋남 outside 웨이퍼 원 밖(부분 다이 안)에 결함
//   index   결함의 XINDEX 만 1 크게 씀 (테스트 플랜은 그대로)

export const CLASSES = [[0, "UNCLASSIFIED"], [1, "PARTICLE"], [2, "SCRATCH"], [3, "RESIDUE"], [4, "PATTERN"], [5, "EDGE"], [6, "HANDLING"]];
const TRUE = { R: 150000, pitch: [9600, 8200], street: 100, grid: [-16 * 9600 + 3100, -19 * 8200 + 1700] };

export function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// 실제 좌표(웨이퍼 중심 µm)로 결함 만들기
function trueDefects(n, seed, lotSeed) {
  const r = rng(seed), lr = rng(lotSeed);
  const [px, py] = TRUE.pitch, [gx, gy] = TRUE.grid, s2 = TRUE.street / 2, R = TRUE.R;
  const X = [], Y = [], C = [], S = [];
  const gauss = () => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
  const inCare = (x, y) => { // 스크라이브(다이 경계 둘레 50 µm)는 검사 영역 밖
    const a = (((x - gx) % px) + px) % px, b = (((y - gy) % py) + py) % py;
    return a >= s2 && a < px - s2 && b >= s2 && b < py - s2;
  };
  const add = (x, y, c, sz) => { if (Math.hypot(x, y) < R - 800 && inCare(x, y)) { X.push(x); Y.push(y); C.push(c); S.push(sz); return true; } return false; };
  const size = () => Math.exp(0.2 + 0.7 * gauss());
  // 다이 반복(레티클 결함): 다이 안 같은 자리 3곳, 다이의 60%
  const reps = [[2100, 5300], [7400, 1200], [5000, 6900]];
  const dies = [];
  for (let i = -1; i < 34; i++) for (let j = -1; j < 39; j++) { const cx = gx + (i + 0.5) * px, cy = gy + (j + 0.5) * py; if (Math.hypot(cx, cy) < R - 6000) dies.push([i, j]); }
  for (const [i, j] of dies) for (const [ax, ay] of reps) if (r() < 0.6 * Math.min(1, n / 8000)) add(gx + i * px + ax + gauss() * 3, gy + j * py + ay + gauss() * 3, 4, 0.8 + r() * 0.4);
  // 웨이퍼 반복(핸들링 자국): 로트 안 웨이퍼마다 같은 자리 5곳
  for (let k = 0; k < 5; k++) { const a = lr() * 2 * Math.PI, rr = R * (0.55 + 0.35 * lr()), cx = Math.cos(a) * rr, cy = Math.sin(a) * rr; for (let q = 0; q < 6; q++) add(cx + gauss() * 40, cy + gauss() * 40, 6, 3 + r() * 4); }
  const left = () => n - X.length;
  // 중앙 군집
  const cl = [(r() - 0.5) * R, (r() - 0.5) * R], ncl = Math.round(n * 0.04);
  for (let k = 0, got = 0; k < ncl * 4 && got < ncl; k++) if (add(cl[0] + gauss() * 6000, cl[1] + gauss() * 6000, 3, size() * 1.5)) got++;
  // 스크래치: 호
  const a0 = r() * Math.PI, rr0 = R * (0.3 + 0.4 * r()), nsc = Math.round(n * 0.03);
  for (let k = 0, got = 0; k < nsc * 4 && got < nsc; k++) { const t = a0 + r() * 0.9; if (add(Math.cos(t) * rr0 + gauss() * 30, Math.sin(t) * rr0 + gauss() * 30, 2, 2 + r() * 8)) got++; }
  // 가장자리 띠
  const ned = Math.round(n * 0.04);
  for (let k = 0, got = 0; k < ned * 4 && got < ned; k++) { const t = r() * 2 * Math.PI, rr = R - 900 - r() * 2500; if (add(Math.cos(t) * rr, Math.sin(t) * rr, 5, size() * 2)) got++; }
  // 나머지: 무작위 입자 · 잔류물
  while (left() > 0) { const t = r() * 2 * Math.PI, rr = (R - 1000) * Math.sqrt(r()); add(Math.cos(t) * rr, Math.sin(t) * rr, r() < 0.8 ? 1 : r() < 0.5 ? 3 : 0, size()); }
  return { X, Y, C, S };
}

// 실제 좌표 → 파일에 쓸 값 (맵 정의 def 로 계산)
function toFile(t, def, r) {
  const n = t.X.length, [px, py] = def.pitch, [gx, gy] = def.grid;
  const d = { n, id: new Int32Array(n), xr: new Float64Array(n), yr: new Float64Array(n), xi: new Int32Array(n), yi: new Int32Array(n),
    xs: new Float32Array(n), ys: new Float32Array(n), area: new Float32Array(n), ds: new Float32Array(n), cls: new Int32Array(n), img: new Uint8Array(n) };
  for (let k = 0; k < n; k++) {
    const x = t.X[k], y = t.Y[k];
    const i = Math.floor((x - gx) / px), j = Math.floor((y - gy) / py);
    d.id[k] = k + 1; d.xi[k] = i + (def.xiShift || 0); d.yi[k] = j;
    d.xr[k] = x - gx - i * px; d.yr[k] = y - gy - j * py;
    const s = t.S[k], el = t.C[k] === 2 ? 4 : 1;
    d.xs[k] = s * el; d.ys[k] = s; d.ds[k] = Math.max(d.xs[k], d.ys[k]); d.area[k] = d.xs[k] * d.ys[k] * 0.7; d.cls[k] = t.C[k];
    d.img[k] = r() < 0.01 ? 1 : 0;
  }
  // 테스트 플랜: 웨이퍼 원과 겹치는 다이 전부 (부분 다이 포함)
  const plan = [];
  for (let i = Math.floor((-TRUE.R - gx) / px) - 1; gx + i * px < TRUE.R; i++) for (let j = Math.floor((-TRUE.R - gy) / py) - 1; gy + j * py < TRUE.R; j++) {
    const x0 = gx + i * px, y0 = gy + j * py, qx = Math.max(x0, Math.min(0, x0 + px)), qy = Math.max(y0, Math.min(0, y0 + py));
    if (Math.hypot(qx, qy) < TRUE.R) plan.push(i, j);
  }
  return { d, plan, pitch: def.pitch, center: def.center || [-gx, -gy] };
}

export const ERRORS = ["pitch", "scribe", "origin", "outside", "index"];

// 로트 만들기: wafers 장, 웨이퍼당 결함 n 개, error = 넣을 맵 오류 (없으면 정상)
export function makeLot({ seed = 7, wafers = 1, n = 8000, error = null, lot = "SYN-LOT-01", device = "SYN-DEV-A", step = "SYN-STEP-M1", setup = "SYN-RECIPE-01" } = {}) {
  const W = [];
  for (let w = 0; w < wafers; w++) {
    const r = rng(seed * 1000 + w + 1);
    const t = trueDefects(n, seed * 1000 + w + 1, seed);
    const def = { pitch: [...TRUE.pitch], grid: [...TRUE.grid] };
    if (error === "pitch") def.pitch[0] = TRUE.pitch[0] * 1.025;
    if (error === "scribe") def.grid[0] += 2400;
    if (error === "index") def.xiShift = 1;
    if (error === "outside") {
      // 웨이퍼 원 밖으로 1 ~ 3 mm 나간 부분 다이 안의 점
      const [px, py] = TRUE.pitch, [gx, gy] = TRUE.grid;
      let got = 0;
      for (let k = 0; got < 50 && k < 200000; k++) {
        const a = r() * 2 * Math.PI, rr = TRUE.R + 1000 + r() * 2000, x = Math.cos(a) * rr, y = Math.sin(a) * rr;
        const i = Math.floor((x - gx) / px), j = Math.floor((y - gy) / py);
        const x0 = gx + i * px, y0 = gy + j * py, qx = Math.max(x0, Math.min(0, x0 + px)), qy = Math.max(y0, Math.min(0, y0 + py));
        const a2 = x - x0, b2 = y - y0;
        if (Math.hypot(qx, qy) < TRUE.R && a2 > 60 && a2 < px - 60 && b2 > 60 && b2 < py - 60) { t.X.push(x); t.Y.push(y); t.C.push(5); t.S.push(5 + r() * 10); got++; }
      }
    }
    const f = toFile(t, def, r);
    if (error === "origin") f.center = [-def.grid[0] + TRUE.pitch[0], -def.grid[1] - TRUE.pitch[1]];
    W.push({ id: String(w + 1).padStart(2, "0"), slot: w + 1, ...f });
  }
  return { lot, device, step, setup, station: ["SYNTH", "MAPGEN", "TOOL-01"], date: ["11-20-26", "09:30:00"], diameter: 300, wafers: W, error };
}

const e10 = (v) => v.toExponential(10);
const f3 = (v) => (Math.round(v * 1000) / 1000).toString();

// KLARF 1.2 (평면형): 로트 머리 한 번, 웨이퍼마다 WaferID ~ SummaryList
export function write12(L) {
  const o = [];
  const [d, t] = L.date;
  o.push("FileVersion 1 2;", `FileTimestamp ${d} ${t};`, `InspectionStationID ${L.station.map((s) => `"${s}"`).join(" ")};`, "SampleType WAFER;",
    `ResultTimestamp ${d} ${t};`, `LotID "${L.lot}";`, `SampleSize 1 ${L.diameter};`, `DeviceID "${L.device}";`, `SetupID "${L.setup}" ${d} ${t};`,
    `StepID "${L.step}";`, "SampleOrientationMarkType NOTCH;", "OrientationMarkLocation DOWN;",
    `DiePitch ${e10(L.wafers[0].pitch[0])} ${e10(L.wafers[0].pitch[1])};`, `DieOrigin ${e10(0)} ${e10(0)};`);
  for (const w of L.wafers) {
    o.push(`WaferID "${w.id}";`, `Slot ${w.slot};`, `SampleCenterLocation ${e10(w.center[0])} ${e10(w.center[1])};`);
    o.push(`ClassLookup ${CLASSES.length}`); CLASSES.forEach(([c, nm], k) => o.push(` ${c} "${nm}"${k === CLASSES.length - 1 ? ";" : ""}`));
    o.push("InspectionTest 1;", `SampleTestPlan ${w.plan.length / 2}`);
    for (let k = 0; k < w.plan.length; k += 2) o.push(` ${w.plan[k]} ${w.plan[k + 1]}${k === w.plan.length - 2 ? ";" : ""}`);
    const area = (w.plan.length / 2) * w.pitch[0] * w.pitch[1];
    o.push(`AreaPerTest ${e10(area)};`,
      "DefectRecordSpec 17 DEFECTID XREL YREL XINDEX YINDEX XSIZE YSIZE DEFECTAREA DSIZE CLASSNUMBER TEST CLUSTERNUMBER ROUGHBINNUMBER FINEBINNUMBER REVIEWSAMPLE IMAGECOUNT IMAGELIST;",
      "DefectList");
    const d0 = w.d, n = d0.n;
    for (let k = 0; k < n; k++) {
      const img = d0.img[k] ? "1 1 1 0" : "0 0";
      o.push(` ${d0.id[k]} ${f3(d0.xr[k])} ${f3(d0.yr[k])} ${d0.xi[k]} ${d0.yi[k]} ${f3(d0.xs[k])} ${f3(d0.ys[k])} ${f3(d0.area[k])} ${f3(d0.ds[k])} ${d0.cls[k]} 1 0 ${d0.cls[k]} 0 ${d0.img[k]} ${img}${k === n - 1 ? ";" : ""}`);
    }
    if (!n) o.push(";");
    const nd = new Set(); for (let k = 0; k < n; k++) nd.add(`${d0.xi[k]},${d0.yi[k]}`);
    o.push("SummarySpec 5 TESTNO NDEFECT DEFDENSITY NDIE NDEFDIE;", "SummaryList", ` 1 ${n} ${(n / (area / 1e8)).toFixed(4)} ${w.plan.length / 2} ${nd.size};`);
  }
  o.push("EndOfFile;");
  return o.join("\n") + "\n";
}

// KLARF 1.8 (레코드형): 길이 nm 정수
export function write18(L) {
  const nm = (v) => Math.round(v * 1000), o = [];
  const [d, t] = L.date, [mm, dd, yy] = d.split("-"), d4 = `${mm}-${dd}-20${yy}`;
  o.push('Record FileRecord "1.8"', "{", `  Field FileTimestamp 2 {"${d4}", "${t}"}`, `  Record LotRecord "${L.lot}"`, "  {",
    `    Field DeviceID 1 {"${L.device}"}`, `    Field DiePitch 2 {${nm(L.wafers[0].pitch[0])}, ${nm(L.wafers[0].pitch[1])}}`,
    `    Field InspectionStationID 3 {${L.station.map((s) => `"${s}"`).join(", ")}}`, "    Field OrientationMarkLocation 1 {0}",
    `    Field RecipeID 3 {"${L.setup}", "${d4}", "${t}"}`, `    Field ResultTimestamp 2 {"${d4}", "${t}"}`, '    Field SampleOrientationMarkType 1 {"NOTCH"}',
    `    Field SampleSize 2 {${L.diameter * 1e6}, 0}`, '    Field SampleType 1 {"WAFER"}', `    Field StepID 1 {"${L.step}"}`,
    "    List ClassLookupList", "    {", "      Columns 3 { int32 CLASSNUMBER, string CLASSNAME, string CLASSCODE }", `      Data ${CLASSES.length}`, "      {");
  for (const [c, n] of CLASSES) o.push(`        ${c} "${n}" "";`);
  o.push("      }", "    }");
  for (const w of L.wafers) {
    const d0 = w.d, n = d0.n;
    o.push(`    Record WaferRecord "${w.id}"`, "    {", `      Field DieOrigin 2 {0, 0}`, `      Field SampleCenterLocation 2 {${nm(w.center[0])}, ${nm(w.center[1])}}`,
      `      Field SlotNumber 1 {${w.slot}}`, "      List DefectList", "      {",
      "        Columns 13 { int32 DEFECTID, int32 XREL, int32 YREL, int32 XINDEX, int32 YINDEX, int32 XSIZE, int32 YSIZE, float DEFECTAREA, int32 DSIZE, int32 CLASSNUMBER, int32 TEST, int32 ROUGHBINNUMBER, ImageList IMAGEINFO }",
      `        Data ${n}`, "        {");
    for (let k = 0; k < n; k++) {
      const img = d0.img[k] ? `Images 1 {"img_${d0.id[k]}.jpg" "JPG" 1 "Patch"}` : "N";
      o.push(`          ${d0.id[k]} ${nm(d0.xr[k])} ${nm(d0.yr[k])} ${d0.xi[k]} ${d0.yi[k]} ${nm(d0.xs[k])} ${nm(d0.ys[k])} ${(d0.area[k] * 1e6).toExponential(4)} ${nm(d0.ds[k])} ${d0.cls[k]} 1 ${d0.cls[k]} ${img};`);
    }
    o.push("        }", "      }", '      Record TestRecord "1"', "      {", `        Field AreaPerTest 1 {${((w.plan.length / 2) * w.pitch[0] * w.pitch[1] * 1e6).toExponential(6)}}`,
      "        List SampleTestPlanList", "        {", "          Columns 2 { int32 XINDEX, int32 YINDEX }", `          Data ${w.plan.length / 2}`, "          {");
    for (let k = 0; k < w.plan.length; k += 2) o.push(`            ${w.plan[k]} ${w.plan[k + 1]};`);
    const nd = new Set(); for (let k = 0; k < n; k++) nd.add(`${d0.xi[k]},${d0.yi[k]}`);
    o.push("          }", "        }", "      }", "      Record SummaryRecord", "      {", "        List TestSummaryList", "        {",
      "          Columns 5 { int32 TESTNO, int32 NDEFECT, float DEFDENSITY, int32 NDIE, int32 NDEFDIE }", "          Data 1", "          {",
      `            1 ${n} ${(n / ((w.plan.length / 2) * w.pitch[0] * w.pitch[1] / 1e8)).toFixed(4)} ${w.plan.length / 2} ${nd.size};`,
      "          }", "        }", "      }", "    }");
  }
  o.push("  }", "}", "EndOfFile;");
  return o.join("\n") + "\n";
}

// 두 파일 비교 예시: 같은 웨이퍼를 세정 전(A) · 후(B)로 두 번 검사한 상황.
// B = A 결함의 65% (나머지는 제거됨) + 위치 반복 오차 ±2 µm + 새로 생긴 결함 400개(한쪽 군집)
export function makePair(seed = 31, n = 6000) {
  const r = rng(seed * 7 + 1);
  const t = trueDefects(n, seed * 1000 + 1, seed), def = { pitch: [...TRUE.pitch], grid: [...TRUE.grid] };
  const tb = { X: [], Y: [], C: [], S: [] };
  for (let k = 0; k < t.X.length; k++) if (r() < 0.65) { tb.X.push(t.X[k] + (r() - 0.5) * 4); tb.Y.push(t.Y[k] + (r() - 0.5) * 4); tb.C.push(t.C[k]); tb.S.push(t.S[k]); }
  const [px, py] = TRUE.pitch, [gx, gy] = TRUE.grid;
  for (let got = 0, k = 0; got < 400 && k < 100000; k++) {
    const x = 60000 + (r() - 0.5) * 50000, y = -40000 + (r() - 0.5) * 30000;
    const a = (((x - gx) % px) + px) % px, b = (((y - gy) % py) + py) % py;
    if (a > 50 && a < px - 50 && b > 50 && b < py - 50) { tb.X.push(x); tb.Y.push(y); tb.C.push(3); tb.S.push(1 + r() * 3); got++; }
  }
  const base = { lot: "SYN-LOT-02", device: "SYN-DEV-A", setup: "SYN-RECIPE-01", station: ["SYNTH", "MAPGEN", "TOOL-01"], diameter: 300 };
  const A = { ...base, step: "SYN-STEP-PRE", date: ["11-20-26", "10:00:00"], wafers: [{ id: "05", slot: 5, ...toFile(t, def, r) }] };
  const B = { ...base, step: "SYN-STEP-POST", date: ["11-20-26", "11:30:00"], wafers: [{ id: "05", slot: 5, ...toFile(tb, def, r) }] };
  return [write12(A), write12(B)];
}

// 깨진 파일 예시: 정상 1.2 에 열 빠진 행 · 숫자 아닌 값 · 머리글 오타를 넣는다
export function brokenText() {
  const lines = write12(makeLot({ seed: 11, n: 3000 })).split("\n");
  const at = lines.findIndex((s) => s.trim() === "DefectList");
  lines[at + 5] = lines[at + 5].trim().split(" ").slice(0, 12).join(" "); // 열 빠짐
  lines[at + 9] = lines[at + 9].replace(/^(\s*\d+) [\d.]+/, "$1 12O4.5"); // 숫자 자리에 O
  lines[at + 14] = " " + lines[at + 14].trim().split(" ").concat(["7", "7"]).join(" "); // 열 넘침
  return lines.join("\n");
}

// 앱 예시 목록. expect = 검증이 찾아야 할 맵 오류
export const SAMPLES = [
  { key: "ok12", ver: "1.2", make: () => write12(makeLot({ seed: 7, n: 8000 })), expect: [] },
  { key: "ok18", ver: "1.8", make: () => write18(makeLot({ seed: 8, n: 8000, wafers: 3 })), expect: [] },
  { key: "pitch", ver: "1.8", make: () => write18(makeLot({ seed: 21, n: 8000, error: "pitch" })), expect: ["pitch"] },
  { key: "scribe", ver: "1.2", make: () => write12(makeLot({ seed: 22, n: 8000, error: "scribe" })), expect: ["scribe"] },
  { key: "origin", ver: "1.2", make: () => write12(makeLot({ seed: 23, n: 8000, error: "origin" })), expect: ["origin"] },
  { key: "outside", ver: "1.8", make: () => write18(makeLot({ seed: 24, n: 8000, error: "outside" })), expect: ["outside"] },
  { key: "index", ver: "1.2", make: () => write12(makeLot({ seed: 25, n: 8000, error: "index" })), expect: ["index"] },
  { key: "broken", ver: "1.2", make: brokenText, expect: [] },
  { key: "pair", ver: "1.2", make: () => makePair(), expect: [], pair: true },
  { key: "big", ver: "1.2", make: () => write12(makeLot({ seed: 9, n: 1000000 })), expect: [], big: true },
  { key: "big18", ver: "1.8", make: () => write18(makeLot({ seed: 9, n: 1000000 })), expect: [], big: true },
];
export const sampleName = (s, k = 0) => `SYN_${s.key}${s.pair ? ["_pre", "_post"][k] : ""}_klarf${s.ver.replace(".", "")}.${s.ver === "1.8" ? "klarf" : "000"}`;
