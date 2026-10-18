import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";
import { HttpError } from "../http";
import * as repo from "../repo";
import { isDir } from "../targets";
import type { Target } from "../types";

// 検査対象に background.json があれば、登録フォームの下書きに使う
function readBackground(dir: string): unknown {
  try {
    return JSON.parse(readFileSync(join(dir, "background.json"), "utf8"));
  } catch {
    return null;
  }
}

const payload = (t: Target) => ({
  ...t,
  exists: isDir(t.path),
  background: readBackground(t.path),
});

// 一覧への追加は judgineer load が行う。ここでは見るのと、一覧から外すのだけ
export default new Hono()
  .get("/", (c) => c.json(repo.listTargets().map(payload)))
  .delete("/:id", (c) => {
    if (!repo.removeTarget(c.req.param("id")))
      throw new HttpError(404, "フォルダが見つかりません");
    return c.json({ ok: true });
  });
