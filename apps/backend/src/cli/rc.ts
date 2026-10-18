// install.sh がシェルの設定ファイルに足す PATH の記述 (この印の間) を消す
export const RC_BEGIN = "# >>> judgineer >>>";
export const RC_END = "# <<< judgineer <<<";

/**
 * 印の間 (印を含む) を取り除いた本文を返す。印が無ければ null。
 * 終わりの印が無いときは壊れているとみなして throw する (そのまま消すと末尾まで消えるため)
 */
export function stripRcBlock(text: string): string | null {
  const lines = text.split("\n");
  const begin = lines.findIndex((l) => l.trim() === RC_BEGIN);
  if (begin < 0) return null;
  const end = lines.findIndex((l, i) => i > begin && l.trim() === RC_END);
  if (end < 0) throw new Error("終わりの印がありません");
  // 足したときに前へ入れた空行も一緒に消す
  const from = begin > 0 && lines[begin - 1] === "" ? begin - 1 : begin;
  return [...lines.slice(0, from), ...lines.slice(end + 1)].join("\n");
}
