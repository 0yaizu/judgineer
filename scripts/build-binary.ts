// judgineer の単体バイナリを作る。先に `bun run build` でフロントをビルドしておく。
//   bun scripts/build-binary.ts [--version v1.2.3] [target ...]   (target 省略時は全部)
// バイナリには assets.tar (public/ = フロント、drizzle/ = マイグレーション) を埋め込む。
// どちらも実行時にファイルとして読むもので、import で辿れないため、明示して入れないとバイナリに入らない
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const OUT = join(ROOT, "dist-bin");

export const TARGETS = [
  "linux-x64",
  "linux-arm64",
  "darwin-x64",
  "darwin-arm64",
  "windows-x64",
] as const;

const args = process.argv.slice(2);
const vi = args.indexOf("--version");
const version = vi >= 0 ? (args.splice(vi, 2)[1] ?? "dev") : "dev";
const targets = args.length ? args : [...TARGETS];
for (const t of targets) {
  if (!(TARGETS as readonly string[]).includes(t))
    throw new Error(`未対応のターゲット: ${t} (${TARGETS.join(", ")})`);
}

const client = join(ROOT, "apps/frontend/dist/client");
if (!existsSync(join(client, "_shell.html")))
  throw new Error(
    "フロントがビルドされていません。先に bun run build を実行してください",
  );

rmSync(OUT, { recursive: true, force: true });
const stage = join(OUT, "stage");
mkdirSync(stage, { recursive: true });
cpSync(client, join(stage, "public"), { recursive: true });
cpSync(join(ROOT, "apps/backend/drizzle"), join(stage, "drizzle"), {
  recursive: true,
});
const tar = Bun.spawnSync([
  "tar",
  "-cf",
  join(OUT, "assets.tar"),
  "-C",
  stage,
  ".",
]);
if (tar.exitCode !== 0) throw new Error(`tar に失敗しました: ${tar.stderr}`);

for (const t of targets) {
  const out = join(
    OUT,
    `judgineer-${t}${t.startsWith("windows") ? ".exe" : ""}`,
  );
  console.log(`build ${t}`);
  const r = Bun.spawnSync(
    [
      "bun",
      "build",
      "--compile",
      `--target=bun-${t}`,
      `--define=BUILD_VERSION=${JSON.stringify(version)}`,
      join(ROOT, "apps/backend/src/main.ts"),
      join(OUT, "assets.tar"),
      "--outfile",
      out,
    ],
    { stdout: "inherit", stderr: "inherit", cwd: ROOT },
  );
  if (r.exitCode !== 0) throw new Error(`${t} のビルドに失敗しました`);
}
rmSync(stage, { recursive: true, force: true });
