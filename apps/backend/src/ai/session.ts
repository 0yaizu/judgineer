import { AsyncLocalStorage } from "node:async_hooks";
import { CancelledError } from "./errors";

type Scope = { pid: string; ac: AbortController };

// リクエスト (とそこから始まった非同期の処理) が、どのセッションの仕事かを覚えておく
const current = new AsyncLocalStorage<Scope>();

// セッションごとの、止める対象 (リクエストと、動いている AI の呼び出し)
// shortcut: メモリ上だけ (プロセスが1つの前提)
const running = new Map<string, Set<AbortController>>();

function track(pid: string, ac: AbortController): () => void {
  let set = running.get(pid);
  if (!set) {
    set = new Set();
    running.set(pid, set);
  }
  set.add(ac);
  return () => {
    set.delete(ac);
    if (set.size === 0 && running.get(pid) === set) running.delete(pid);
  };
}

/** fn の中で呼ばれた AI の生成を、pid のセッションの仕事として扱う */
export async function inSession<T>(
  pid: string,
  fn: () => Promise<T>,
): Promise<T> {
  const scope = { pid, ac: new AbortController() };
  const untrack = track(pid, scope.ac);
  try {
    return await current.run(scope, fn);
  } finally {
    untrack();
  }
}

/** pid のセッションで動いている AI の生成を全部止める。止めた数を返す */
export function cancelSession(pid: string): number {
  const set = running.get(pid);
  if (!set) return 0;
  const self = current.getStore()?.ac; // キャンセルを頼んだリクエスト自身は数えない
  let n = 0;
  for (const ac of set) {
    if (ac === self || ac.signal.aborted) continue;
    ac.abort(new CancelledError());
    n++;
  }
  return n;
}

/**
 * AI の生成1回分の中断用シグナルを作る。
 * セッションのキャンセルと、呼び出し側の signal のどちらでも止まる。
 * リクエストが返ったあとに裏で続く生成 (先読みなど) も、キャンセルで止められるように個別に登録する
 */
export function aiSignal(outer?: AbortSignal): {
  signal: AbortSignal;
  cancelled: () => boolean;
  done: () => void;
} {
  const scope = current.getStore();
  if (scope?.ac.signal.aborted) throw new CancelledError();
  const ac = new AbortController();
  const untrack = scope ? track(scope.pid, ac) : () => {};
  const onScope = () => ac.abort(new CancelledError());
  const onOuter = () => ac.abort(outer?.reason);
  scope?.ac.signal.addEventListener("abort", onScope);
  outer?.addEventListener("abort", onOuter);
  if (outer?.aborted) onOuter();
  return {
    signal: ac.signal,
    cancelled: () => ac.signal.reason instanceof CancelledError,
    done: () => {
      untrack();
      scope?.ac.signal.removeEventListener("abort", onScope);
      outer?.removeEventListener("abort", onOuter);
    },
  };
}
