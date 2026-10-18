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

// DB に無い項目をルートが足している
export type ProjectView = Project & {
  sim_days: number;
  related_lessons: Lesson[];
};

export type AIConfig = {
  provider: string;
  label: string;
  status: { ok: boolean; detail: string };
};

/** judgineer load で読み込んだ、検査するフォルダ */
export type Target = {
  id: string;
  path: string;
  name: string;
  created_at: string;
  last_loaded_at: string;
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
