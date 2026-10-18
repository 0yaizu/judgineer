// 単体バイナリ (bun build --compile) に埋め込んだ assets.tar を読む。
// 中身は public/ (フロントのビルド結果) と drizzle/ (マイグレーション)。
// どちらも実行時にファイルとして読むもので、import で辿れないため、そのままではバイナリに入らない。
// 開発時 (bun で直接動かすとき) は埋め込みが無く null を返す
type Named = Blob & { name?: string };

let cache: Promise<Map<string, Blob> | null> | undefined;

export function embeddedAssets(): Promise<Map<string, Blob> | null> {
  cache ??= (async () => {
    const tar = (Bun.embeddedFiles as readonly Named[]).find((f) =>
      f.name?.startsWith("assets"),
    );
    if (!tar) return null;
    const files = await new Bun.Archive(await tar.arrayBuffer()).files();
    return new Map([...files].map(([k, v]) => [k.replace(/^\.\//, ""), v]));
  })();
  return cache;
}
