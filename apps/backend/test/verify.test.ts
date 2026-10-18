import { expect, test } from "bun:test";
import type { Finding } from "../src/scanner";
import { compareScans, verifyFix } from "../src/verify";

let n = 0;
const f = (line: number, text: string, rule = "r", file = "a.py"): Finding => ({
  id: `F${++n}`,
  rule,
  title: "t",
  file,
  line,
  snippet: `${String(line).padStart(4)}  ${text}`,
});

test("同じ行が残る (行番号がずれても) は remaining", () => {
  const o = f(5, "bad()");
  const r = compareScans([o], [f(9, "  bad()")]);
  expect(r.remaining).toEqual([o]);
  expect(r.resolved).toEqual([]);
  expect(r.introduced).toEqual([]);
});

test("行が書き換わってもルールに当たり続けるなら remaining", () => {
  const o = f(5, "bad()");
  const r = compareScans([o], [f(5, "bad(1)  # todo")]);
  expect(r.remaining).toEqual([o]);
  expect(r.introduced).toEqual([]);
});

test("消えたら resolved", () => {
  const o = f(5, "bad()");
  expect(compareScans([o], []).resolved).toEqual([o]);
});

test("別のファイルや別のルールには組まない", () => {
  const o = f(5, "bad()");
  const c = f(5, "bad()", "r", "b.py");
  const r = compareScans([o], [c]);
  expect(r.resolved).toEqual([o]);
  expect(r.introduced).toEqual([c]);
});

test("新しい行が増えたら introduced (current 側を返す)", () => {
  const o = f(5, "bad()");
  const c2 = f(20, "bad2()");
  const r = compareScans([o], [f(5, "bad()"), c2]);
  expect(r.remaining).toEqual([o]);
  expect(r.introduced).toEqual([c2]);
});

test("前の修正で増えたものは introduced に数えない", () => {
  const o = f(5, "bad()");
  const old = f(20, "bad2()");
  const fresh = f(30, "bad3()");
  const v = verifyFix(
    [o],
    [f(5, "bad()"), old],
    [f(5, "bad()"), f(21, "bad2()"), fresh],
  );
  expect(v.introduced).toEqual([fresh]);
  expect([...v.remainingIds]).toEqual([o.id]);
  expect(v.resolvedIds.size).toBe(0);
});
