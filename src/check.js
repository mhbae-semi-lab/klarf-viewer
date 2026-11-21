// 맵 정의 검증. 파일을 열 때마다 돈다. 결함을 보기 전에 "이 맵 정의로 그린 그림을 믿어도 되나"를 확인한다.
//   pitch   결함 위치의 다이 주기(X · Y 투영의 주기 신호)가 선언한 DiePitch 와 같은가
//   scribe  다이 안 상대 좌표에서 스크라이브(빈 띠 · 짙은 띠)가 다이 경계에 오는가 = 격자 위상(원점 오프셋)이 맞나
//   origin  테스트 플랜 다이가 웨이퍼 원 밖으로 통째로 나가지 않는가 = 원점 다이 · 웨이퍼 중심이 맞나
//   outside 웨이퍼 원 밖 결함이 없는가
//   index   XREL · YREL 이 0 ~ pitch 안이고, 결함의 다이(XINDEX · YINDEX)가 테스트 플랜에 있는가
// 원인으로 설명되는 증상은 따로 세지 않는다: index · origin 을 바로잡은 좌표로 outside 를 센다.

export const CODES = ["pitch", "scribe", "origin", "outside", "index"];
export const DEFAULT_RULES = {
  pitchTol: 1.0,   // % 결함 주기와 선언 pitch 의 차이 허용
  pitchMinZ: 8,    // 주기 신호 세기 하한 (잡음 = 1). 이보다 약하면 판정하지 않음
  scribeTol: 2.0,  // % (pitch 대비) 띠 가장자리가 다이 경계에서 떨어져도 되는 거리
  originTol: 0,    // 웨이퍼 밖으로 통째로 나간 플랜 다이 허용 개수
  edgeTol: 500,    // µm 웨이퍼 반지름 밖 허용 여유
  relTol: 1,       // µm XREL · YREL 범위 여유
  indexMin: 1,     // 플랜 밖 다이 결함이 이 개수 이상이면 오류
  minDefects: 2000, // pitch · scribe 판정에 필요한 결함 수
};

const SPAN = 1 << 15, OFF = 1 << 14;
const dk = (i, j) => (i + OFF) * SPAN + (j + OFF);

export function checkWafer(W, rules = DEFAULT_RULES) {
  const R = { ...DEFAULT_RULES, ...rules };
  const out = [];
  const g = W.geo, [px, py] = g.pitch;
  if (!(px > 0 && py > 0) || !(g.R > 0)) {
    out.push({ code: "geometry", level: "error", v: { pitch: g.pitch, R: g.R } });
    return finish(out);
  }
  const n = W.n;
  const plan = W.plan && W.plan.length ? W.plan : null;
  const planSet = new Set();
  if (plan) for (let k = 0; k < plan.length; k += 2) planSet.add(dk(plan[k], plan[k + 1]));

  // ---- index: 상대 좌표 범위 + 플랜 밖 다이 ----
  const rangeBad = [], offPlan = [];
  for (let i = 0; i < n; i++) {
    const a = W.xr[i], b = W.yr[i];
    if (a < -R.relTol || a > px + R.relTol || b < -R.relTol || b > py + R.relTol) rangeBad.push(i);
    if (plan && !planSet.has(dk(W.xi[i], W.yi[i]))) offPlan.push(i);
  }
  let idxShift = [0, 0];
  if (offPlan.length >= R.indexMin && offPlan.length / Math.max(1, n) > 0.002) {
    // 결함 다이를 몇 다이 옮기면 플랜에 맞나 (표본 2만 개)
    const step = Math.max(1, Math.floor(n / 20000));
    let best = -1;
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      let hit = 0;
      for (let i = 0; i < n; i += step) if (planSet.has(dk(W.xi[i] + dx, W.yi[i] + dy))) hit++;
      if (hit > best || (hit === best && Math.abs(dx) + Math.abs(dy) < Math.abs(idxShift[0]) + Math.abs(idxShift[1]))) { best = hit; idxShift = [dx, dy]; }
    }
  }
  if (rangeBad.length || offPlan.length >= R.indexMin) {
    out.push({ code: "index", level: "error", members: [...new Set([...rangeBad, ...offPlan])].sort((a, b) => a - b),
      v: { range: rangeBad.length, offPlan: offPlan.length, n, shift: idxShift, planDies: planSet.size } });
  }

  // ---- origin: 플랜 다이가 웨이퍼 원 밖으로 통째로 나갔나 ----
  const dies = plan || dieListFromDefects(W);
  const outsideDies = (sx, sy) => {
    let c = 0; const list = [];
    for (let k = 0; k < dies.length; k += 2) {
      const x0 = g.grid[0] + (dies[k] + sx) * px, y0 = g.grid[1] + (dies[k + 1] + sy) * py;
      const qx = Math.max(x0, Math.min(0, x0 + px)), qy = Math.max(y0, Math.min(0, y0 + py)); // 사각형에서 중심에 가장 가까운 점
      if (Math.hypot(qx, qy) > g.R + R.edgeTol) { c++; if (list.length < 400) list.push([dies[k], dies[k + 1]]); }
    }
    return { c, list };
  };
  const o0 = outsideDies(0, 0);
  let orgShift = [0, 0];
  if (o0.c > R.originTol) {
    let best = o0.c;
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      const c = outsideDies(dx, dy).c;
      if (c < best || (c === best && Math.abs(dx) + Math.abs(dy) < Math.abs(orgShift[0]) + Math.abs(orgShift[1]))) { best = c; orgShift = [dx, dy]; }
    }
    out.push({ code: "origin", level: "error", dies: o0.list, v: { outsideDies: o0.c, planDies: dies.length / 2, fromPlan: !!plan, shift: orgShift, shiftUm: [orgShift[0] * px, orgShift[1] * py] } });
  }

  // ---- outside: 원인(index · origin)을 바로잡은 좌표로 센다 ----
  const ox = (orgShift[0] + idxShift[0]) * px, oy = (orgShift[1] + idxShift[1]) * py;
  const lim = g.R + R.edgeTol, outs = [];
  let rawOut = 0;
  for (let i = 0; i < n; i++) {
    if (Math.hypot(W.x[i], W.y[i]) > lim) rawOut++;
    if (Math.hypot(W.x[i] + ox, W.y[i] + oy) > lim) outs.push(i);
  }
  if (outs.length) out.push({ code: "outside", level: "error", members: outs, v: { count: outs.length, n, R: g.R, tol: R.edgeTol, maxR: maxR(W, outs, ox, oy) } });
  else if (rawOut) out.push({ code: "outsideExplained", level: "info", v: { count: rawOut } });

  // ---- pitch · scribe (축마다) ----
  for (const ax of [0, 1]) {
    const p = g.pitch[ax];
    if (n < R.minDefects) { out.push({ code: "periodSkip", level: "info", axis: ax, v: { n, need: R.minDefects } }); continue; }
    const per = period(ax ? W.y : W.x, n, p, g.R);
    const dev = ((per.q - p) / p) * 100;
    const pitchBad = per.z >= R.pitchMinZ && Math.abs(dev) > R.pitchTol;
    if (pitchBad) out.push({ code: "pitch", level: "error", axis: ax, v: { declared: p, measured: per.q, dev, z: per.z } });
    else if (per.z < R.pitchMinZ) out.push({ code: "periodWeak", level: "info", axis: ax, v: { z: per.z } });
    if (pitchBad) { out.push({ code: "scribeSkip", level: "info", axis: ax }); continue; }
    const sc = scribeBand(ax ? W.yr : W.xr, n, p);
    if (!sc) { out.push({ code: "scribeWeak", level: "info", axis: ax }); continue; }
    // 띠 가장자리와 다이 경계(0 = p) 사이 거리
    const inside = sc.lo <= sc.hi ? (sc.lo > 0 && sc.hi < p) : false; // 띠가 경계를 감싸지 않음
    const gap = inside ? Math.min(sc.lo, p - sc.hi) : 0;
    if (gap > (R.scribeTol / 100) * p) out.push({ code: "scribe", level: "error", axis: ax, v: { lo: sc.lo, hi: sc.hi, kind: sc.kind, gap, pitch: p, offset: sc.center > p / 2 ? sc.center - p : sc.center } });
  }

  // ---- 머리글 점검 (주의) ----
  if (W.classes) {
    const unknown = new Set();
    for (let i = 0; i < n; i++) if (!W.classes.has(W.cls[i])) unknown.add(W.cls[i]);
    if (unknown.size) out.push({ code: "classUnknown", level: "warn", v: { list: [...unknown].slice(0, 12) } });
  }
  if (W.summary && W.summary.ndefect != null && W.summary.ndefect !== n) out.push({ code: "summary", level: "warn", v: { declared: W.summary.ndefect, actual: n } });
  if (!plan) out.push({ code: "noPlan", level: "info" });
  return finish(out);
}

// 추정값으로 고쳐 본 웨이퍼 (파일은 그대로). index · origin 은 다이 단위로 옮기고,
// pitch · scribe 는 결함의 웨이퍼 좌표는 두고 격자만 새로 잡아 XINDEX · XREL 과 테스트 플랜을 다시 계산한다.
export function applyFix(W, res) {
  const f = (c, a) => res.findings.find((x) => x.code === c && (a == null || x.axis === a));
  const pitch = [...W.geo.pitch], grid = [...W.geo.grid], n = W.n;
  const x = Float64Array.from(W.x), y = Float64Array.from(W.y);
  let xi = W.xi, yi = W.yi, xr = W.xr, yr = W.yr, plan = W.plan, regrid = false;
  const notes = [];
  const idx = f("index"), org = f("origin");
  if (idx && (idx.v.shift[0] || idx.v.shift[1])) {
    const [dx, dy] = idx.v.shift;
    xi = W.xi.map((v) => v + dx); yi = W.yi.map((v) => v + dy);
    for (let i = 0; i < n; i++) { x[i] += dx * pitch[0]; y[i] += dy * pitch[1]; }
    notes.push({ code: "index", v: idx.v.shift });
  }
  if (org && (org.v.shift[0] || org.v.shift[1])) {
    const [sx, sy] = org.v.shift;
    grid[0] += sx * pitch[0]; grid[1] += sy * pitch[1];
    for (let i = 0; i < n; i++) { x[i] += sx * pitch[0]; y[i] += sy * pitch[1]; }
    notes.push({ code: "origin", v: org.v.shift });
  }
  for (const a of [0, 1]) {
    const p = f("pitch", a); if (p) { pitch[a] = p.v.measured; regrid = true; notes.push({ code: "pitch", axis: a, v: p.v.measured }); }
    const s = f("scribe", a); if (s) { grid[a] += s.v.offset; regrid = true; notes.push({ code: "scribe", axis: a, v: s.v.offset }); }
  }
  if (regrid) {
    xi = new Int32Array(n); yi = new Int32Array(n); xr = new Float64Array(n); yr = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      xi[i] = Math.floor((x[i] - grid[0]) / pitch[0]); yi[i] = Math.floor((y[i] - grid[1]) / pitch[1]);
      xr[i] = x[i] - grid[0] - xi[i] * pitch[0]; yr[i] = y[i] - grid[1] - yi[i] * pitch[1];
    }
    const R = W.geo.R, a = [];
    for (let i = Math.floor((-R - grid[0]) / pitch[0]) - 1; grid[0] + i * pitch[0] < R; i++) for (let j = Math.floor((-R - grid[1]) / pitch[1]) - 1; grid[1] + j * pitch[1] < R; j++) {
      const x0 = grid[0] + i * pitch[0], y0 = grid[1] + j * pitch[1];
      if (Math.hypot(Math.max(x0, Math.min(0, x0 + pitch[0])), Math.max(y0, Math.min(0, y0 + pitch[1]))) < R) a.push(i, j);
    }
    plan = Int32Array.from(a);
    notes.push({ code: "plan" });
  }
  return { ...W, geo: { ...W.geo, pitch, grid }, pitch, center: [-grid[0], -grid[1]], x, y, xi, yi, xr, yr, plan, fixNotes: notes };
}

function finish(out) {
  const rank = { error: 0, warn: 1, info: 2 };
  const order = (c) => { const i = CODES.indexOf(c); return i < 0 ? 99 : i; };
  out.sort((a, b) => rank[a.level] - rank[b.level] || order(a.code) - order(b.code) || (a.axis || 0) - (b.axis || 0));
  return { findings: out, errors: [...new Set(out.filter((f) => f.level === "error").map((f) => f.code))] };
}

function maxR(W, list, ox, oy) { let m = 0; for (const i of list) m = Math.max(m, Math.hypot(W.x[i] + ox, W.y[i] + oy)); return m; }

function dieListFromDefects(W) {
  const s = new Set(), a = [];
  for (let i = 0; i < W.n; i++) { const k = dk(W.xi[i], W.yi[i]); if (!s.has(k)) { s.add(k); a.push(W.xi[i], W.yi[i]); } }
  return Int32Array.from(a);
}

// 주기 찾기: 좌표를 히스토그램으로 모은 뒤, 선언 pitch ±5% 안의 후보 주기 q 마다 1~8차 고조파 세기를 더한다.
// 잡음(무작위 위치)이면 평균 1, 다이마다 되풀이되는 구조(스크라이브 빈 띠 · 반복 결함)가 있으면 실제 주기에서 솟는다.
export function period(v, n, p, Rw, K = 8) {
  const b = p / 32, M = Math.ceil((2 * Rw * 1.1) / b), x0 = -Rw * 1.1;
  const h = new Float64Array(M);
  for (let i = 0; i < n; i++) { const m = ((v[i] - x0) / b) | 0; if (m >= 0 && m < M) h[m]++; }
  let m0 = 0, m1 = M - 1;
  while (m0 < M && !h[m0]) m0++;
  while (m1 > m0 && !h[m1]) m1--;
  // 칸 간격이 같으니 위상은 곱셈 점화식으로 (삼각함수는 고조파마다 두 번만)
  const S = (q) => {
    let s = 0;
    for (let k = 1; k <= K; k++) {
      const w = (2 * Math.PI * k) / q, c = Math.cos(w * b), sn = Math.sin(w * b), xa = x0 + (m0 + 0.5) * b;
      let cr = Math.cos(w * xa), ci = Math.sin(w * xa), re = 0, im = 0;
      for (let m = m0; m <= m1; m++) { const v = h[m]; re += v * cr; im += v * ci; const t = cr * c - ci * sn; ci = cr * sn + ci * c; cr = t; }
      s += (re * re + im * im) / n;
    }
    return s / K;
  };
  const steps = 200, lo = p * 0.95, dq = (p * 0.1) / steps;
  let best = 0, bq = p, vals = [];
  for (let s = 0; s <= steps; s++) { const q = lo + s * dq, val = S(q); vals.push(val); if (val > best) { best = val; bq = q; } }
  // 꼭짓점 다듬기 (포물선)
  const k = Math.round((bq - lo) / dq);
  if (k > 0 && k < steps) { const a = vals[k - 1], c = vals[k + 1], d = a - 2 * best + c; if (d < 0) bq += (0.5 * (a - c) / d) * dq; }
  return { q: bq, z: best, atDeclared: S(p) };
}

// 다이 안 상대 좌표에서 빈 띠(결함이 거의 없는 띠, 보통 검사 영역 밖인 스크라이브) 또는 짙은 띠를 찾는다.
// 결과: { lo, hi, center, kind } (µm, 0 ~ p, 경계를 감싸면 lo > hi) 또는 null
export function scribeBand(r, n, p) {
  const B = 400, h = new Float64Array(B);
  let m = 0;
  for (let i = 0; i < n; i++) { const a = r[i]; if (a >= 0 && a < p) { h[Math.min(B - 1, ((a / p) * B) | 0)]++; m++; } }
  if (m < 500) return null;
  const mean = m / B;
  const low = h.map((x) => (x < mean * 0.15 ? 1 : 0));
  const run = (f) => { // 원형으로 가장 긴 연속 구간. 0 바로 다음에서 시작하면 감싸는 구간도 한 번에 센다
    const start = f.indexOf(0);
    if (start < 0) return null;
    let bestL = 0, bestS = -1, L = 0, S = -1;
    for (let k = 1; k <= B; k++) {
      const j = (start + k) % B;
      if (f[j]) { if (!L) S = j; L++; if (L > bestL) { bestL = L; bestS = S; } } else L = 0;
    }
    return bestL ? { s: bestS, L: bestL } : null;
  };
  // 짙은 띠는 보지 않는다: 반복 결함도 짙은 띠를 만들어 스크라이브로 잘못 볼 수 있다
  const r0 = run(low);
  if (!r0 || r0.L < 2 || r0.L > B * 0.2) return null; // 너무 넓은 빈 구간은 스크라이브로 보지 않음
  if (mean * r0.L < 30) return null; // 우연히 빈 구간일 수 있을 만큼 결함이 적음
  const lo = (r0.s / B) * p, hi = (((r0.s + r0.L) % B) / B) * p;
  let center = lo + ((r0.L / B) * p) / 2; if (center >= p) center -= p;
  return { lo, hi, center, kind: "empty" };
}
