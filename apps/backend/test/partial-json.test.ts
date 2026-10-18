import { expect, test } from "bun:test";
import { parsePartialJson as p } from "../src/partial-json";

test("完結した JSON はそのまま読める", () => {
  expect(p('{"a":[1,"x",null,true],"b":{"c":2}}')).toEqual({
    a: [1, "x", null, true],
    b: { c: 2 },
  });
});

test("文字列の途中は、そこまでの内容で閉じる", () => {
  expect(p('{"a":"あい')).toEqual({ a: "あい" });
});

test("エスケープの途中は末尾を捨てる", () => {
  expect(p('{"a":"x\\')).toEqual({ a: "x" });
  expect(p('{"a":"x\\u00')).toEqual({ a: "x" });
  expect(p('{"a":"x\\n')).toEqual({ a: "x\n" });
  expect(p('{"a":"x\\u3042')).toEqual({ a: "xあ" });
});

test("キーだけ・コロンだけ・カンマで終わるものは捨てる", () => {
  expect(p('{"a":1,"b"')).toEqual({ a: 1 });
  expect(p('{"a":1,"b":')).toEqual({ a: 1 });
  expect(p('{"a":"x",')).toEqual({ a: "x" });
  expect(p('{"a":1,"b')).toEqual({ a: 1 });
});

test("途中の数値・真偽値・null は捨てる", () => {
  expect(p('{"a":12')).toEqual({});
  expect(p('{"a":1,"b":tr')).toEqual({ a: 1 });
  expect(p("[1,2")).toEqual([1]);
  expect(p("[1,2,")).toEqual([1, 2]);
});

test("配列の途中・入れ子", () => {
  expect(p('{"xs":[{"id":"a","n":1},{"id":"b')).toEqual({
    xs: [{ id: "a", n: 1 }, { id: "b" }],
  });
  expect(p('{"a":{"b":[')).toEqual({ a: { b: [] } });
});

test("空文字・読めないものは undefined", () => {
  expect(p("")).toBeUndefined();
  expect(p("  ")).toBeUndefined();
  expect(p("12")).toBeUndefined();
  expect(p("{")).toEqual({});
});
