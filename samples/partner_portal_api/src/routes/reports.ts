import { Router } from "express";
import { db } from "../storage";

export const reports = Router();

reports.get("/api/reports/:projectId", async (req, res) => {
  const projectId = req.params.projectId;
  const rows = await db.query(
    `SELECT project_id, filename, downloaded_at FROM downloads WHERE project_id = '${projectId}'`,
  );
  res.json(rows);
});
