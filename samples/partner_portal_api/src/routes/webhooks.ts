import { Router } from "express";
import { requestedWebhookUrls } from "../input";

export const webhooks = Router();

webhooks.post("/api/webhooks", async (req, res) => {
  const registration = { urls: requestedWebhookUrls(req) };
  registration.urls.forEach((url) => {
    void fetch(url);
  });
  res.sendStatus(202);
});
