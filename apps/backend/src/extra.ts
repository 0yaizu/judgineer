import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { type ExtraCandidate, extraFindingsResultSchema } from "@tka/shared";
import { generate } from "./ai/client";
import { inside, isFile } from "./project";
import { extraFindingsPrompt } from "./prompts/analyze";
import { CODE_EXT, type Finding, snippet, splitLines } from "./scanner";

const MAX_EXTRA = 8;
const MIN_QUOTE = 5;
const squash = (s: string) => s.replace(/\s+/g, "");

/** AI の候補のうち、引用した行が実際のコードに実在するものだけを Finding にする (作り話は捨てる) */
export function verifyCandidates(
  root: string,
  candidates: ExtraCandidate[],
  existing: Finding[],
  firstId: number,
): Finding[] {
  const taken = new Set(existing.map((f) => `${f.file}\0${f.line}`));
  const out: Finding[] = [];
  for (const c of candidates) {
    if (out.length >= MAX_EXTRA) break;
    const quote = squash(c.quote);
    const path = inside(root, c.file);
    if (quote.length < MIN_QUOTE || !path || !isFile(path)) continue;
    if (!CODE_EXT.has(extname(path))) continue;
    const lines = splitLines(readFileSync(path, "utf8"));
    // 行番号は数行ずれることがあるので、全体から探して申告に一番近い行を採る
    let best = -1;
    lines.forEach((l, i) => {
      if (
        squash(l).includes(quote) &&
        (best < 0 || Math.abs(i + 1 - c.line) < Math.abs(best + 1 - c.line))
      ) {
        best = i;
      }
    });
    const key = `${c.file}\0${best + 1}`;
    if (best < 0 || taken.has(key)) continue;
    taken.add(key);
    out.push({
      id: `F${firstId + out.length}`,
      rule: "ai-candidate",
      title: c.title,
      file: c.file,
      line: best + 1,
      snippet: snippet(lines, best),
      origin: "ai",
      why: c.why,
    });
  }
  return out;
}

/** AI に追加の候補を出させ、引用が実在するものだけ返す。失敗しても本体の分析は続けたいので、例外は投げない */
export async function extraFindings(a: {
  root: string;
  system: string;
  existing: Finding[];
}): Promise<Finding[]> {
  try {
    const res = await generate({
      task: "extra_findings",
      system: a.system,
      prompt: extraFindingsPrompt({ findings: a.existing }),
      schema: extraFindingsResultSchema,
    });
    const max = Math.max(
      0,
      ...a.existing.map((f) => Number(f.id.slice(1)) || 0),
    );
    return verifyCandidates(a.root, res.candidates, a.existing, max + 1);
  } catch (e) {
    console.warn("追加の指摘候補を探せませんでした:", e);
    return [];
  }
}
