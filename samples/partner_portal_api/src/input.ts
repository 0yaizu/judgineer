import type { Request } from "express";

export function requestedPath(req: Request) {
  return req.query.path;
}

export function requestedReturnTo(req: Request) {
  return req.query.returnTo;
}

export function requestedWebhookUrls(req: Request) {
  return req.body.urls;
}
