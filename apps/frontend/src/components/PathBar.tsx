import {
  IconChevronRight,
  IconFileCode,
  IconFolderFilled,
} from "@tabler/icons-react";
import { Fragment, useEffect, useState } from "react";
import { api } from "#/lib/api";

// TODO(backend): 登録したときのフォルダ名はまだ保存していない。今は現在の TARGET_DIR の名前で代用しているので、
// 後から TARGET_DIR を変えると、古いセッションでも新しいフォルダ名が出る。
// projects にフォルダ名を保存したら、それを root で渡す（渡されたときは下の問い合わせをしない）。

// 現在の TARGET_DIR のフォルダ名。全画面で同じなので、一度だけ聞く
let rootName: Promise<string> | null = null;
const loadRootName = () => {
  rootName ??= api
    .target()
    .then((t) => t.dir.split(/[\\/]/).filter(Boolean).pop() ?? "")
    .catch(() => "");
  return rootName;
};

/** エクスプローラーのように、ファイルの場所を「フォルダ > フォルダ > ファイル」で出す */
export function PathBar({
  file,
  root: given,
}: {
  file: string;
  root?: string;
}) {
  const [fallback, setFallback] = useState("");
  useEffect(() => {
    if (given === undefined) loadRootName().then(setFallback);
  }, [given]);
  const root = given ?? fallback;

  const parts = file.split("/").filter(Boolean);
  const name = parts.pop() ?? file;
  const folders = root ? [root, ...parts] : parts;

  return (
    <nav
      aria-label="ファイルの場所"
      className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5 border-b border-white/5 bg-[#161b22] px-3.5 py-1.5 font-sans text-xs text-[#8b949e] dark:bg-[#0b0f12]"
    >
      {folders.map((f, n) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: 同じ名前のフォルダが続くこともある
        <Fragment key={n}>
          <span className="flex items-center gap-1">
            <IconFolderFilled className="size-3.5 text-[#e3b341]" />
            {f}
          </span>
          <IconChevronRight className="size-3 shrink-0 opacity-60" />
        </Fragment>
      ))}
      <span className="flex items-center gap-1 font-medium text-[#e6edf3]">
        <IconFileCode className="size-3.5 text-[#79c0ff]" />
        {name}
      </span>
    </nav>
  );
}
