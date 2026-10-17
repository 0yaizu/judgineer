import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { aCompanyApi } from "../eval/golden";
import { findingLine, readConfig, readSources, scan } from "../src/scanner";

const dir = resolve(import.meta.dir, "../../../samples/a_company_api");

test("サンプルの指摘が golden と1対1に対応する", () => {
  const findings = scan(dir);
  const used = new Set<string>();
  for (const g of aCompanyApi.findings) {
    const hit = findings.find(
      (f) =>
        !used.has(f.id) &&
        f.rule === g.rule &&
        (g.by === "title" ? f.title : findingLine(f)).includes(g.match),
    );
    expect(hit).toBeDefined();
    used.add((hit as { id: string }).id);
  }
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
