import { homedir } from "node:os";
import { resolve } from "node:path";

// apps/backend/src から3つ上がリポジトリルート
export const REPO_ROOT = resolve(import.meta.dir, "../../..");

const env = process.env;
const dataDir = resolve(env.DATA_DIR ?? resolve(REPO_ROOT, "data"));
// 検査対象は必ず明示させる。ホームや / を丸ごとコピーしないよう拒否する
if (!env.TARGET_DIR) {
  throw new Error(
    "TARGET_DIR が未設定です（例: TARGET_DIR=./samples/a_company_api）",
  );
}
const targetDir = resolve(env.TARGET_DIR);
if (targetDir === homedir() || targetDir === resolve("/")) {
  throw new Error(`TARGET_DIR に ${targetDir} は指定できません`);
}

export const config = {
  port: Number(env.PORT ?? 3001),
  // ":memory:" も使える (テスト用)
  databaseUrl: env.DATABASE_URL ?? resolve(dataDir, "app.db"),
  targetDir,
  dataDir,
  claudeBin: env.CLAUDE_BIN ?? "claude",
  claudeModel: env.CLAUDE_MODEL ?? "sonnet",
  aiTimeoutSec: Number(env.AI_TIMEOUT ?? 600),
};
