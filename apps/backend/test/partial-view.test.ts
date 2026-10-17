import { expect, test } from "bun:test";
import { partialArchitecture, partialDetail } from "../src/partial-view";

test("未完結の node と、既出でない端を持つ edge を捨てる", () => {
  const raw = {
    architecture: {
      nodes: [
        { id: "api", label: "API", kind: "internal" },
        { id: "db", label: "DB" },
        { id: "bad", label: "x", kind: "nope" },
        { id: "p", label: "B社", kind: "partner" },
      ],
      edges: [
        { from: "p", to: "api", label: "取得", direction: "one", kind: "ops" },
        { from: "api", to: "db", label: "検索", direction: "one", kind: "ops" },
        { from: "api", to: "p", label: "返す", direction: "both" },
      ],
    },
  };
  const a = partialArchitecture(raw);
  expect(a?.nodes.map((n) => n.id)).toEqual(["api", "p"]);
  expect(a?.edges.map((e) => e.label)).toEqual(["取得"]);
});

test("architecture が無ければ undefined", () => {
  expect(partialArchitecture(undefined)).toBeUndefined();
  expect(partialArchitecture({})).toBeUndefined();
});

test("detail は story と、揃った signals だけ", () => {
  const sig = { time: "06:00", source: "s", level: "warn" as const, text: "t" };
  expect(
    partialDetail({
      incident_story: "途",
      signals: [sig, { time: "06:01", source: "s" }],
    }),
  ).toEqual({ incident_story: "途", signals: [sig] });
  expect(partialDetail({})).toEqual({ signals: [] });
});
