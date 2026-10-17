type Progress = {
  stage: string;
  step: number;
  total: number;
  started: number;
  chars: number;
  partial?: unknown;
  partialAt: number;
};

const PARTIAL_INTERVAL_MS = 250;

// key: 台本づくりは pid、本文づくりは `${pid}:${iid}`
// shortcut: メモリ上だけ (プロセスが1つの前提), 複数プロセスにするなら DB へ
const progress = new Map<string, Progress>();

export function setStage(
  key: string,
  step: number,
  total: number,
  stage: string,
): void {
  const cur = progress.get(key);
  progress.set(key, {
    stage,
    step,
    total,
    started: cur?.started ?? Date.now(),
    chars: cur?.chars ?? 0,
    partialAt: 0,
  });
}

export function endProgress(key: string): void {
  progress.delete(key);
}

export function setChars(key: string, chars: number, stage?: string): void {
  const cur = progress.get(key);
  if (!cur) return;
  cur.chars = chars;
  if (stage) cur.stage = stage;
}

/** 重い再パースを避けるため、250ms 以上あけて更新する (取りこぼしてよい) */
export function setPartial(key: string, make: () => unknown): void {
  const cur = progress.get(key);
  const now = Date.now();
  if (!cur || now - cur.partialAt < PARTIAL_INTERVAL_MS) return;
  cur.partialAt = now;
  const v = make();
  if (v !== undefined) cur.partial = v;
}

/** 台本づくりの出来事一覧に切り替えるときなど、確定した値で直接置く */
export function putPartial(key: string, partial: unknown): void {
  const cur = progress.get(key);
  if (cur) cur.partial = partial;
}

export function getProgress(key: string) {
  const cur = progress.get(key);
  if (!cur) return { stage: null };
  const { started, partialAt: _t, ...rest } = cur;
  return { ...rest, elapsed: Math.floor((Date.now() - started) / 1000) };
}
