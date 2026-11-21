// 결함 N 개 합성 Klarf (1.2 · 1.8) 를 만들어 파싱 · 검증 시간을 잰다.  node tools/bench.mjs 1000000
import { makeLot, write12, write18 } from "../src/gen.js";
import { createParser } from "../src/klarf.js";
import { checkWafer } from "../src/check.js";
const N = Number(process.argv[2] || 1000000);
for (const [ver, write] of [["1.2", write12], ["1.8", write18]]) {
  let t = performance.now();
  const text = write(makeLot({ seed: 9, n: N }));
  const genMs = performance.now() - t;
  t = performance.now();
  // 브라우저 Worker 와 같게 8MB 조각으로 줄을 나눠 넣는다
  const p = createParser({ name: "bench" });
  const CH = 8 << 20; let rest = "";
  for (let off = 0; off < text.length; off += CH) {
    const s = rest + text.slice(off, off + CH), cut = s.lastIndexOf("\n");
    p.push(s.slice(0, cut).split("\n")); rest = s.slice(cut + 1);
  }
  if (rest) p.push([rest]);
  const r = p.end();
  const parseMs = performance.now() - t;
  t = performance.now();
  const c = checkWafer(r.wafers[0]);
  const checkMs = performance.now() - t;
  console.log(JSON.stringify({ ver, defects: r.wafers[0].n, mb: +(text.length / 1048576).toFixed(1), genMs: Math.round(genMs), parseMs: Math.round(parseMs), checkMs: Math.round(checkMs), errors: c.errors, parseErrors: r.nErrors }));
}
