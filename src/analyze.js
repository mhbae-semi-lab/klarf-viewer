// 결함 좌표 계산: 격자 색인(가까운 결함 찾기) · 다이별 개수 · A/B 비교 짝짓기 · 반복 결함
// 모두 형식과 무관하게 웨이퍼 좌표(x, y: 중심 0, µm)와 다이 인덱스(xi, yi)만 쓴다.

// 격자 색인 (CSR): 칸 크기 cell(µm). start[c]..start[c+1] 이 칸 c 의 결함 번호들
export function buildIndex(x, y, n, cell) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < n; i++) { const a = x[i], b = y[i]; if (a < x0) x0 = a; if (a > x1) x1 = a; if (b < y0) y0 = b; if (b > y1) y1 = b; }
  if (!n) { x0 = y0 = 0; x1 = y1 = 1; }
  const nx = Math.max(1, Math.min(4096, Math.ceil((x1 - x0) / cell) + 1)), ny = Math.max(1, Math.min(4096, Math.ceil((y1 - y0) / cell) + 1));
  const cx = (x1 - x0) / nx || cell, cy = (y1 - y0) / ny || cell;
  const key = new Int32Array(n), start = new Int32Array(nx * ny + 1), idx = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const kx = Math.min(nx - 1, ((x[i] - x0) / cx) | 0), ky = Math.min(ny - 1, ((y[i] - y0) / cy) | 0);
    key[i] = ky * nx + kx; start[key[i] + 1]++;
  }
  for (let c = 0; c < nx * ny; c++) start[c + 1] += start[c];
  const fill = start.slice(0, nx * ny);
  for (let i = 0; i < n; i++) idx[fill[key[i]]++] = i;
  return { x0, y0, cx, cy, nx, ny, start, idx, x, y };
}

// 반경 r 안에서 가장 가까운 결함 번호 (없으면 -1). keep(i) 가 false 인 결함은 건너뜀
export function nearest(ix, X, Y, r, keep) {
  const { x0, y0, cx, cy, nx, ny, start, idx, x, y } = ix;
  const ka = Math.max(0, Math.floor((X - r - x0) / cx)), kb = Math.min(nx - 1, Math.floor((X + r - x0) / cx));
  const la = Math.max(0, Math.floor((Y - r - y0) / cy)), lb = Math.min(ny - 1, Math.floor((Y + r - y0) / cy));
  let best = -1, bd = r * r;
  for (let l = la; l <= lb; l++) for (let k = ka; k <= kb; k++) {
    const c = l * nx + k;
    for (let j = start[c]; j < start[c + 1]; j++) {
      const i = idx[j];
      if (keep && !keep(i)) continue;
      const d = (x[i] - X) ** 2 + (y[i] - Y) ** 2;
      if (d <= bd) { bd = d; best = i; }
    }
  }
  return best;
}

export const dieKey = (i, j) => `${i},${j}`;

// 다이별 결함 수 (keep 으로 거른 결함만)
export function dieCounts(xi, yi, n, keep) {
  const m = new Map();
  for (let i = 0; i < n; i++) {
    if (keep && !keep(i)) continue;
    const k = dieKey(xi[i], yi[i]);
    m.set(k, (m.get(k) || 0) + 1);
  }
  return m;
}

// A/B 비교: B 의 각 결함에 대해 tol 안의 가장 가까운 A 결함과 1:1 로 짝짓는다 (가까운 쌍부터).
// 결과: sa[i] = 0 공통 · 1 A 에만, sb[j] = 0 공통 · 2 B 에만
export function matchDefects(A, B, tol) {
  const sa = new Uint8Array(A.n).fill(1), sb = new Uint8Array(B.n).fill(2);
  if (!A.n || !B.n) return { sa, sb, common: 0 };
  const ix = buildIndex(A.x, A.y, A.n, Math.max(tol * 4, 50));
  const pairs = [];
  const { x0, y0, cx, cy, nx, ny, start, idx } = ix;
  for (let j = 0; j < B.n; j++) {
    const X = B.x[j], Y = B.y[j];
    const ka = Math.max(0, Math.floor((X - tol - x0) / cx)), kb = Math.min(nx - 1, Math.floor((X + tol - x0) / cx));
    const la = Math.max(0, Math.floor((Y - tol - y0) / cy)), lb = Math.min(ny - 1, Math.floor((Y + tol - y0) / cy));
    for (let l = la; l <= lb; l++) for (let k = ka; k <= kb; k++) {
      const c = l * nx + k;
      for (let q = start[c]; q < start[c + 1]; q++) {
        const i = idx[q], d = (A.x[i] - X) ** 2 + (A.y[i] - Y) ** 2;
        if (d <= tol * tol) pairs.push(d, i, j);
      }
    }
  }
  const order = new Int32Array(pairs.length / 3).map((_, k) => k).sort((p, q) => pairs[3 * p] - pairs[3 * q]);
  let common = 0;
  for (const k of order) {
    const i = pairs[3 * k + 1], j = pairs[3 * k + 2];
    if (sa[i] === 1 && sb[j] === 2) { sa[i] = 0; sb[j] = 0; common++; }
  }
  return { sa, sb, common };
}

// 포아송 꼬리: 평균 lam 일 때 P(X >= k)
function tail(lam, k) {
  let p = Math.exp(-lam), c = p;
  for (let i = 1; i < k; i++) { p *= lam / i; c += p; }
  return Math.max(0, 1 - c);
}
// 우연히 cells 칸 중 하나라도 k 개 넘게 모일 기대 횟수가 0.5 미만이 되는 가장 작은 k
function chanceLimit(lam, cells, k0) {
  let k = k0;
  while (k < 1e6 && tail(lam, k) * cells >= 0.5) k++;
  return k;
}

// 다이 반복 결함: 다이 안 상대 위치(xr, yr)가 tol 안에서 같은 결함이 서로 다른 다이에 여럿 있으면 반복으로 본다.
// 문턱 = max(minDies, 결함이 무작위일 때 우연히 그만큼 모일 수 없는 다이 수). pitch 로 다이 안 칸 수를 센다.
// 결과: [{ xr, yr, dies, members: [결함 번호] }] 다이 수 많은 순
export function dieRepeaters(xr, yr, xi, yi, n, { tol = 15, minDies = 3, keep, pitch } = {}) {
  const cell = tol * 2, m = new Map();
  if (pitch) {
    let k = 0; for (let i = 0; i < n; i++) if (!keep || keep(i)) k++;
    const cells = Math.max(1, (pitch[0] * pitch[1]) / (cell * cell));
    minDies = chanceLimit((k / cells) * 2.25, cells, minDies); // 이웃 칸까지 모으므로 면적 약 (1.5)² 배
  }
  for (let i = 0; i < n; i++) {
    if (keep && !keep(i)) continue;
    const k = `${Math.floor(xr[i] / cell)},${Math.floor(yr[i] / cell)}`;
    let a = m.get(k); if (!a) m.set(k, (a = []));
    a.push(i);
  }
  const out = [], used = new Uint8Array(n);
  const cells = [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  for (const [k, list] of cells) {
    if (list.length < minDies) break;
    const [kx, ky] = k.split(",").map(Number);
    // 이웃 칸까지 모아 기준점(평균) 둘레 tol 안만
    const pool = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (const i of m.get(`${kx + dx},${ky + dy}`) || []) if (!used[i]) pool.push(i);
    if (pool.length < minDies) continue;
    let ax = 0, ay = 0; for (const i of list) { ax += xr[i]; ay += yr[i]; }
    ax /= list.length; ay /= list.length;
    const mem = pool.filter((i) => (xr[i] - ax) ** 2 + (yr[i] - ay) ** 2 <= tol * tol);
    const dies = new Set(mem.map((i) => dieKey(xi[i], yi[i])));
    if (dies.size < minDies) continue;
    for (const i of mem) used[i] = 1;
    out.push({ xr: ax, yr: ay, dies: dies.size, members: mem });
  }
  return out.sort((a, b) => b.dies - a.dies);
}

// 웨이퍼 겹치기: 여러 웨이퍼의 같은 위치(tol 안)에 결함이 있으면 반복 위치로 본다.
// 문턱 = max(minWafers, 무작위 결함이 우연히 같은 칸에 겹칠 수 없는 웨이퍼 수). R = 웨이퍼 반지름(µm)
export function waferRepeaters(list, { tol = 100, minWafers = 2, R = 150000 } = {}) {
  const cell = tol * 2, m = new Map();
  const cells = (Math.PI * R * R) / (cell * cell), W = list.length;
  const p = list.reduce((a, w) => a + (1 - Math.exp(-w.n / cells)), 0) / Math.max(1, W); // 한 웨이퍼가 한 칸을 차지할 확률
  for (let k = minWafers; k <= W; k++) { // 이항 꼬리 P(웨이퍼 >= k) · 칸 수 < 0.5
    let pk = 0; for (let j = k; j <= W; j++) pk += binom(W, j) * p ** j * (1 - p) ** (W - j);
    if (pk * cells < 0.5) { minWafers = k; break; }
    if (k === W) minWafers = W;
  }
  list.forEach((w, wi) => {
    for (let i = 0; i < w.n; i++) {
      if (w.keep && !w.keep(i)) continue;
      const k = `${Math.floor(w.x[i] / cell)},${Math.floor(w.y[i] / cell)}`;
      let a = m.get(k); if (!a) m.set(k, (a = []));
      a.push(wi, i);
    }
  });
  const out = [];
  for (const [k, a] of m) {
    const ws = new Set(); for (let q = 0; q < a.length; q += 2) ws.add(a[q]);
    if (ws.size < minWafers) continue;
    let sx = 0, sy = 0; for (let q = 0; q < a.length; q += 2) { sx += list[a[q]].x[a[q + 1]]; sy += list[a[q]].y[a[q + 1]]; }
    const [kx, ky] = k.split(",").map(Number);
    out.push({ x: sx / (a.length / 2), y: sy / (a.length / 2), wafers: ws.size, hits: a.length / 2, cell: [kx, ky], members: a });
  }
  return out.sort((p, q) => q.wafers - p.wafers || q.hits - p.hits);
}

function binom(n, k) { let r = 1; for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i; return r; }
