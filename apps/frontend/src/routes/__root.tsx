import { ThemeInitScript } from "@starwind-ui/react/theme";
import {
  createRootRoute,
  HeadContent,
  Link,
  Scripts,
} from "@tanstack/react-router";

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
  { to: "/", label: "アプリを登録" },
  { to: "/lessons", label: "判断の記録" },
] as const;

function AppHeader() {
  return (
    <header className="sticky top-0 z-10 border-b bg-background/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4 sm:px-6">
        <Link to="/" className="font-bold">
          ジャッジニア
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            Judgineer
          </span>
        </Link>
        <nav className="flex gap-5 text-sm">
          {NAV.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              activeOptions={{ exact: true }}
              className="border-b-2 border-transparent py-4 text-muted-foreground hover:text-foreground"
              activeProps={{ className: "border-primary text-foreground" }}
            >
              {n.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
