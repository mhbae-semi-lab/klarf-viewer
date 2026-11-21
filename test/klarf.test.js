import { test } from "node:test";
import assert from "node:assert/strict";
import { parseText, createParser, num } from "../src/klarf.js";
import { makeLot, write12, write18, brokenText } from "../src/gen.js";

const close = (a, b, tol = 1e-3) => Math.abs(a - b) <= tol;

test("숫자 읽기: 소수 · 지수 · 부호 · NA", () => {
  const cases = ["1234.5678", "-0.25", "1.0000000000e+04", "7.5e-03", "+12", "0", "123456789012345678", "NA", "12O4.5"];
  for (const s of cases) {
    const v = num(s, 0, s.length), w = Number(s);
    if (Number.isNaN(w)) assert.ok(Number.isNaN(v), s); else assert.equal(v, w, s);
  }
});

test("1.2 · 1.8 로 쓴 같은 로트를 읽으면 값이 같다", () => {
  const L = makeLot({ seed: 3, n: 3000, wafers: 2 });
  for (const text of [write12(L), write18(L)]) {
    const r = parseText(text);
    assert.equal(r.nErrors, 0, JSON.stringify(r.errors.slice(0, 3)));
    assert.equal(r.wafers.length, 2);
    r.wafers.forEach((W, k) => {
      const src = L.wafers[k];
      assert.equal(W.n, src.d.n);
      assert.equal(W.id, src.id);
      assert.ok(close(W.pitch[0], src.pitch[0]) && close(W.pitch[1], src.pitch[1]));
      assert.equal(W.plan.length, src.plan.length);
      for (const i of [0, 1, 999, W.n - 1]) {
        assert.equal(W.xi[i], src.d.xi[i]); assert.equal(W.yi[i], src.d.yi[i]);
        assert.ok(close(W.xr[i], src.d.xr[i], 2e-3), `xr ${i}`); assert.ok(close(W.yr[i], src.d.yr[i], 2e-3));
        assert.equal(W.cls[i], src.d.cls[i]);
        // 웨이퍼 좌표 = XINDEX·pitch + XREL − SampleCenterLocation
        assert.ok(close(W.x[i], W.xi[i] * W.pitch[0] + W.xr[i] - W.center[0]));
      }
      assert.equal(W.classes.get(4), "PATTERN");
      assert.equal(W.summary.ndefect, W.n);
    });
    assert.equal(r.lot.diameter, 300);
    assert.equal(r.lot.notch, "DOWN");
  }
});

test("1.8 은 nm → µm, 단위는 SampleSize 로 판단", () => {
  const r = parseText(write18(makeLot({ seed: 4, n: 500 })));
  assert.equal(r.version, "1.8");
  assert.equal(r.lot.unit, "nm");
  assert.ok(close(r.wafers[0].pitch[0], 9600));
  assert.ok(r.wafers[0].areaPerTest > 1e10 && r.wafers[0].areaPerTest < 1e12); // µm²
});

test("깨진 파일: 줄 번호와 사유를 남기고 나머지는 읽는다", () => {
  const r = parseText(brokenText());
  assert.deepEqual(r.errors.map((e) => e.reason), ["cols", "num", "cols"]);
  assert.ok(r.errors.every((e) => e.line > 0 && e.text));
  assert.equal(r.wafers[0].n, 2998);
});

const head12 = `FileVersion 1 2;
FileTimestamp 11-20-26 09:30:00;
LotID "L1";
SampleSize 1 200;
OrientationMarkLocation DOWN;
DiePitch 5.0e+03 4.0e+03;
DieOrigin 0.0 0.0;
WaferID "W1";
SampleCenterLocation 1.0e+05 1.0e+05;
ClassLookup 2
 0 "UNCLASSIFIED"
 1 "BIG PARTICLE";
SampleTestPlan 2
 20 25
 21 25;
`;

test("1.2: 줄을 넘는 행, IMAGELIST 이미지, TiffFileName 줄, NA", () => {
  const text = head12 + `DefectRecordSpec 7 DEFECTID XREL YREL XINDEX YINDEX CLASSNUMBER IMAGELIST;
DefectList
 1 100.5 200.25 20 25 1 2 1 0 2 0
 2 4999 3999 21
 25 0 0
TiffFileName img.tif;
 3 NA 10 21 25 0 0;
SummarySpec 2 TESTNO NDEFECT;
SummaryList
 1 3;
EndOfFile;
`;
  const r = parseText(text);
  const W = r.wafers[0];
  assert.equal(W.n, 2);
  assert.deepEqual([W.xr[0], W.yr[0], W.xi[0], W.yi[0], W.cls[0]], [100.5, 200.25, 20, 25, 1]);
  assert.deepEqual([W.xr[1], W.xi[1], W.yi[1]], [4999, 21, 25]);
  assert.equal(W.classes.get(1), "BIG PARTICLE");
  assert.deepEqual(r.errors.map((e) => e.reason), ["num"]);
  assert.equal(r.lot.diameter, 200);
  assert.ok(close(W.x[0], 20 * 5000 + 100.5 - 1e5));
});

test("1.2: 웨이퍼 여러 장, 키워드 대소문자", () => {
  const w = (id, rows) => `WaferID "${id}";\nSampleCenterLocation 1.0e+05 1.0e+05;\nDEFECTRECORDSPEC 5 DEFECTID XREL YREL XINDEX YINDEX;\nDefectList\n${rows};\n`;
  const r = parseText(head12.replace(/WaferID[\s\S]*$/, "") + w("A", " 1 1 1 20 25\n 2 2 2 21 25") + w("B", " 1 3 3 20 25") + "EndOfFile;\n");
  assert.deepEqual(r.wafers.map((W) => [W.id, W.n]), [["A", 2], ["B", 1]]);
});

test("1.8: 필드가 레코드 뒤에 와도, 목록 칸이 여러 줄이어도 읽는다", () => {
  const text = `Record FileRecord "1.8"
{
  Record LotRecord "L9"
  {
    Record WaferRecord "W9"
    {
      List DefectList
      {
        Columns 6 { int32 DEFECTID, int32 XREL, int32 YREL, int32 XINDEX, int32 YINDEX, ImageList IMAGEINFO }
        Data 2
        {
          1 1500000 2500000 3 4 Images 2 {"a.jpg" "JPG" 1 "Patch",
             "b.jpg" "JPG" 2 "Patch"};
          2 10 20 3 4 N;
        }
      }
      Field SampleCenterLocation 2 {50000000, 60000000}
    }
    Field DiePitch 2 {10000000, 8000000}
    Field SampleSize 2 {200000000, 0}
    Field OrientationMarkLocation 1 {90}
  }
}
EndOfFile;
`;
  const r = parseText(text);
  assert.equal(r.nErrors, 0, JSON.stringify(r.errors));
  const W = r.wafers[0];
  assert.equal(W.n, 2);
  assert.deepEqual([W.xr[0], W.yr[0], W.xi[0], W.yi[0]], [1500, 2500, 3, 4]);
  assert.deepEqual(W.pitch, [10000, 8000]);
  assert.deepEqual(W.center, [50000, 60000]);
  assert.equal(r.lot.notch, "LEFT");
  assert.equal(r.lot.diameter, 200);
});

test("KLARF 가 아니거나 필수 열이 없으면 오류로 알린다", () => {
  assert.equal(parseText("hello world\nfoo").errors[0].reason, "notKlarf");
  const r = parseText(head12 + "DefectRecordSpec 3 DEFECTID XREL YREL;\nDefectList\n 1 2 3;\nEndOfFile;\n");
  assert.equal(r.errors[0].reason, "needcol");
  const u = parseText(head12 + "DefectRecordSpec 4 XREL YREL XINDEX YINDEX;\nDefectList\n 1 2 20 25\nSummarySpec 1 NDEFECT;\nEndOfFile;\n");
  assert.equal(u.errors[0].reason, "unterminated");
  assert.equal(u.wafers[0].n, 1);
});

test("조각으로 나눠 넣어도 결과가 같다", () => {
  const text = write12(makeLot({ seed: 5, n: 2000 }));
  const whole = parseText(text).wafers[0];
  const p = createParser();
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i += 777) p.push(lines.slice(i, i + 777));
  const W = p.end().wafers[0];
  assert.equal(W.n, whole.n);
  assert.deepEqual([...W.x.slice(0, 50)], [...whole.x.slice(0, 50)]);
});
