import { Database } from "bun:sqlite";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { appHome, compiled, config, MARKER } from "../config";
import { ensureServer, runningPort, stopServer } from "./server";
import { version } from "./version";

const REPO = process.env.JUDGINEER_REPO || "jphacks/tka_2607";
// install.sh と同じく、最新から数えて、この件数までさかのぼってバイナリを探す
const MAX_RELEASES = 5;
const KEEP_BACKUPS = 5;

type Asset = { name: string; browser_download_url: string };
export type Release = {
  tag_name: string;
  draft?: boolean;
  prerelease?: boolean;
  assets: Asset[];
};

/** release.yml のビルド対象の名前 (linux-x64 など) */
export function platformTarget(): string {
  const os = { darwin: "darwin", linux: "linux", win32: "windows" }[
    process.platform as string
  ];
  let arch = process.arch === "arm64" ? "arm64" : "x64";
  // Rosetta 下では x64 を名乗るので、実機が Apple Silicon なら arm64 を選ぶ (install.sh と同じ)
  if (
    os === "darwin" &&
    arch === "x64" &&
    spawnSync("sysctl", ["-n", "hw.optional.arm64"])
      .stdout?.toString()
      .trim() === "1"
  )
    arch = "arm64";
  if (!os) throw new Error(`未対応の OS です: ${process.platform}`);
  return `${os}-${arch}`;
}

const assetName = (target: string) =>
  `judgineer-${target}${target.startsWith("windows") ? ".exe" : ""}`;

/** v1.2.3 → [1,2,3]。数字が読み取れなければ null */
function parts(v: string): number[] | null {
  const m = /(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(v);
  return m ? [m[1], m[2] ?? "0", m[3] ?? "0"].map(Number) : null;
}

/** a が b より新しければ正、古ければ負、同じなら 0。比べられなければ null */
export function compareVersions(a: string, b: string): number | null {
  const x = parts(a);
  const y = parts(b);
  if (!x || !y) return null;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

/**
 * 新しい順の一覧から、この環境向けのバイナリと SHA256SUMS がそろった最初のリリースを選ぶ。
 * ビルド中のリリースは添付が途中なので、飛ばして前のものを見る。下書きとプレリリースは使わない。
 * SHA256SUMS が無いリリースは、検証できないので使わない
 */
export function pickRelease(releases: Release[], target: string) {
  for (const r of releases.slice(0, MAX_RELEASES)) {
    if (r.draft || r.prerelease) continue;
    const bin = r.assets.find((a) => a.name === assetName(target));
    const sums = r.assets.find((a) => a.name === "SHA256SUMS");
    if (bin && sums) {
      return {
        tag: r.tag_name,
        url: bin.browser_download_url,
        sumsUrl: sums.browser_download_url,
      };
    }
  }
  return null;
}

async function get(url: string): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
  };
  // 回数制限 (未認証は 1 時間 60 回) に当たるときだけ使う。API 以外には送らない
  if (process.env.GITHUB_TOKEN && url.startsWith("https://api.github.com/"))
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`取得できません (${res.status}): ${url}`);
  return res;
}

const sha256 = (bytes: Uint8Array) =>
  new Bun.CryptoHasher("sha256").update(bytes).digest("hex");

/** VACUUM INTO で、稼働中でも一貫したコピーを作る。DB が無ければ null */
function backupDb(oldVersion: string): string | null {
  const db = config.databaseUrl;
  if (db === ":memory:" || !existsSync(db)) return null;
  const dir = join(dirname(db), "backups");
  mkdirSync(dir, { recursive: true });
  // ミリ秒まで入れて、同じ秒に 2 回実行しても衝突しないようにする
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 17);
  const out = join(
    dir,
    `app-${oldVersion.replace(/[^\w.-]/g, "_")}-${stamp}.db`,
  );
  // bun:sqlite はこの場で読む (ここまでは db を開かない)
  const conn = new Database(db, { readonly: true });
  try {
    conn.exec(`VACUUM INTO '${out.replaceAll("'", "''")}'`);
  } finally {
    conn.close();
  }
  // 古い順は名前 (バージョンの文字列順) ではなく更新時刻で決める
  for (const old of readdirSync(dir)
    .filter((f) => f.endsWith(".db"))
    .map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => a.t - b.t)
    .slice(0, -KEEP_BACKUPS))
    rmSync(join(dir, old.f), { force: true });
  return out;
}

/** 更新後のバイナリで migrate が通るかを、DB のコピーで先に確かめる (本物の DB は触らない) */
function checkMigration(bin: string, backup: string | null): void {
  const scratch = join(dirname(bin), `.migrate-check-${process.pid}.db`);
  if (backup) copyFileSync(backup, scratch);
  const r = spawnSync(bin, ["migrate"], {
    env: { ...process.env, DATABASE_URL: scratch },
    encoding: "utf8",
  });
  for (const f of [scratch, `${scratch}-wal`, `${scratch}-shm`])
    rmSync(f, { force: true });
  if (r.status !== 0)
    throw new Error(
      `新しい版のデータベース更新に失敗しました: ${(r.stderr || r.stdout).trim()}`,
    );
}

/** 消せなくても続ける。force は「無い」場合しか無視せず、Windows の動作中ファイルは EPERM / EBUSY で投げる */
function tryRm(path: string): void {
  try {
    rmSync(path, { force: true });
  } catch {}
}

/** 前回の更新で残った古い実行ファイルを片付ける (Windows は動作中に消せないため、次の実行で消す) */
export function cleanupOldBinary(): void {
  if (compiled) tryRm(`${process.execPath}.old`);
}

export async function update(args: string[]): Promise<void> {
  let checkOnly = false;
  for (const a of args) {
    if (a === "--check") checkOnly = true;
    else throw new Error(`不明なオプション: ${a}`);
  }
  if (!compiled || !existsSync(MARKER))
    throw new Error(
      `インストール版の judgineer ではないため、更新できません (${appHome})`,
    );

  const target = platformTarget();
  const url =
    process.env.JUDGINEER_RELEASES_URL ||
    `https://api.github.com/repos/${REPO}/releases?per_page=${MAX_RELEASES}`;
  const rel = pickRelease((await (await get(url)).json()) as Release[], target);
  if (!rel)
    throw new Error(
      `最新 ${MAX_RELEASES} 件のリリースに ${target} 向けのバイナリと SHA256SUMS がそろったリリースがありません (ビルド中の可能性があります。しばらくしてからやり直してください)`,
    );

  const cmp = compareVersions(rel.tag, version);
  // 最新がビルド中で前のリリースが選ばれたときに、古い版へ戻してしまわない (DB は新しい版のまま戻せない)
  if (rel.tag === version || (cmp !== null && cmp <= 0)) {
    console.log(`最新の版です (${version})`);
    return;
  }
  console.log(`新しい版があります: ${version} → ${rel.tag}`);
  if (checkOnly) return;

  const bin = process.execPath;
  const staged = `${bin}.new`;
  try {
    console.log("ダウンロードしています");
    const bytes = new Uint8Array(await (await get(rel.url)).arrayBuffer());
    if (bytes.length < 10_000_000)
      throw new Error("ダウンロードしたファイルが小さすぎます");
    const line = (await (await get(rel.sumsUrl)).text())
      .split("\n")
      .map((l) => l.trim().split(/\s+/))
      .find(([, n]) => n?.replace(/^\*/, "") === assetName(target));
    if (!line || line[0] !== sha256(bytes))
      throw new Error("チェックサムが一致しません");
    writeFileSync(staged, bytes);
    chmodSync(staged, 0o755);
    // 動くことを確かめる。--define した版が、リリースのタグと一致するはず
    const v = spawnSync(staged, ["version"], { encoding: "utf8" });
    if (v.status !== 0)
      throw new Error("ダウンロードしたバイナリを実行できません");
    if (v.stdout.trim() !== rel.tag)
      throw new Error(
        `バージョンが合いません (${v.stdout.trim()} / ${rel.tag})`,
      );

    const wasRunning = (await runningPort()) !== null;
    await stopServer(); // 動いたまま入れ替えない (DB に触っているため)
    let backup: string | null = null;
    try {
      backup = backupDb(version);
      if (backup) console.log(`データベースをバックアップしました: ${backup}`);
      checkMigration(staged, backup);
    } catch (e) {
      if (wasRunning) await ensureServer().catch(() => {}); // 失敗したら元の状態に戻す
      throw e;
    }

    // 動作中の実行ファイルも名前の変更はできる (Windows でも)
    const old = `${bin}.old`;
    tryRm(old);
    renameSync(bin, old);
    try {
      renameSync(staged, bin);
    } catch (e) {
      renameSync(old, bin);
      throw e;
    }
    tryRm(old); // Windows では動作中なので消せない。次の実行で消す
    writeFileSync(join(appHome, "version"), `${rel.tag}\n`);
    console.log(`更新しました: ${rel.tag}`);
    console.log("データベースは、次の起動時に自動で新しい版へ更新されます");
    if (wasRunning) {
      // 新しい版で起動し直す (この処理は古い版なので、新しい実行ファイルを呼ぶ)
      Bun.spawnSync([bin, "start"], { stdout: "inherit", stderr: "inherit" });
    }
  } finally {
    rmSync(staged, { force: true });
  }
}
