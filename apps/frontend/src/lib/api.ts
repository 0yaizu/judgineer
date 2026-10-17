import type { AppType } from "@tka/backend/app";
import { hc } from "hono/client";

export const api = hc<AppType>("/").api;
