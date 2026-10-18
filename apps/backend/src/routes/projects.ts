import { readFileSync } from "node:fs";
import { type Background, backgroundSchema, SIM_DAYS } from "@tka/shared";
import { Hono } from "hono";
import { z } from "zod";
import { analyze } from "../analyze";
import { settled } from "../clean";
import { HttpError, readBody } from "../http";
import { getProgress } from "../progress";
import {
  createProject,
  currentDir,
  inside,
  isFile,
  loadProject,
  projectPayload,
  srcDir,
} from "../project";
import * as repo from "../repo";
import { isDir } from "../targets";

const BG_KEYS = Object.keys(backgroundSchema.shape) as (keyof Background)[];

export default new Hono()
  .get("/", (c) => c.json(repo.listProjects()))
  .post("/", async (c) => {
    const { target_id, background } = await readBody(
      c,
      z.object({
        target_id: z.string(),
        background: z.record(z.string(), z.unknown()),
      }),
    );
    const target = repo.getTarget(target_id);
    if (!target) throw new HttpError(404, "検査するフォルダが見つかりません");
    const bg = Object.fromEntries(
      BG_KEYS.map((k) => {
        const v = background[k];
        return [k, typeof v === "string" ? v.trim() : ""];
      }),
    ) as Background;
    if (!bg.title) throw new HttpError(400, "アプリ名を入力してください");
    if (!isDir(target.path))
      throw new HttpError(
        400,
        `検査対象のフォルダが見つかりません: ${target.path}`,
      );

    const project = createProject(bg, target.path);
    // 登録したアプリとして、フォルダと同じ行に背景を残す
    repo.saveApp(bg, target.id);
    return c.json(project);
  })
  .get("/:pid", (c) => c.json(projectPayload(loadProject(c.req.param("pid")))))
  .get("/:pid/progress", (c) => {
    loadProject(c.req.param("pid"));
    return c.json(getProgress(c.req.param("pid")));
  })
  .post("/:pid/analyze", async (c) => c.json(await analyze(c.req.param("pid"))))
  // 未対応の出来事より先には進めない
  .post("/:pid/sim", async (c) => {
    const p = loadProject(c.req.param("pid"));
    const { day } = await readBody(c, z.object({ day: z.number() }));
    const open = [...p.issues]
      .sort((a, b) => a.day - b.day)
      .find((i) => !settled(i));
    const limit = open ? Math.min(SIM_DAYS, open.day) : SIM_DAYS;
    p.sim_day = Math.max(0, Math.min(Math.trunc(day), limit));
    repo.saveProject(p);
    return c.json({ sim_day: p.sim_day, limit });
  })
  // original: 登録時のコード / current: 修正を反映した今のコード
  .get("/:pid/file", (c) => {
    const pid = c.req.param("pid");
    loadProject(pid);
    const path = c.req.query("path") ?? "";
    const root =
      c.req.query("version") === "current" ? currentDir(pid) : srcDir(pid);
    const file = inside(root, path);
    if (!file || !isFile(file))
      throw new HttpError(404, "ファイルが見つかりません");
    return c.json({ path, content: readFileSync(file, "utf8") });
  });
