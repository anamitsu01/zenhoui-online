/**
 * The player's piece: a round little explorer in the team color with a sprout
 * on its head. It looks the way it last moved (dx/dy in -1..1) and faces
 * left/right by mirroring.
 */
export default function Character({
  color,
  label,
  dir,
}: {
  color: string;
  label: string;
  dir: [number, number];
}) {
  const facingLeft = dir[0] < 0;
  // Pupils lean toward where it's heading (mirroring handles left/right).
  const px = dir[0] !== 0 ? 1.6 : 0;
  const py = dir[1] * 1.6;
  return (
    <svg viewBox="0 0 40 48" className="h-full w-full overflow-visible" aria-hidden>
      <g transform={facingLeft ? "translate(40 0) scale(-1 1)" : undefined}>
        {/* sprout */}
        <path d="M20 9 C20 5 21 3 22 1" stroke="#3f7d32" strokeWidth="1.6" fill="none" strokeLinecap="round" />
        <path d="M21.5 3.5 C25 0 30 1.5 30 4 C27 6 23.5 5.5 21.5 3.5 Z" fill="#6cc24a" />
        <path d="M20.5 5 C17 2.5 13 3.5 13 6 C15.5 7.5 18.5 7 20.5 5 Z" fill="#58a83b" />
        {/* feet */}
        <ellipse cx="13.5" cy="44" rx="5" ry="3" fill="#1b1b22" />
        <ellipse cx="26.5" cy="44" rx="5" ry="3" fill="#1b1b22" />
        {/* body */}
        <path d="M20 8 C31 8 36 18 36 29 C36 39 29 44 20 44 C11 44 4 39 4 29 C4 18 9 8 20 8 Z" fill={color} stroke="#0b0d12" strokeWidth="1.6" />
        {/* belly highlight & side shade */}
        <path d="M9 22 C11 15 15 12 19 11.5 C14 15 11.5 19 11 25 Z" fill="#ffffff" opacity="0.35" />
        <path d="M33 30 C33 38 27.5 42 20 42.5 C27 39 31 35 33 30 Z" fill="#000000" opacity="0.18" />
        {/* eyes */}
        <ellipse cx="14.5" cy="24" rx="4.2" ry="5" fill="#fff" />
        <ellipse cx="26" cy="24" rx="4.2" ry="5" fill="#fff" />
        <circle cx={14.5 + px} cy={24.5 + py} r="2.3" fill="#141420" />
        <circle cx={26 + px} cy={24.5 + py} r="2.3" fill="#141420" />
        <circle cx={15.3 + px} cy={23.4 + py} r="0.8" fill="#fff" />
        <circle cx={26.8 + px} cy={23.4 + py} r="0.8" fill="#fff" />
        {/* cheeks */}
        <ellipse cx="10.5" cy="31" rx="2.6" ry="1.6" fill="#ff8fa3" opacity="0.7" />
        <ellipse cx="30" cy="31" rx="2.6" ry="1.6" fill="#ff8fa3" opacity="0.7" />
        {/* mouth */}
        <path d="M18 32 Q20.5 34.5 23 32" stroke="#141420" strokeWidth="1.3" fill="none" strokeLinecap="round" />
      </g>
      {/* number badge (never mirrored) */}
      <circle cx="33" cy="40" r="6" fill="#fff" stroke="#0b0d12" strokeWidth="1.4" />
      <text x="33" y="43.2" textAnchor="middle" fontSize="9" fontWeight="900" fill="#0b0d12" fontFamily="sans-serif">
        {label}
      </text>
    </svg>
  );
}
