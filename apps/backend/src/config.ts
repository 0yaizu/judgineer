import { homedir } from "node:os";
import { basename, resolve } from "node:path";

// apps/backend/src から3つ上がリポジトリルート
export const REPO_ROOT = resolve(import.meta.dir, "../../..");

/** bun build --compile した judgineer 本体として動いているか (bun で動かす開発時は false) */
export const compiled = !/^bun(-debug)?(\.exe)?$/i.test(
  basename(process.execPath),
);

const env = process.env;
/** インストール先。本体・データ・サーバーの状態 (run/) を置く */
export const appHome = resolve(
  env.JUDGINEER_HOME || resolve(homedir(), ".judgineer"),
);
/** install.sh が置く目印。これが無いところは update / uninstall が触らない */
export const MARKER = resolve(appHome, ".judgineer-install");
const dataDir = resolve(
  env.DATA_DIR ||
    (compiled ? resolve(appHome, "data") : resolve(REPO_ROOT, "data")),
);

export const config = {
  port: Number(env.PORT ?? 3001),
  // ":memory:" も使える (テスト用)
  databaseUrl: env.DATABASE_URL ?? resolve(dataDir, "app.db"),
  /**
   * 起動時に検査対象の一覧へ足すフォルダ (開発用)。TARGET_DIR があればそれ。
   * 無ければ、開発時だけデモ用のサンプルを足す。インストール版は judgineer load で足す
   */
  seedTargetDir:
    env.TARGET_DIR ||
    (compiled ? null : resolve(REPO_ROOT, "samples/a_company_api")),
  dataDir,
  claudeBin: env.CLAUDE_BIN ?? "claude",
  claudeModel: env.CLAUDE_MODEL ?? "sonnet",
  aiTimeoutSec: Number(env.AI_TIMEOUT ?? 600),
};
