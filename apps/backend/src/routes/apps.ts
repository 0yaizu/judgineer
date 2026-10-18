import { Hono } from "hono";
import { HttpError } from "../http";
import * as repo from "../repo";

export default new Hono()
  .get("/", (c) => c.json(repo.listApps()))
  .get("/:id", (c) => {
    const app = repo.getApp(c.req.param("id"));
    if (!app) throw new HttpError(404, "アプリが見つかりません");
    return c.json(app);
  });
