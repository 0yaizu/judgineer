import { Router } from "express";
import { members } from "../storage";

export const memberRoutes = Router();

memberRoutes.patch("/api/members/me", async (req, res) => {
  const account = await members.find(res.locals.memberId);
  Object.assign(account, req.body);
  await members.save(account);
  res.json(account);
});
