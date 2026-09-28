/**
 * The Second "S" mark (brand assets: SECOND-icon-only-mark), redrawn as SVG so
 * it stays crisp and sits cleanly on both the light and dark canvases.
 */
export default function BrandMark({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 140" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="second-top" x1="15" y1="0" x2="105" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#4c47fd" />
          <stop offset="1" stopColor="#4c96ff" />
        </linearGradient>
        <linearGradient id="second-mid" x1="15" y1="56" x2="105" y2="82" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#5a36f5" />
          <stop offset="1" stopColor="#8a68fd" />
        </linearGradient>
        <linearGradient id="second-bot" x1="15" y1="0" x2="105" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#4f86fd" />
          <stop offset="1" stopColor="#8a66fb" />
        </linearGradient>
      </defs>
      <g fill="none" strokeLinecap="round" strokeWidth="30">
        <path d="M30 56 L90 82" stroke="url(#second-mid)" />
        <path d="M30 56 L90 18" stroke="url(#second-top)" />
        <path d="M30 120 L90 82" stroke="url(#second-bot)" />
      </g>
    </svg>
  );
}
