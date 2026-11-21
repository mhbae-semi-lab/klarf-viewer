// 웨이퍼 맵 화면. 세 겹의 캔버스:
//   base (2D)   웨이퍼 원 · 노치 · 다이 칠하기(다이 1개 = 픽셀 1개인 작은 그림을 늘려 그림) · 다이 격자
//   pts  (WebGL) 결함 점. 위치 · 색 버퍼를 한 번 올리고 확대 · 이동은 uniform 만 바꾼다 → 100만 개도 60fps
//   over (2D)   강조(검증 결과) · 마우스 위치 다이 · 가까운 결함
// 좌표: 웨이퍼 중심 (0,0), µm, +x 오른쪽, +y 위. view = { cx, cy, s(px/µm) }
const VS = `attribute vec2 p; attribute vec4 c; uniform vec2 uc; uniform vec2 uk; uniform float ps; varying vec4 vc;
void main(){ gl_Position = vec4((p - uc) * uk, 0.0, 1.0); gl_PointSize = ps; vc = c; }`;
const FS = `precision mediump float; varying vec4 vc; void main(){ if (vc.a < 0.01) discard; gl_FragColor = vc; }`;

export function createMap(root, { onHover, onPick, onView } = {}) {
  const mk = (cls) => { const c = document.createElement("canvas"); c.className = cls; root.appendChild(c); return c; };
  const base = mk("m-base"), pts = mk("m-pts"), over = mk("m-over");
  const bx = base.getContext("2d"), ox = over.getContext("2d");
  let gl = null, prog = null, bufP = null, bufC = null;
  try { gl = pts.getContext("webgl", { premultipliedAlpha: false, antialias: false, preserveDrawingBuffer: true }); } catch { gl = null; }
  if (gl) {
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
    prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) gl = null;
    else { bufP = gl.createBuffer(); bufC = gl.createBuffer(); }
  }

  const M = {
    view: { cx: 0, cy: 0, s: 0.001 }, W: 0, H: 0, dpr: 1,
    geo: null, n: 0, x: null, y: null, col: null, dieImg: null, dieBox: null,
    marks: [], hover: null, colors: {}, pointPx: 2.5, frameMs: [], gl: !!gl,
  };
  let dirty = true, raf = 0;

  function resize() {
    const r = root.getBoundingClientRect();
    M.dpr = Math.min(window.devicePixelRatio || 1, 2);
    M.W = Math.max(1, Math.round(r.width)); M.H = Math.max(1, Math.round(r.height));
    for (const c of [base, pts, over]) { c.width = Math.round(M.W * M.dpr); c.height = Math.round(M.H * M.dpr); }
    if (M.auto && M.geo && M.W > 1 && M.H > 1) fit(); // 사용자가 옮기지 않았으면 새 크기에 다시 맞춘다
    request();
  }
  new ResizeObserver(resize).observe(root);
  // ResizeObserver 는 화면이 숨겨져 있으면 늦게 올 수 있다: 크기가 없으면 직접 잰다
  const sized = () => { if (M.W <= 1 || M.H <= 1) resize(); return M.W > 1 && M.H > 1; };

  const sx = (X) => M.W / 2 + (X - M.view.cx) * M.view.s;
  const sy = (Y) => M.H / 2 - (Y - M.view.cy) * M.view.s;
  const wx = (x) => M.view.cx + (x - M.W / 2) / M.view.s;
  const wy = (y) => M.view.cy - (y - M.H / 2) / M.view.s;

  function fit() {
    if (!M.geo || !sized()) return;
    const R = M.geo.R * 1.08;
    M.view = { cx: 0, cy: 0, s: Math.min(M.W, M.H) / (2 * R) };
    M.auto = true; M.fitS = M.view.s;
    request(); onView?.(M.view);
  }
  function zoom(k, x = M.W / 2, y = M.H / 2) {
    if (!sized()) return;
    const X = wx(x), Y = wy(y);
    const s0 = M.geo ? Math.min(M.W, M.H) / (2 * M.geo.R * 1.08) : 1e-3;
    M.auto = false;
    M.view.s = Math.min(s0 * 4000, Math.max(s0 * 0.5, M.view.s * k));
    M.view.cx = X - (x - M.W / 2) / M.view.s; M.view.cy = Y + (y - M.H / 2) / M.view.s;
    request(); onView?.(M.view);
  }
  function pan(dx, dy) { M.auto = false; M.view.cx -= dx / M.view.s; M.view.cy += dy / M.view.s; request(); onView?.(M.view); }
  function center(X, Y, s) { M.auto = false; M.view.cx = X; M.view.cy = Y; if (s) M.view.s = s; request(); onView?.(M.view); }

  function request() { dirty = true; if (!raf) raf = requestAnimationFrame(frame); }
  function frame(ts) {
    raf = 0;
    if (!dirty) return;
    dirty = false;
    const t0 = performance.now();
    drawBase(); drawPoints(); drawOver();
    M.frameMs.push(performance.now() - t0); if (M.frameMs.length > 120) M.frameMs.shift();
    M.lastFrame = ts;
  }

  const css = (v) => getComputedStyle(root).getPropertyValue(v).trim();
  function drawBase() {
    const c = bx, d = M.dpr, g = M.geo;
    c.setTransform(d, 0, 0, d, 0, 0);
    c.clearRect(0, 0, M.W, M.H);
    if (!g) return;
    if (g.kind === "die") { // 다이 겹치기: 다이 한 개 사각형
      const [px, py] = g.pitch, [gx, gy] = g.grid;
      c.fillStyle = css("--wafer"); c.fillRect(sx(gx), sy(gy + py), px * M.view.s, py * M.view.s);
      if (M.dieImg && M.dieBox) { const b = M.dieBox; c.imageSmoothingEnabled = false; c.drawImage(M.dieImg, sx(b.x0), sy(b.y1), (b.x1 - b.x0) * M.view.s, (b.y1 - b.y0) * M.view.s); }
      c.strokeStyle = css("--wafer-edge"); c.lineWidth = 1.5; c.strokeRect(sx(gx), sy(gy + py), px * M.view.s, py * M.view.s);
      return;
    }
    const R = g.R * M.view.s, X0 = sx(0), Y0 = sy(0);
    c.fillStyle = css("--wafer"); c.beginPath(); c.arc(X0, Y0, R, 0, Math.PI * 2); c.fill();
    // 다이 칠하기: 작은 그림(다이 1개 = 1픽셀)을 다이 격자 위치로 늘려 그린다
    if (M.dieImg && M.dieBox) {
      const b = M.dieBox;
      c.save(); c.beginPath(); c.arc(X0, Y0, R + 2, 0, Math.PI * 2); c.clip();
      c.imageSmoothingEnabled = false;
      c.drawImage(M.dieImg, sx(b.x0), sy(b.y1), (b.x1 - b.x0) * M.view.s, (b.y1 - b.y0) * M.view.s);
      c.restore();
    }
    // 다이 격자: 다이가 화면에서 4px 이상일 때만
    const [px, py] = g.pitch, [gx, gy] = g.grid;
    if (px * M.view.s >= 4 && py * M.view.s >= 4) {
      c.save(); c.beginPath(); c.arc(X0, Y0, R, 0, Math.PI * 2); c.clip();
      c.strokeStyle = css("--grid"); c.lineWidth = 1; c.beginPath();
      const xa = Math.max(-g.R, wx(0)), xb = Math.min(g.R, wx(M.W)), ya = Math.max(-g.R, wy(M.H)), yb = Math.min(g.R, wy(0));
      for (let k = Math.ceil((xa - gx) / px); gx + k * px <= xb; k++) { const x = Math.round(sx(gx + k * px)) + 0.5; c.moveTo(x, sy(yb)); c.lineTo(x, sy(ya)); }
      for (let k = Math.ceil((ya - gy) / py); gy + k * py <= yb; k++) { const y = Math.round(sy(gy + k * py)) + 0.5; c.moveTo(sx(xa), y); c.lineTo(sx(xb), y); }
      c.stroke(); c.restore();
    }
    c.strokeStyle = css("--wafer-edge"); c.lineWidth = 1.5; c.beginPath(); c.arc(X0, Y0, R, 0, Math.PI * 2); c.stroke();
    // 노치 · 플랫 위치 (DOWN · UP · LEFT · RIGHT)
    const a = { DOWN: Math.PI / 2, UP: -Math.PI / 2, LEFT: Math.PI, RIGHT: 0 }[g.notch] ?? Math.PI / 2;
    const nx = X0 + Math.cos(a) * R, ny = Y0 + Math.sin(a) * R;
    c.fillStyle = css("--bg"); c.strokeStyle = css("--wafer-edge");
    c.beginPath(); c.arc(nx, ny, Math.max(4, R * 0.025), 0, Math.PI * 2); c.fill(); c.stroke();
  }

  function drawPoints() {
    if (gl) {
      gl.viewport(0, 0, pts.width, pts.height);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      if (!M.n) return;
      gl.useProgram(prog);
      gl.uniform2f(gl.getUniformLocation(prog, "uc"), M.view.cx, M.view.cy);
      gl.uniform2f(gl.getUniformLocation(prog, "uk"), (2 * M.view.s) / M.W, (2 * M.view.s) / M.H);
      gl.uniform1f(gl.getUniformLocation(prog, "ps"), pointSize() * M.dpr);
      const lp = gl.getAttribLocation(prog, "p"), lc = gl.getAttribLocation(prog, "c");
      gl.bindBuffer(gl.ARRAY_BUFFER, bufP); gl.enableVertexAttribArray(lp); gl.vertexAttribPointer(lp, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, bufC); gl.enableVertexAttribArray(lc); gl.vertexAttribPointer(lc, 4, gl.UNSIGNED_BYTE, true, 0, 0);
      gl.drawArrays(gl.POINTS, 0, M.n);
      return;
    }
    // WebGL 이 없을 때: 픽셀 버퍼에 직접 찍는다 (느리지만 동작)
    const c = pts.getContext("2d");
    if (!c) return;
    const w = pts.width, h = pts.height, img = c.createImageData(w, h), u = new Uint32Array(img.data.buffer), col = new Uint32Array(M.col.buffer);
    const k = M.view.s * M.dpr, ox0 = w / 2 - M.view.cx * k, oy0 = h / 2 + M.view.cy * k, r = Math.max(1, Math.round(pointSize() * M.dpr / 2));
    for (let i = 0; i < M.n; i++) {
      const cc = col[i]; if (!(cc >>> 24)) continue;
      const X = (ox0 + M.x[i] * k) | 0, Y = (oy0 - M.y[i] * k) | 0;
      for (let yy = Y - r + 1; yy <= Y; yy++) if (yy >= 0 && yy < h) for (let xx = X - r + 1; xx <= X; xx++) if (xx >= 0 && xx < w) u[yy * w + xx] = cc;
    }
    c.putImageData(img, 0, 0);
  }
  const pointSize = () => Math.min(9, M.pointPx * Math.min(1, Math.max(0.5, Math.min(M.W, M.H) / 600)) * Math.max(1, Math.sqrt(M.view.s / (M.fitS || M.view.s))));

  function drawOver() {
    const c = ox, d = M.dpr;
    c.setTransform(d, 0, 0, d, 0, 0);
    c.clearRect(0, 0, M.W, M.H);
    if (!M.geo) return;
    const [px, py] = M.geo.pitch, [gx, gy] = M.geo.grid;
    if (M.geo.kind === "die") { // 다이 겹치기에서는 다이 칸 강조 대신 점 · 띠
      for (const m of M.marks) if (m.band) { // [축, 시작, 끝] 다이 좌표
        const [a, b0, b1] = m.band, x0 = a ? sx(gx) : sx(b0), x1 = a ? sx(gx + px) : sx(b1), y0 = a ? sy(b1) : sy(gy + py), y1 = a ? sy(b0) : sy(gy);
        c.fillStyle = m.color; c.globalAlpha = 0.25; c.fillRect(x0, y0, Math.max(2, x1 - x0), Math.max(2, y1 - y0)); c.globalAlpha = 1;
        c.strokeStyle = m.color; c.lineWidth = 1.5; c.strokeRect(x0, y0, Math.max(2, x1 - x0), Math.max(2, y1 - y0));
      }
      for (const m of M.marks) if (m.pt) { c.strokeStyle = m.color || css("--mark"); c.lineWidth = m.width || 2; c.beginPath(); c.arc(sx(m.pt[0]), sy(m.pt[1]), m.r || 7, 0, Math.PI * 2); c.stroke(); }
      if (M.hover?.pt) { c.strokeStyle = css("--ink"); c.lineWidth = 1.5; c.beginPath(); c.arc(sx(M.hover.pt[0]), sy(M.hover.pt[1]), 6, 0, Math.PI * 2); c.stroke(); }
      return;
    }
    const dieRect = (i, j) => [sx(gx + i * px), sy(gy + (j + 1) * py), px * M.view.s, py * M.view.s];
    for (const m of M.marks) {
      c.strokeStyle = m.color || css("--mark"); c.fillStyle = m.fill || "transparent"; c.lineWidth = m.width || 2;
      if (m.die) { const [x, y, w, h] = dieRect(m.die[0], m.die[1]); if (m.fill) c.fillRect(x, y, w, h); c.strokeRect(x + 1, y + 1, Math.max(2, w - 2), Math.max(2, h - 2)); }
      if (m.pt) { c.beginPath(); c.arc(sx(m.pt[0]), sy(m.pt[1]), m.r || 7, 0, Math.PI * 2); c.stroke(); }
      if (m.circle) { c.setLineDash([6, 5]); c.beginPath(); c.arc(sx(m.circle[0]), sy(m.circle[1]), m.circle[2] * M.view.s, 0, Math.PI * 2); c.stroke(); c.setLineDash([]); }
      if (m.cross) { const x = sx(m.cross[0]), y = sy(m.cross[1]); c.beginPath(); c.moveTo(x - 10, y); c.lineTo(x + 10, y); c.moveTo(x, y - 10); c.lineTo(x, y + 10); c.stroke(); }
    }
    if (M.hover) {
      c.strokeStyle = css("--ink"); c.lineWidth = 1.5;
      if (M.hover.die) { const [x, y, w, h] = dieRect(M.hover.die[0], M.hover.die[1]); c.strokeRect(x, y, w, h); }
      if (M.hover.pt) { c.beginPath(); c.arc(sx(M.hover.pt[0]), sy(M.hover.pt[1]), 6, 0, Math.PI * 2); c.stroke(); }
    }
  }

  // ---- 입력: 끌어서 이동, 휠 확대, 두 손가락 확대, 더블클릭 전체, 키보드 ----
  const ptrs = new Map();
  let moved = 0, pinch = 0;
  over.style.touchAction = "none";
  over.addEventListener("pointerdown", (e) => { over.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.offsetX, e.offsetY]); moved = 0; if (ptrs.size === 2) pinch = dist(); });
  over.addEventListener("pointermove", (e) => {
    const p = ptrs.get(e.pointerId);
    if (!p) { hoverAt(e.offsetX, e.offsetY); return; }
    if (ptrs.size === 2) {
      ptrs.set(e.pointerId, [e.offsetX, e.offsetY]);
      const d2 = dist(), [a, b] = [...ptrs.values()];
      if (pinch) zoom(d2 / pinch, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      pinch = d2; moved = 99; return;
    }
    const dx = e.offsetX - p[0], dy = e.offsetY - p[1];
    moved += Math.abs(dx) + Math.abs(dy);
    ptrs.set(e.pointerId, [e.offsetX, e.offsetY]);
    pan(dx, dy);
  });
  const up = (e) => {
    if (ptrs.has(e.pointerId) && moved < 4 && ptrs.size === 1) onPick?.(hit(e.offsetX, e.offsetY));
    ptrs.delete(e.pointerId); pinch = 0;
  };
  over.addEventListener("pointerup", up);
  over.addEventListener("pointercancel", (e) => { ptrs.delete(e.pointerId); pinch = 0; });
  over.addEventListener("pointerleave", () => { if (!ptrs.size) { M.hover = null; onHover?.(null); request(); } });
  const dist = () => { const [a, b] = [...ptrs.values()]; return Math.hypot(a[0] - b[0], a[1] - b[1]) || 1; };
  over.addEventListener("wheel", (e) => { e.preventDefault(); zoom(Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.0018)), e.offsetX, e.offsetY); }, { passive: false });
  over.addEventListener("dblclick", fit);
  root.addEventListener("keydown", (e) => {
    const k = e.key, c = e.code, step = 60;
    if (k === "ArrowLeft") pan(step, 0); else if (k === "ArrowRight") pan(-step, 0);
    else if (k === "ArrowUp") pan(0, step); else if (k === "ArrowDown") pan(0, -step);
    else if (k === "+" || k === "=" || c === "Equal" || c === "NumpadAdd") zoom(1.4);
    else if (k === "-" || k === "_" || c === "Minus" || c === "NumpadSubtract") zoom(1 / 1.4);
    else if (k === "0" || c === "Digit0" || c === "Numpad0") fit(); else return;
    e.preventDefault();
  });

  function hit(x, y) {
    if (!M.geo) return null;
    const X = wx(x), Y = wy(y), [px, py] = M.geo.pitch, [gx, gy] = M.geo.grid;
    const die = M.geo.kind === "die" ? null : [Math.floor((X - gx) / px), Math.floor((Y - gy) / py)];
    const pt = M.nearest ? M.nearest(X, Y, 8 / M.view.s) : -1;
    return { X, Y, die, idx: pt };
  }
  function hoverAt(x, y) {
    const h = hit(x, y);
    if (!h) return;
    M.hover = { die: h.die, pt: h.idx >= 0 ? [M.x[h.idx], M.y[h.idx]] : null };
    onHover?.(h, x, y);
    request();
  }

  return {
    M, fit, zoom, pan, center, request, resize, canvas: over, sx, sy,
    setGeo(geo) { M.geo = geo; M.auto = true; fit(); },
    setPoints(x, y, n) {
      M.x = x; M.y = y; M.n = n;
      if (gl) {
        const xy = new Float32Array(n * 2);
        for (let i = 0; i < n; i++) { xy[2 * i] = x[i]; xy[2 * i + 1] = y[i]; }
        gl.bindBuffer(gl.ARRAY_BUFFER, bufP); gl.bufferData(gl.ARRAY_BUFFER, xy, gl.STATIC_DRAW);
      }
      request();
    },
    setColors(rgba) { // Uint8Array n*4, 알파 0 = 숨김
      M.col = rgba;
      if (gl) { gl.bindBuffer(gl.ARRAY_BUFFER, bufC); gl.bufferData(gl.ARRAY_BUFFER, rgba, gl.DYNAMIC_DRAW); }
      request();
    },
    setDies(img, box) { M.dieImg = img; M.dieBox = box; request(); },
    setMarks(m) { M.marks = m || []; request(); },
    setNearest(fn) { M.nearest = fn; },
    // PNG: 세 겹을 한 장으로
    snapshot(title) {
      const c = document.createElement("canvas"); c.width = base.width; c.height = base.height;
      const x = c.getContext("2d");
      x.fillStyle = css("--bg"); x.fillRect(0, 0, c.width, c.height);
      x.drawImage(base, 0, 0); x.drawImage(pts, 0, 0); x.drawImage(over, 0, 0);
      if (title) { x.fillStyle = css("--ink"); x.font = `${13 * M.dpr}px sans-serif`; x.fillText(title, 10 * M.dpr, 20 * M.dpr); }
      return c;
    },
  };
}
