import { test } from "node:test";
import assert from "node:assert/strict";
import { SAMPLES, makeLot, write12 } from "../src/gen.js";
import { parseText } from "../src/klarf.js";
import { checkWafer, applyFix, DEFAULT_RULES } from "../src/check.js";

const wafersOf = (key) => parseText(SAMPLES.find((s) => s.key === key).make()).wafers;

test("정상 예시(1.2 한 장 · 1.8 세 장)는 맵 오류 0", () => {
  for (const key of ["ok12", "ok18"]) for (const W of wafersOf(key)) assert.deepEqual(checkWafer(W).errors, [], `${key} ${W.id}`);
});

test("맵 오류 5종을 각각 그 오류 하나로 찾는다", () => {
  for (const key of ["pitch", "scribe", "origin", "outside", "index"]) {
    const W = wafersOf(key)[0];
    assert.deepEqual(checkWafer(W).errors, [key], key);
  }
});

test("원인 추정값이 넣은 오류와 맞다", () => {
  const f = (key) => checkWafer(wafersOf(key)[0]).findings.find((x) => x.code === key);
  const p = f("pitch"); assert.equal(p.axis, 0); assert.ok(Math.abs(p.v.measured - 9600) < 10, p.v.measured);
  const s = f("scribe"); assert.equal(s.axis, 0); assert.ok(Math.abs(s.v.offset + 2400) < 30, s.v.offset);
  assert.deepEqual(f("origin").v.shift, [1, -1]);
  assert.deepEqual(f("index").v.shift, [-1, 0]);
  assert.equal(f("outside").v.count, 50);
});

test("고쳐 보기: 원인을 추정한 4종은 다시 검증하면 오류 0, 웨이퍼 밖 결함은 남는다", () => {
  for (const key of ["pitch", "scribe", "origin", "index"]) {
    const W = wafersOf(key)[0], c = checkWafer(W);
    assert.deepEqual(checkWafer(applyFix(W, c)).errors, [], key);
  }
  const W = wafersOf("outside")[0];
  assert.deepEqual(checkWafer(applyFix(W, checkWafer(W))).errors, ["outside"]);
});

test("증상은 원인으로 설명되면 따로 세지 않는다 (원점 · 인덱스 → 웨이퍼 밖)", () => {
  for (const key of ["origin", "index"]) {
    const codes = checkWafer(wafersOf(key)[0]).findings.map((f) => f.code);
    assert.ok(codes.includes("outsideExplained") && !codes.includes("outside"), key);
  }
});

test("결함이 적으면 pitch · 스크라이브는 판정하지 않는다 (오검 대신 참고)", () => {
  const W = parseText(write12(makeLot({ seed: 12, n: 800 }))).wafers[0];
  const c = checkWafer(W);
  assert.deepEqual(c.errors, []);
  assert.ok(c.findings.some((f) => f.code === "periodSkip"));
});

test("규칙 허용값을 넓히면 해당 오류를 놓친다 (비교 탭의 근거)", () => {
  const W = wafersOf("pitch")[0];
  assert.deepEqual(checkWafer(W, { ...DEFAULT_RULES, pitchTol: 5 }).errors, []);
  const O = wafersOf("outside")[0];
  assert.deepEqual(checkWafer(O, { ...DEFAULT_RULES, edgeTol: 5000 }).errors, []);
});

test("다른 시드 정상 웨이퍼 20장에서 오검 0", () => {
  for (let seed = 100; seed < 120; seed++) {
    const W = parseText(write12(makeLot({ seed, n: 6000 }))).wafers[0];
    assert.deepEqual(checkWafer(W).errors, [], `seed ${seed}`);
  }
});
