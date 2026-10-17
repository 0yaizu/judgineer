// Starwind のコンポーネントは CLI が src/components/starwind にコピーする生成物（git 管理外）。
// bun install のあとに、starwind.config.json に載っているものが足りなければ CLI で取り直す。
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CONFIG = `${ROOT}starwind.config.json`;
const DIR = `${ROOT}src/components/starwind`;

const original = readFileSync(CONFIG, "utf8");
const names = JSON.parse(original).components.map((c) => c.name);

// 途中で止まったときの取り残しを避けるため、中身（index.ts）まで見る
if (names.every((n) => existsSync(`${DIR}/${n}/index.ts`))) process.exit(0);

const restore = () => writeFileSync(CONFIG, original);
// kill や Ctrl-C では finally が走らないので、シグナルでも設定を戻す
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    restore();
    process.exit(1);
  });
}

// CLI は設定に「インストール済み」とあるものを飛ばすので、一時的に空にして実行する
try {
  writeFileSync(
    CONFIG,
    JSON.stringify({ ...JSON.parse(original), components: [] }, null, 2),
  );
  const r = spawnSync("bunx", ["--bun", "starwind", "add", ...names, "--yes"], {
    cwd: ROOT,
    stdio: "inherit",
  });
  if (r.error)
    console.error(`starwind の実行に失敗しました: ${r.error.message}`);
  // process.exit だと finally が走らず設定が戻らないので、終了コードだけ立てる
  if (r.error || r.status !== 0) process.exitCode = r.status ?? 1;
} finally {
  restore();
}
