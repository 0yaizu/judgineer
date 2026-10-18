import {
  IconChevronRight,
  IconFileCode,
  IconFolderFilled,
} from "@tabler/icons-react";
import { Fragment } from "react";

// TODO(backend): 登録したときのフォルダ名（検査対象のフォルダの名前）はまだセッションに保存していない。
// 保存したら root で渡す。渡されないあいだは、ファイルのパスの中のフォルダだけを出す。

/** エクスプローラーのように、ファイルの場所を「フォルダ > フォルダ > ファイル」で出す */
export function PathBar({ file, root }: { file: string; root?: string }) {
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
