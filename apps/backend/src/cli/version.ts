declare const BUILD_VERSION: string | undefined; // リリースのビルドで --define する
export const version =
  typeof BUILD_VERSION === "string" ? BUILD_VERSION : "dev";
