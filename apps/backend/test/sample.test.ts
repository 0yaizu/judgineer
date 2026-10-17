import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { aCompanyApi } from "../eval/golden";
import { score } from "../eval/score";
import { readConfig, readSources, scan } from "../src/scanner";
import type { Project } from "../src/types";

const dir = resolve(import.meta.dir, "../../../samples/a_company_api");

test("サンプルの指摘が golden と1対1に対応する", () => {
  const findings = scan(dir);
  const checks = score(
    {
      findings,
      issues: [],
      dismissed: [],
      architecture: { nodes: [], edges: [] },
      flows: [],
      uncovered_features: [],
    } as unknown as Project,
    aCompanyApi,
  );
  expect(checks.find((c) => c.name === "findings_match")).toMatchObject({
    ok: true,
  });
  expect(findings).toHaveLength(aCompanyApi.findings.length);
});

test("スキャナが拾わない既知の欠陥(known_gaps)が、題材に実在する", () => {
  for (const g of aCompanyApi.known_gaps ?? [])
    expect(readFileSync(resolve(dir, g.file), "utf8")).toContain(g.match);
});

test("AI に渡る文面に、題材だと明かす言葉がない", () => {
  const text = readSources(dir, 60_000, scan(dir)) + readConfig(dir);
  for (const w of ["わざと", "サンプル", "デモ", "故意"])
    expect(text).not.toContain(w);
});
