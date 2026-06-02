"use client";

export function BrickIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className={className} fill="none">
      <path
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        d="M5.25 2.1C9.6 2.18 16.1 3.05 21.35 3.5C22.1 3.56 22.9 4.22 22.9 4.95V22.2C22.9 22.78 22.42 23.1 21.25 23.15H2.05C1.5 23.15 1.24 22.88 1.24 22.45V4.6L4.2 2.42C4.55 2.17 4.9 2.1 5.25 2.1Z"
      />
      <path
        stroke="currentColor"
        strokeWidth="0.8"
        strokeLinecap="butt"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        d="M1.24 4.57L18.75 5.85L21.8 3.78M18.75 5.85L18.62 23.05"
      />
      <ellipse
        cx="8.3"
        cy="13.48"
        rx="0.52"
        ry="0.72"
        stroke="currentColor"
        strokeWidth="0.9"
        vectorEffect="non-scaling-stroke"
      />
      <ellipse
        cx="14.65"
        cy="13.52"
        rx="0.52"
        ry="0.72"
        stroke="currentColor"
        strokeWidth="0.9"
        vectorEffect="non-scaling-stroke"
      />
      <path
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        d="M8.25 16.18C9 17.28 10.1 17.9 11.45 17.9C12.8 17.9 13.9 17.28 14.75 16.18"
      />
    </svg>
  );
}
