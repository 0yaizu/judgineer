import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtraCandidate } from "@tka/shared";
import { verifyCandidates } from "../src/extra";
import type { Finding } from "../src/scanner";

let root = "";
const cand = (over: Partial<ExtraCandidate>): ExtraCandidate => ({
  title: "t",
  file: "a.py",
  line: 1,
  quote: "conn = sqlite3.connect(DB)",
  why: "w",
  ...over,
});
const existing = (file: string, line: number): Finding => ({
  id: "F1",
  rule: "r",
  title: "t",
  file,
  line,
  snippet: "",
});

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "tka-extra-"));
  mkdirSync(join(root, "sub"));
  writeFileSync(
    join(root, "a.py"),
    [
      "import sqlite3", // 1
      "", // 2
      "def f():", // 3
      "    conn = sqlite3.connect(DB)", // 4
      "    return conn", // 5
      "", // 6
      "def g():", // 7
      "    pass", // 8
      "    pass", // 9
      "    pass", // 10
      "    pass", // 11
      "    conn = sqlite3.connect(DB)", // 12
    ].join("\n"),
  );
  writeFileSync(join(root, "notes.txt"), "conn = sqlite3.connect(DB)\n");
  writeFileSync(join(root, "../tka-extra-outside.py"), "conn = outside_x()\n");
});
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(join(root, "../tka-extra-outside.py"), { force: true });
});

const verify = (cs: ExtraCandidate[], ex: Finding[] = [], first = 1) =>
  verifyCandidates(root, cs, ex, first);

test("実在する引用は採用され、line が実際の行に直る", () => {
  const [f] = verify([cand({ line: 5 })]);
  expect(f).toMatchObject({
    file: "a.py",
    line: 4,
    origin: "ai",
    rule: "ai-candidate",
    why: "w",
  });
  expect(f?.snippet).toContain("   4      conn = sqlite3.connect(DB)");
});

test("実在しない引用は捨てる", () => {
  expect(verify([cand({ quote: "conn.close_everything()" })])).toEqual([]);
});

test("行番号が3行ずれていても見つかる", () => {
  expect(verify([cand({ line: 7 })])[0]?.line).toBe(4);
});

test("既存の finding と同じ行は捨てる", () => {
  expect(verify([cand({ line: 4 })], [existing("a.py", 4)])).toEqual([]);
});

test("空白・インデントの違いは無視して一致する", () => {
  expect(verify([cand({ quote: "conn=sqlite3.connect( DB )" })])[0]?.line).toBe(
    4,
  );
});

test("root の外・存在しないファイル・コード以外は捨てる", () => {
  expect(
    verify([
      cand({ file: "../tka-extra-outside.py", quote: "conn = outside_x()" }),
      cand({ file: "nothing.py" }),
      cand({ file: "notes.txt" }),
      cand({ file: "sub" }),
      cand({ quote: "pass" }), // 短すぎる
      cand({ quote: "  " }),
    ]),
  ).toEqual([]);
});

test("最大8件、id は firstId から連番", () => {
  // 同じ行を指す候補は1件だけ
  expect(verify([cand({}), cand({ line: 3 })]).length).toBe(1);
  writeFileSync(
    join(root, "b.py"),
    Array.from({ length: 9 }, (_, i) => `value_${i} = compute_${i}()`).join(
      "\n",
    ),
  );
  const out = verify(
    Array.from({ length: 9 }, (_, i) =>
      cand({ file: "b.py", line: i + 1, quote: `value_${i} = compute_${i}()` }),
    ),
    [],
    5,
  );
  expect(out.length).toBe(8);
  expect(out.map((f) => f.id)).toEqual(
    Array.from({ length: 8 }, (_, i) => `F${5 + i}`),
  );
});

test("同じ引用が複数行にあるときは申告に最寄りの行", () => {
  expect(verify([cand({ line: 11 })])[0]?.line).toBe(12);
  expect(verify([cand({ line: 2 })])[0]?.line).toBe(4);
});
