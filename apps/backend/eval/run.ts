/**
 * 台本の精度を測る手動実行用の評価 (本物の claude を呼ぶ。bun test には入れない)。
 *
 *   bun run eval                       # 1回
 *   bun run eval -- --runs 3 --detail  # 3回くり返し、本文も作って採点
 * fail が1つでもあれば exit 1、AI のエラーは exit 2。
 */
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Background } from "@tka/shared";

// config は import 時に環境を読むので、先に固定してから動的 import する
const target = resolve(import.meta.dir, "../../../samples/a_company_api");
process.env.DATABASE_URL = ":memory:";
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "tka-eval-"));
process.env.TARGET_DIR = target;

const { AIError } = await import("../src/ai/client");
const { analyze } = await import("../src/analyze");
const { ensureDetail } = await import("../src/detail");
const { createProject } = await import("../src/project");
const repo = await import("../src/repo");
const { aCompanyApi } = await import("./golden");
const { score, summarize } = await import("./score");

const args = process.argv.slice(2);
const runs = Math.max(1, Number(args[args.indexOf("--runs") + 1]) || 1);
const withDetail = args.includes("--detail");
const bg = JSON.parse(
  readFileSync(join(target, "background.json"), "utf8"),
) as Background;

const tally = new Map<string, { ok: number; level: string }>();
let failed = 0;
const t0 = Date.now();

try {
  for (let r = 1; r <= runs; r++) {
    console.log(`--- run ${r}/${runs} ---`);
    const pid = createProject(bg).id;
    await analyze(pid);
    if (withDetail)
      for (const i of repo.getProject(pid)?.issues ?? [])
        await ensureDetail(pid, i.id);
    const project = repo.getProject(pid);
    if (!project) throw new Error("プロジェクトが読み出せません");
    const checks = score(project, aCompanyApi);
    for (const c of checks) {
      const mark = c.ok ? "✓" : c.level === "fail" ? "✗" : "!";
      console.log(`${mark}  ${c.name.padEnd(18)} ${c.detail}`);
      const t = tally.get(c.name) ?? { ok: 0, level: c.level };
      if (c.ok) t.ok++;
      tally.set(c.name, t);
    }
    const s = summarize(checks);
    failed += s.fail;
    console.log(`fail ${s.fail} / warn ${s.warn}`);
  }
} catch (e) {
  if (e instanceof AIError) {
    console.error(`AI エラー: ${e.message}`);
    process.exit(2);
  }
  throw e;
}

if (runs > 1) {
  console.log("--- 成功回数 ---");
  for (const [name, t] of tally)
    console.log(`${name.padEnd(18)} ${t.ok}/${runs} (${t.level})`);
}
const gaps = aCompanyApi.known_gaps ?? [];
if (gaps.length) {
  console.log(
    `--- 未対応の既知の欠陥 ${gaps.length}件 (スキャナが拾わないので採点外) ---`,
  );
  for (const g of gaps) console.log(`-  ${g.file}  ${g.title}`);
}
console.log(`${Math.round((Date.now() - t0) / 1000)} 秒`);
process.exit(failed > 0 ? 1 : 0);
