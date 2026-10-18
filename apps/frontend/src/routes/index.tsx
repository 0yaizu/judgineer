import { IconArrowRight } from "@tabler/icons-react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Logo } from "#/components/Logo";
import { pillClass } from "#/components/Page";

export const Route = createFileRoute("/")({ component: Title });

function Title() {
  return (
    <div className="relative flex min-h-[calc(100vh-14rem)] flex-col items-center justify-center text-center">
      {/* ロゴの後ろに、うっすら緑の光を置く（暗い背景では見えにくいので濃くする） */}
      <div
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-1/2 size-[34rem] -translate-x-1/2 -translate-y-[60%] rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--primary)_19%,transparent),transparent)] dark:bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--primary)_32%,transparent),transparent)]"
      />

      <div className="relative flex animate-in flex-col items-center duration-1000 fade-in slide-in-from-bottom-2">
        <Logo className="size-28 text-ink drop-shadow-sm" />

        <h1 className="mt-7 pl-[0.08em] font-display text-5xl font-extrabold tracking-[0.08em] sm:text-7xl">
          ジャッジニア
        </h1>

        <div className="mt-5 flex items-center gap-4 text-muted-foreground">
          <span className="h-px w-12 bg-gradient-to-r from-transparent to-current opacity-60" />
          <span className="pl-[0.6em] text-[11px] font-medium tracking-[0.6em]">
            JUDGINEER
          </span>
          <span className="h-px w-12 bg-gradient-to-l from-transparent to-current opacity-60" />
        </div>
      </div>

      <Link
        to="/register"
        // 遅れて現れる動きは animation の値で指定する（delay-/duration- だとホバーの動きまで遅くなる）
        className={`${pillClass} mt-14 animate-in fill-mode-backwards fade-in [animation-delay:300ms] [animation-duration:1s]`}
      >
        アプリを登録
        <IconArrowRight />
      </Link>
    </div>
  );
}
