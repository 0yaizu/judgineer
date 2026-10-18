import type { Signal } from "@tka/shared";
import type { Architecture } from "./types";

export type Outline = { day: number; severity: string; title: string };

export type PartialView = {
  architecture?: Architecture;
  issues: Outline[];
  incident_story?: string;
  signals: Signal[];
};

const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** 進捗の partial (unknown) を、画面で使う形に読み替える。形が違うものは捨てる */
export function readPartial(p: unknown): PartialView {
  const o = (p && typeof p === "object" ? p : {}) as Record<string, unknown>;
  const arch = o.architecture as Partial<Architecture> | undefined;
  return {
    architecture:
      arch && Array.isArray(arch.nodes) && Array.isArray(arch.edges)
        ? (arch as Architecture)
        : undefined,
    issues: list(o.issues).filter(
      (i): i is Outline => !!i && typeof (i as Outline).title === "string",
    ),
    incident_story:
      typeof o.incident_story === "string" ? o.incident_story : undefined,
    signals: list(o.signals).filter(
      (s): s is Signal => !!s && typeof (s as Signal).text === "string",
    ),
  };
}
