import { test } from "node:test";
import assert from "node:assert/strict";
import { buildIndex, nearest, matchDefects, dieRepeaters, waferRepeaters, dieCounts } from "../src/analyze.js";
import { makeLot, write18 } from "../src/gen.js";
import { parseText } from "../src/klarf.js";

test("가까운 결함 찾기", () => {
  const x = Float64Array.from([0, 100, 5000]), y = Float64Array.from([0, 0, 5000]);
  const ix = buildIndex(x, y, 3, 1000);
  assert.equal(nearest(ix, 90, 5, 50), 1);
  assert.equal(nearest(ix, 2500, 2500, 50), -1);
  assert.equal(nearest(ix, 90, 5, 50, (i) => i !== 1), -1);
});

test("A/B 짝짓기: 거리 안은 1:1 공통, 나머지는 A 에만 · B 에만", () => {
  const A = { n: 3, x: [0, 1000, 2000], y: [0, 0, 0] }, B = { n: 3, x: [5, 1003, 9000], y: [0, 2, 0] };
  const m = matchDefects(A, B, 10);
  assert.equal(m.common, 2);
  assert.deepEqual([...m.sa], [0, 0, 1]);
  assert.deepEqual([...m.sb], [0, 0, 2]);
});

test("합성 로트: 다이 반복 3곳 · 웨이퍼 반복 위치를 찾는다", () => {
  const r = parseText(write18(makeLot({ seed: 8, n: 8000, wafers: 3 })));
  const W = r.wafers[0];
  const reps = dieRepeaters(W.xr, W.yr, W.xi, W.yi, W.n, { tol: 15, minDies: 20 });
  const pos = reps.slice(0, 3).map((x) => [Math.round(x.xr / 100), Math.round(x.yr / 100)]).sort();
  assert.deepEqual(pos, [[21, 53], [50, 69], [74, 12]]); // 생성기의 반복 자리 (µm/100)
  const wr = waferRepeaters(r.wafers, { tol: 100, minWafers: 3 });
  assert.ok(wr.length >= 4, `wafer repeaters ${wr.length}`);
  assert.ok(dieCounts(W.xi, W.yi, W.n).get(`${W.xi[0]},${W.yi[0]}`) > 0);
});
