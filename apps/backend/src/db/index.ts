import { Database } from "bun:sqlite";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { embeddedAssets } from "../assets";
import { config } from "../config";
import * as schema from "./schema";

const url = config.databaseUrl;
if (url !== ":memory:") mkdirSync(dirname(url), { recursive: true });

const sqlite = new Database(url, { create: true });
// judgineer のコマンドとサーバーが同じ DB を開くので、書き込みの待ち合わせと読み書きの並行を許す
sqlite.exec("PRAGMA busy_timeout = 5000");
if (url !== ":memory:") sqlite.exec("PRAGMA journal_mode = WAL");

export const db = drizzle(sqlite, { schema });

// 起動のたびに未適用のマイグレーションを流す。
// マイグレーションはディスク上のフォルダを読むので、単体バイナリでは埋め込みから一時フォルダへ書き出して使う
const assets = await embeddedAssets();
if (assets) {
  const tmp = mkdtempSync(join(tmpdir(), "judgineer-migrations-"));
  try {
    for (const [path, blob] of assets) {
      if (!path.startsWith("drizzle/")) continue;
      const out = join(tmp, path);
      await mkdir(dirname(out), { recursive: true });
      await writeFile(out, new Uint8Array(await blob.arrayBuffer()));
    }
    migrate(db, { migrationsFolder: join(tmp, "drizzle") });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
} else {
  // apps/backend/drizzle
  migrate(db, { migrationsFolder: resolve(import.meta.dir, "../../drizzle") });
}
