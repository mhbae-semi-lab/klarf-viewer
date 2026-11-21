// 예시 전부: 생성 → 파싱 → 검증 결과 한 줄씩 (개발용)
import { SAMPLES } from "../src/gen.js";
import { parseText } from "../src/klarf.js";
import { checkWafer } from "../src/check.js";
for (const s of SAMPLES) {
  if (s.big) continue;
  const t0 = performance.now(), txt = s.make(), t1 = performance.now(), r = parseText(txt, s.key), t2 = performance.now();
  const ws = r.wafers.map((w) => { const c = checkWafer(w); return `${w.id}:n=${w.n} err=[${c.errors}] ${c.findings.map((f) => f.code + (f.axis != null ? f.axis : "")).join(",")}`; });
  console.log(s.key, s.ver, r.version, "gen", (t1 - t0).toFixed(0), "parse", (t2 - t1).toFixed(0), "perr", r.nErrors, JSON.stringify(r.errors.slice(0, 4)), "warn", JSON.stringify(r.warnings.slice(0, 3)));
  console.log("   ", ws.join(" | "));
}
