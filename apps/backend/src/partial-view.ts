import {
  type Architecture,
  archEdgeSchema,
  archNodeSchema,
  type Signal,
  severitySchema,
  signalSchema,
} from "@tka/shared";
import { z } from "zod";

const items = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const field = (v: unknown, k: string): unknown =>
  v && typeof v === "object" ? (v as Record<string, unknown>)[k] : undefined;
const keep = <T extends z.ZodType>(schema: T, v: unknown): z.infer<T>[] =>
  items(v).flatMap((x) => {
    const r = schema.safeParse(x);
    return r.success ? [r.data] : [];
  });

/** 途中の AI 出力から、完結している node と、両端が既出の edge だけを取り出す */
export function partialArchitecture(raw: unknown): Architecture | undefined {
  const a = field(raw, "architecture");
  if (!a) return undefined;
  const nodes = keep(archNodeSchema, field(a, "nodes"));
  const ids = new Set(nodes.map((n) => n.id));
  const edges = keep(archEdgeSchema, field(a, "edges")).filter(
    (e) => ids.has(e.from) && ids.has(e.to),
  );
  return { nodes, edges };
}

const outlineSchema = z.object({
  day: z.number(),
  title: z.string(),
  severity: severitySchema,
  incident_title: z.string(),
});

/** 途中の issues から、day・title・severity・incident_title が揃ったものだけ */
export function partialIssues(raw: unknown) {
  return keep(outlineSchema, field(raw, "issues"));
}

/** 本文づくりの途中: 読めている incident_story と、揃った signals */
export function partialDetail(raw: unknown): {
  incident_story?: string;
  signals: Signal[];
} {
  const story = field(raw, "incident_story");
  return {
    ...(typeof story === "string" ? { incident_story: story } : {}),
    signals: keep(signalSchema, field(raw, "signals")),
  };
}
