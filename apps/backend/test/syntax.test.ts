import { expect, test } from "bun:test";
import { checkSyntax } from "../src/syntax";

const py = test.skipIf(!Bun.which("python3"));

test("ts の正常 / 異常", async () => {
  expect(await checkSyntax("a.ts", "const x: number = 1;")).toBeNull();
  const err = await checkSyntax("a.ts", "const = ;");
  expect(err).toBeString();
  expect(err?.length).toBeLessThanOrEqual(200);
  expect(err).not.toContain("\n");
});

py("py の正常 / 異常", async () => {
  expect(await checkSyntax("a.py", "def f():\n    return 1\n")).toBeNull();
  expect(await checkSyntax("a.py", "def (:\n")).toContain("SyntaxError");
});

test("未知の拡張子は検査しない", async () => {
  expect(await checkSyntax("a.txt", "def (:")).toBeNull();
});
