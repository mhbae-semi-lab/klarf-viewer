import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { STR } from "../src/i18n.js";
import { SAMPLES } from "../src/gen.js";
import { CODES } from "../src/check.js";

const src = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

test("한/영 문자열 키가 같다", () => {
  assert.deepEqual(Object.keys(STR.en).sort(), Object.keys(STR.ko).sort());
});

test("화면 코드 · HTML 이 쓰는 키는 모두 있다", () => {
  const used = new Set();
  for (const m of src("../src/app.js").matchAll(/\bt\("([A-Za-z_]+)"(?!\s*\+)/g)) used.add(m[1]);
  for (const m of src("../index.html").matchAll(/data-i18n(?:-html)?="([A-Za-z]+)"/g)) used.add(m[1]);
  for (const m of src("../index.html").matchAll(/data-i18n-attr="([^"]+)"/g)) for (const p of m[1].split(";")) used.add(p.split(":")[1]);
  for (const s of SAMPLES) used.add("s_" + s.key);
  for (const c of CODES) { used.add("t_" + c); used.add("chk_" + c); }
  for (const c of ["outsideExplained", "periodSkip", "periodWeak", "scribeSkip", "scribeWeak", "classUnknown", "summary", "noPlan", "geometry"]) used.add("chk_" + c);
  for (const r of ["cols", "num", "nospec", "needcol", "unterminated", "unknown", "brace", "count", "nowafer", "nopitch", "notKlarf", "noWafer"]) used.add("r_" + r);
  for (const w of ["specCount", "noCenter", "dieOrigin", "noSize"]) used.add("w_" + w);
  for (const k of ["pitchTol", "pitchMinZ", "scribeTol", "originTol", "edgeTol", "relTol", "indexMin", "minDefects"]) used.add("rl_" + k);
  const missing = [...used].filter((k) => !(k in STR.ko));
  assert.deepEqual(missing, []);
});
