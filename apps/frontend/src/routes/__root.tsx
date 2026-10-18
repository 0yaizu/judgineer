import { ThemeInitScript } from "@starwind-ui/react/theme";
import {
  createRootRoute,
  HeadContent,
  Link,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { Logo } from "#/components/Logo";
import { ThemeToggle } from "#/components/ThemeToggle";
import { api } from "#/lib/api";
import type { AIConfig } from "#/lib/types";
import appCss from "../styles.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      {
        title: "ジャッジニア（Judgineer）",
      },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      // 見出し用の太いゴシック（--font-display）
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      {
        rel: "preconnect",
        href: "https://fonts.gstatic.com",
        crossOrigin: "anonymous",
      },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=M+PLUS+1p:wght@800&display=swap",
      },
    ],
  }),
  shellComponent: RootDocument,
});

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html suppressHydrationWarning lang="ja">
      <head>
        <ThemeInitScript />
        <HeadContent />
      </head>
      <body>
        <AppHeader />
        <main className="mx-auto w-full max-w-6xl px-4 pt-8 pb-28 sm:px-6">
          {children}
        </main>

        <Scripts />
      </body>
    </html>
  );
}

const NAV = [
  { to: "/sessions", label: "セッション履歴" },
  { to: "/lessons", label: "判断の記録" },
  { to: "/register", label: "アプリを登録" },
] as const;

function AppHeader() {
  const [ai, setAi] = useState<AIConfig | null>(null);
  useEffect(() => {
    api
      .config()
      .then(setAi)
      .catch(() => setAi(null));
  }, []);

  return (
    <header className="sticky top-0 z-10 border-b bg-background">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-7 px-4 sm:px-6">
        <Link
          to="/"
          className="inline-flex items-center gap-2 font-display text-[17px] font-extrabold text-foreground hover:text-foreground"
        >
          <Logo className="size-7 text-ink" />
          ジャッジニア
          <span className="text-xs font-medium tracking-wider text-muted-foreground">
            Judgineer
          </span>
        </Link>
        <nav className="flex gap-5 text-sm">
          {NAV.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              activeOptions={{ exact: true }}
              className="border-b-2 py-4 hover:text-foreground"
              activeProps={{ className: "border-primary text-foreground" }}
              inactiveProps={{ className: "border-transparent text-sub" }}
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          {ai && (
            <span
              title={ai.status.detail}
              className={`rounded-full border px-3 py-0.5 text-xs ${ai.status.ok ? "text-muted-foreground" : "border-error text-error"}`}
            >
              AI: {ai.label}
              {!ai.status.ok && "（要確認）"}
            </span>
          )}
          <ThemeToggle />
        </div>
      </div>
      {ai && !ai.status.ok && (
        <p className="bg-error/10 px-4 py-2 text-center text-sm text-error">
          {ai.status.detail}
        </p>
      )}
    </header>
  );
}
