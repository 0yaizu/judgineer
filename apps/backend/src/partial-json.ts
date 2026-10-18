const NONE = Symbol("none");

/** 途中で切れた JSON から、読める範囲の値を返す。何も読めなければ undefined */
export function parsePartialJson(text: string): unknown {
  const n = text.length;
  let i = 0;
  const ws = () => {
    while (i < n && " \n\r\t".includes(text[i] as string)) i++;
  };

  // 文字列。閉じていなければそこまでを返す (末尾の途中のエスケープは捨てる)
  const str = (): { v: string; done: boolean } | typeof NONE => {
    let j = i + 1;
    let cut = n;
    let done = false;
    while (j < n) {
      const c = text[j];
      if (c === '"') {
        cut = j;
        done = true;
        break;
      }
      const w = c === "\\" ? (text[j + 1] === "u" ? 6 : 2) : 1;
      if (j + w > n) {
        cut = j;
        break;
      }
      j += w;
    }
    try {
      const v = JSON.parse(`"${text.slice(i + 1, cut)}"`);
      i = done ? cut + 1 : n;
      return { v, done };
    } catch {
      return NONE;
    }
  };

  const value = (): unknown => {
    ws();
    const c = text[i];
    if (c === undefined) return NONE;
    if (c === '"') {
      const s = str();
      return s === NONE ? NONE : s.v;
    }
    if (c === "{" || c === "[") {
      const close = c === "{" ? "}" : "]";
      const out: unknown[] | Record<string, unknown> = c === "{" ? {} : [];
      i++;
      for (;;) {
        ws();
        if (i >= n) return out;
        if (text[i] === close) {
          i++;
          return out;
        }
        let key = "";
        if (c === "{") {
          if (text[i] !== '"') return out;
          const k = str();
          if (k === NONE || !k.done) return out;
          key = k.v;
          ws();
          if (text[i] !== ":") return out;
          i++;
        }
        const v = value();
        if (v === NONE) return out;
        if (Array.isArray(out)) out.push(v);
        else out[key] = v;
        ws();
        if (text[i] === ",") i++;
        else if (text[i] !== close) return out;
      }
    }
    // 数値・true/false/null: 後ろに区切りが来るまで確定させない
    let j = i;
    while (j < n && !",]} \n\r\t".includes(text[j] as string)) j++;
    if (j >= n) return NONE;
    try {
      const v = JSON.parse(text.slice(i, j));
      i = j;
      return v;
    } catch {
      return NONE;
    }
  };

  const v = value();
  return v === NONE ? undefined : v;
}
