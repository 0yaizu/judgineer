import { type Finding, findingLine } from "./scanner";

const text = (f: Finding) => findingLine(f).trim();

/** original (登録時) と current (いまのコードの再スキャン) を、(rule, file) ごとに 1対1 で突き合わせる */
export function compareScans(original: Finding[], current: Finding[]) {
  const remaining: Finding[] = [];
  const resolved: Finding[] = [];
  const introduced: Finding[] = [];
  const groups = new Map<string, { o: Finding[]; c: Finding[] }>();
  const group = (f: Finding) => {
    const k = `${f.rule}\0${f.file}`;
    const g = groups.get(k) ?? { o: [], c: [] };
    groups.set(k, g);
    return g;
  };
  for (const f of original) group(f).o.push(f);
  for (const f of current) group(f).c.push(f);
  const byLine = (a: Finding, b: Finding) => a.line - b.line;
  for (const { o, c } of groups.values()) {
    // 同じ行の文字列同士を先に組にし、残りは行番号順に組にする (書き換えられたが同じルールに当たっている)
    const restO: Finding[] = [];
    for (const f of o.sort(byLine)) {
      const i = c.findIndex((x) => text(x) === text(f));
      if (i < 0) restO.push(f);
      else {
        c.splice(i, 1);
        remaining.push(f);
      }
    }
    c.sort(byLine);
    for (const f of restO) {
      if (c.length) {
        c.shift();
        remaining.push(f);
      } else resolved.push(f);
    }
    introduced.push(...c);
  }
  return { remaining, resolved, introduced };
}

/** 修正の前後 (before / after は current/ の再スキャン) を比べる。resolved / remaining は original の id (累積) */
export function verifyFix(
  original: Finding[],
  before: Finding[],
  after: Finding[],
) {
  const a = compareScans(original, after);
  const prev = compareScans(original, before).introduced.map(
    (f) => `${f.rule}\0${f.file}\0${text(f)}`,
  );
  const introduced = a.introduced.filter((f) => {
    const i = prev.indexOf(`${f.rule}\0${f.file}\0${text(f)}`);
    if (i < 0) return true;
    prev.splice(i, 1);
    return false;
  });
  return {
    resolvedIds: new Set(a.resolved.map((f) => f.id)),
    remainingIds: new Set(a.remaining.map((f) => f.id)),
    introduced,
  };
}
