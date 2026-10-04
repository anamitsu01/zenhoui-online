/** A mound of earth with a dark arched entrance. Sized in em so it lines up with emoji icons. */
export default function CaveIcon({ size = "1em", className = "" }: { size?: string; className?: string }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} className={`inline-block align-[-0.125em] ${className}`} aria-label="洞窟" role="img">
      {/* mound */}
      <path d="M1 29 C3 17 9 7 16 7 C23 7 29 17 31 29 Z" fill="#8a5a2e" />
      {/* sunlit side */}
      <path d="M5 21 C8 13 12 9.5 16 9 C12 11 9 15 7.5 21 Z" fill="#b07a42" />
      {/* a few stones */}
      <ellipse cx="24.5" cy="15.5" rx="2" ry="1.3" fill="#6e4523" />
      <ellipse cx="8.5" cy="25" rx="1.6" ry="1" fill="#6e4523" />
      {/* entrance */}
      <path d="M10 29 V22 A6 6 0 0 1 22 22 V29 Z" fill="#140b05" />
      <path d="M10 29 V22 A6 6 0 0 1 22 22 V23 A6 5 0 0 0 10 23 Z" fill="#4a2c14" />
      {/* ground line */}
      <rect x="0" y="28.5" width="32" height="1.5" rx="0.75" fill="#5b3a1d" />
    </svg>
  );
}
