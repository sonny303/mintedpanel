// Abstract geometric graphic used in the hero and problem sections.
// Layered rounded panels in the Primary green — no icons, no illustrations.
export function HeroGraphic({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 480 400"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <circle cx="70" cy="60" r="8" fill="#1B4D3E" opacity="0.25" />
      <circle cx="420" cy="340" r="12" fill="#1B4D3E" opacity="0.15" />
      <rect x="60" y="80" width="240" height="300" rx="12" fill="#1B4D3E" opacity="0.08" />
      <rect x="120" y="50" width="240" height="300" rx="12" fill="#1B4D3E" opacity="0.18" />
      <rect x="180" y="30" width="240" height="300" rx="12" fill="#1B4D3E" />
      <g stroke="#FFFFFF" strokeWidth="2" opacity="0.5">
        <line x1="210" y1="90" x2="360" y2="90" />
        <line x1="210" y1="120" x2="330" y2="120" />
        <line x1="210" y1="150" x2="360" y2="150" />
        <line x1="210" y1="180" x2="300" y2="180" />
      </g>
      <rect x="210" y="220" width="60" height="60" rx="6" fill="#FFFFFF" opacity="0.85" />
      <rect x="285" y="220" width="60" height="60" rx="6" fill="#FFFFFF" opacity="0.55" />
      <rect x="210" y="295" width="135" height="20" rx="4" fill="#FFFFFF" opacity="0.4" />
    </svg>
  );
}
