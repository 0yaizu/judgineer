// ジャッジニアのロゴ。線の色は文字色に合わせるので、ライト・ダークどちらの背景でも読める
export function Logo({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 120 120"
      role="img"
      aria-label="ジャッジニアのロゴ"
      className={className}
    >
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth="9"
        strokeLinecap="round"
      >
        <path d="M42 108 V36" />
        <path d="M42 90 C42 72 80 78 80 58 V52" />
        <circle cx="80" cy="40" r="10" strokeWidth="6" />
      </g>
      <circle cx="42" cy="62" r="7" fill="currentColor" />
      <circle cx="42" cy="24" r="18" fill="#1F9D74" />
      <path
        d="M33 24 L40 31 L52 17"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth="5.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
