import { IconMoon, IconSun } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";

// ThemeInitScript が localStorage の colorTheme を読んで <html> の dark クラスを付けるので、同じ仕組みに合わせる
const STORAGE_KEY = "colorTheme";
// starwind.css の .theme-transition（色が 0.7 秒かけて変わる）を付けておく時間
const FADE_MS = 700;

export function ThemeToggle() {
  const [dark, setDark] = useState(false);
  const fadeTimer = useRef<number>(undefined);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  const toggle = () => {
    const next = !dark;
    const root = document.documentElement;
    root.classList.add("theme-transition");
    root.classList.toggle("dark", next);
    window.clearTimeout(fadeTimer.current);
    fadeTimer.current = window.setTimeout(
      () => root.classList.remove("theme-transition"),
      FADE_MS,
    );
    try {
      localStorage.setItem(STORAGE_KEY, next ? "dark" : "light");
    } catch {}
    setDark(next);
  };

  const label = dark ? "ライトテーマに切り替える" : "ダークテーマに切り替える";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className="flex size-8 items-center justify-center rounded-full border text-sub hover:text-foreground"
    >
      {dark ? <IconSun className="size-4" /> : <IconMoon className="size-4" />}
    </button>
  );
}
