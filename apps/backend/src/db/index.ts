import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "./schema";

const url = process.env.DATABASE_URL ?? "./data/app.db";
mkdirSync(dirname(url), { recursive: true });

export const db = drizzle(new Database(url, { create: true }), { schema });
