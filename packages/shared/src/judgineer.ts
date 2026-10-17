import { z } from "zod";

export const backgroundSchema = z.object({
  title: z.string(),
  stakeholders: z.string(),
  data_flow: z.string(),
  data_types: z.string(),
  constraints: z.string(),
  team: z.string(),
  notes: z.string(),
});
export type Background = z.infer<typeof backgroundSchema>;

export const findingSchema = z.object({
  id: z.string(),
  rule: z.string(),
  title: z.string(),
  file: z.string(),
  line: z.number().int().min(0),
});
export type Finding = z.infer<typeof findingSchema>;

export const optionSchema = z.object({
  label: z.string(),
  change_summary: z.string(),
  effects: z.object({
    security: z.string(),
    effort: z.string(),
    stakeholders: z.string(),
    operations: z.string(),
  }),
});
export type Option = z.infer<typeof optionSchema>;

export const severitySchema = z.enum(["高", "中", "低"]);
export type Severity = z.infer<typeof severitySchema>;

export const viewSchema = z.enum(["code", "infra"]);
export type View = z.infer<typeof viewSchema>;

export const signalSchema = z.object({
  time: z.string(),
  source: z.string(),
  level: z.enum(["info", "warn", "error"]),
  text: z.string(),
});
export type Signal = z.infer<typeof signalSchema>;

// サンプルの台本（ルールごとの問題文）
export const ruleTextSchema = z.object({
  title: z.string(),
  category: z.string(),
  severity: severitySchema,
  what_happens: z.string(),
  who: z.string(),
  options: z.array(optionSchema),
  unknowns: z.array(z.string()),
});
export type RuleText = z.infer<typeof ruleTextSchema>;

// サンプルの台本（ルールごとの出来事）
export const incidentTextSchema = z.object({
  day: z.number().int().min(0),
  incident_title: z.string(),
  incident_story: z.string(),
  signals: z.array(signalSchema),
  view: viewSchema,
  affected: z.array(z.string()),
});
export type IncidentText = z.infer<typeof incidentTextSchema>;

export const archNodeSchema = z.object({
  id: z.string(),
  label: z.string(),
  kind: z.enum(["internal", "db", "partner", "person", "external"]),
});
export type ArchNode = z.infer<typeof archNodeSchema>;

export const archEdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  label: z.string(),
});
export type ArchEdge = z.infer<typeof archEdgeSchema>;

export const architectureSchema = z.object({
  nodes: z.array(archNodeSchema),
  edges: z.array(archEdgeSchema),
});
export type Architecture = z.infer<typeof architectureSchema>;

export const diffRowSchema = z.object({
  type: z.enum(["hunk", "ctx", "del", "add"]),
  old: z.number().nullable().optional(),
  new: z.number().nullable().optional(),
  text: z.string(),
});
export type DiffRow = z.infer<typeof diffRowSchema>;

export const fileDiffSchema = z.object({
  file: z.string(),
  notes: z.array(z.string()),
  rows: z.array(diffRowSchema),
});
export type FileDiff = z.infer<typeof fileDiffSchema>;

export const effectSchema = z.object({
  issue_id: z.string(),
  effect: z.enum(["prevented", "unchanged"]),
  reason: z.string(),
  day: z.number().int().min(0),
});
export type Effect = z.infer<typeof effectSchema>;

export const fixSchema = z.object({
  summary: z.string(),
  diffs: z.array(fileDiffSchema),
  effects: z.array(effectSchema),
});
export type Fix = z.infer<typeof fixSchema>;

export const feedbackSchema = z.object({
  consequence: z.string(),
  covered: z.array(z.string()),
  questions: z.array(z.string()),
});
export type Feedback = z.infer<typeof feedbackSchema>;

export const skippedSchema = z.object({
  reason: z.string(),
  impact: z.enum(["none", "escalate"]),
  impact_reason: z.string(),
  escalation_id: z.string().optional(),
});
export type Skipped = z.infer<typeof skippedSchema>;

export const issueSchema = z.object({
  id: z.string(),
  rule: z.string(),
  day: z.number().int().min(0),
  incident_title: z.string(),
  incident_story: z.string(),
  signals: z.array(signalSchema),
  view: viewSchema,
  affected_nodes: z.array(z.string()),
  title: z.string(),
  category: z.string(),
  severity: severitySchema,
  what_happens: z.string(),
  who_is_affected: z.string(),
  background_link: z.string(),
  finding_ids: z.array(z.string()),
  stance: z.string(),
  options: z.array(optionSchema),
  unknowns: z.array(z.string()),
  decision: z
    .object({ option_index: z.number().int().min(0), reason: z.string() })
    .nullable(),
  feedback: feedbackSchema.nullable(),
  fix: fixSchema.nullable(),
  lesson: z.string(),
  prevented_by: z.string().optional(),
  prevented_reason: z.string().optional(),
  escalated_from: z.string().optional(),
  skipped: skippedSchema.optional(),
});
export type Issue = z.infer<typeof issueSchema>;

export const lessonSchema = z.object({
  id: z.string(),
  project_id: z.string(),
  issue_id: z.string(),
  project_title: z.string(),
  issue_title: z.string(),
  rule: z.string(),
  stance: z.string(),
  chosen: z.string(),
  reason: z.string(),
  lesson: z.string(),
  created_at: z.string(),
});
export type Lesson = z.infer<typeof lessonSchema>;

const projectShape = z.object({
  id: z.string(),
  created_at: z.string(),
  background: backgroundSchema,
  findings: z.array(findingSchema),
  issues: z.array(issueSchema),
  architecture: architectureSchema,
  // 公開時のコードと、修正を反映したあとのコード
  source: z.string(),
  code: z.string(),
  sim_day: z.number().int().min(0),
});

// ブラウザに残った古い・壊れたデータで、画面が落ちないように参照を確かめる
export const projectSchema = projectShape.superRefine((p, ctx) => {
  const nodeIds = new Set(p.architecture.nodes.map((n) => n.id));
  const issueIds = new Set(p.issues.map((i) => i.id));
  const bad = (message: string) => ctx.addIssue({ code: "custom", message });
  for (const e of p.architecture.edges) {
    if (!nodeIds.has(e.from) || !nodeIds.has(e.to))
      bad(`構成図の線 ${e.from}→${e.to} の端が存在しません`);
  }
  for (const i of p.issues) {
    if (i.decision && i.decision.option_index >= i.options.length)
      bad(`${i.id}: 選んだ案が範囲外です`);
    for (const ref of [
      i.prevented_by,
      i.escalated_from,
      i.skipped?.escalation_id,
    ]) {
      if (ref && !issueIds.has(ref))
        bad(`${i.id}: 参照先 ${ref} が存在しません`);
    }
  }
});
export type Project = z.infer<typeof projectSchema>;

export const savedStateSchema = z.object({
  projects: z.array(projectSchema),
  lessons: z.array(lessonSchema),
});
export type SavedState = z.infer<typeof savedStateSchema>;
