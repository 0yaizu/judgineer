// 画面で使う型。API が返すものはバックエンドの型をそのまま使う（二重に定義しない）
import type {
  ChatMessage,
  ChatPhase,
  DiffRow,
  Fix,
  Issue,
  Lesson,
  Project,
  ProjectSummary,
} from "@tka/backend/types";
import type { Architecture, Background } from "@tka/shared";

export type {
  Architecture,
  Background,
  ChatMessage,
  ChatPhase,
  DiffRow,
  Fix,
  Issue,
  Lesson,
  ProjectSummary,
};

export type ArchNode = Architecture["nodes"][number];
export type FileDiff = Fix["diffs"][number];
export type Finding = Project["findings"][number];

/** GET /api/projects/:pid などが返す形（DB に無い項目をルートが足している） */
export type ProjectView = Project & {
  sim_days: number;
  related_lessons: Lesson[];
};

export type AIConfig = {
  provider: string;
  label: string;
  status: { ok: boolean; detail: string };
  target: { dir: string; exists: boolean };
};

export type Target = {
  dir: string;
  exists: boolean;
  background: Partial<Background> | null;
};

export type Progress = {
  stage: string | null;
  step?: number;
  total?: number;
  chars?: number;
  elapsed?: number;
};
