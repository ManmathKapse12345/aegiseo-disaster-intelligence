/**
 * Inline SVG illustrations in one consistent style (ink outlines, teal accent, paper tones).
 * Each one explains a real part of how AegisEO works; none is decoration only.
 * Decorative copies are aria-hidden; explanatory ones carry a title.
 */

import { useMediaQuery } from "@/lib/hooks";

const INK = "#15213b";
const useCalm = () => useMediaQuery("(prefers-reduced-motion: reduce)");
const TEAL = "#0f6b66";
const AMBER = "#f2b134";
const WATER = "#1f6fd1";

export function BrandMark({ size = 38 }: { size?: number }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 40 40" aria-hidden>
      <rect x="1" y="1" width="38" height="38" rx="11" fill={INK} />
      <ellipse cx="20" cy="20" rx="13.5" ry="6.5" fill="none" stroke="#5fb3aa" strokeWidth="1.6" transform="rotate(-24 20 20)" />
      <circle cx="20" cy="20" r="5.2" fill="#fff" />
      <path d="M14.8 21.6c1.7-1.1 3.4-1.1 5.2 0s3.5 1.1 5.2 0" stroke={WATER} strokeWidth="1.8" fill="none" strokeLinecap="round" />
      <circle cx="31.4" cy="14.6" r="2.6" fill={AMBER} />
    </svg>
  );
}

function Ground({ flooded }: { flooded?: boolean }) {
  return (
    <g>
      <rect x="0" y="150" width="280" height="40" fill="#e3dccb" />
      <path d="M0 166 C40 158 70 176 112 168 S190 156 280 170 L280 190 L0 190Z" fill={flooded ? "#2c4f7c" : "#cfdcc0"} opacity={flooded ? 0.9 : 1} />
      {[38, 62, 196, 222].map((x) => (
        <g key={x} transform={`translate(${x} 143)`}>
          <rect x="-8" y="0" width="16" height="12" fill="#fff" stroke={INK} strokeWidth="1.4" />
          <path d="M-10 1 L0 -8 L10 1" fill="#fff" stroke={INK} strokeWidth="1.4" strokeLinejoin="round" />
        </g>
      ))}
    </g>
  );
}

function Satellite({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect x="-26" y="-6" width="16" height="12" rx="2" fill={TEAL} />
      <rect x="10" y="-6" width="16" height="12" rx="2" fill={TEAL} />
      <rect x="-9" y="-10" width="18" height="20" rx="4" fill="#fff" stroke={INK} strokeWidth="1.8" />
      <circle cx="0" cy="12" r="3" fill={AMBER} stroke={INK} strokeWidth="1.2" />
    </g>
  );
}

function Cloud({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <path d="M-46 14 C-60 14 -60 -6 -44 -6 C-42 -22 -18 -26 -10 -12 C-2 -30 30 -26 30 -6 C46 -8 52 14 36 14 Z" fill="#fff" stroke={INK} strokeWidth="1.6" strokeLinejoin="round" />
    </g>
  );
}

/** Camera satellites (Sentinel-2) can't see through cloud. */
export function CameraIllustration() {
  return (
    <svg className="illus" viewBox="0 0 280 190" role="img" aria-labelledby="cam-t">
      <title id="cam-t">A camera satellite's view stops at the clouds, so the flooded ground below is hidden.</title>
      <rect width="280" height="190" fill="#f3f1ea" />
      <path d="M140 46 L92 104 L188 104 Z" fill={AMBER} opacity="0.28" />
      <Satellite x={140} y={30} />
      <Ground flooded />
      <Cloud x={140} y={106} s={1.35} />
      <Cloud x={52} y={92} s={0.7} />
      <g transform="translate(212 74)">
        <circle r="12" fill="#fff" stroke="#b42318" strokeWidth="1.8" />
        <path d="M-5 -5 L5 5 M5 -5 L-5 5" stroke="#b42318" strokeWidth="2.2" strokeLinecap="round" />
      </g>
    </svg>
  );
}

/** Radar satellites (Sentinel-1) see through cloud: calm water sends the signal away and looks dark. */
export function RadarIllustration() {
  const calm = useCalm();
  return (
    <svg className="illus" viewBox="0 0 280 190" role="img" aria-labelledby="radar-t">
      <title id="radar-t">A radar satellite sends waves through the clouds to the ground and listens for the echo, so it can see the flood.</title>
      <rect width="280" height="190" fill="#f3f1ea" />
      <Satellite x={140} y={30} />
      <Cloud x={140} y={102} s={1.35} />
      <Cloud x={226} y={88} s={0.7} />
      <Ground flooded />
      {[0, 1, 2, 3].map((i) => (
        <path key={i} d={`M${112 - i * 9} ${60 + i * 26} Q140 ${70 + i * 26} ${168 + i * 9} ${60 + i * 26}`} fill="none" stroke={TEAL} strokeWidth="2.4" strokeLinecap="round" opacity={0.95 - i * 0.12}>
          {!calm && <animate attributeName="opacity" values={`${0.95 - i * 0.12};0.25;${0.95 - i * 0.12}`} dur="2.4s" begin={`${i * 0.3}s`} repeatCount="indefinite" />}
        </path>
      ))}
      <g transform="translate(252 122)">
        <circle r="12" fill="#fff" stroke="#1e7a3e" strokeWidth="1.8" />
        <path d="M-5 0 L-1 4 L6 -4" stroke="#1e7a3e" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </svg>
  );
}

/** The system drafts, a person decides, only then anything is sent. */
export function PersonInChargeIllustration() {
  return (
    <svg className="illus" viewBox="0 0 560 170" role="img" aria-labelledby="hitl-t" style={{ width: "100%", height: "auto" }}>
      <title id="hitl-t">AegisEO writes a draft warning. A person reads it and approves or rejects it. Only an approved warning can be sent.</title>
      <defs>
        <marker id="arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0 L10 5 L0 10z" fill={INK} opacity="0.55" />
        </marker>
      </defs>
      {/* computer with map */}
      <g transform="translate(20 28)">
        <rect width="120" height="84" rx="10" fill="#fff" stroke={INK} strokeWidth="1.8" />
        <rect x="10" y="10" width="100" height="56" rx="5" fill="#e5effb" />
        <path d="M10 48 C34 40 50 60 74 50 S100 44 110 50 L110 66 L10 66Z" fill={WATER} opacity="0.75" />
        {[[22, 18], [46, 18], [70, 18], [22, 34], [46, 34], [70, 34], [94, 34]].map(([x, y], i) => (
          <rect key={i} x={x} y={y} width="16" height="12" rx="2" fill={["#2a9d8f", "#e9b308", "#ef6c00", "#2a9d8f", "#ef6c00", "#c62828", "#e9b308"][i]} opacity="0.7" />
        ))}
        <rect x="46" y="84" width="28" height="12" fill="#fff" stroke={INK} strokeWidth="1.8" />
      </g>
      <path d="M150 70 H200" stroke={INK} strokeWidth="1.8" strokeOpacity="0.55" markerEnd="url(#arr)" />
      {/* draft card */}
      <g transform="translate(210 30)">
        <rect width="110" height="80" rx="10" fill="#fff" stroke={INK} strokeWidth="1.8" strokeDasharray="5 4" />
        <rect x="14" y="14" width="44" height="10" rx="5" fill="#fdf0e3" />
        <rect x="14" y="32" width="80" height="6" rx="3" fill="#d3ccbd" />
        <rect x="14" y="44" width="70" height="6" rx="3" fill="#d3ccbd" />
        <rect x="14" y="56" width="76" height="6" rx="3" fill="#d3ccbd" />
        <text x="55" y="100" textAnchor="middle" fontSize="12" fill={INK} opacity="0.7" fontFamily="Inter Variable, sans-serif">draft</text>
      </g>
      <path d="M330 70 H380" stroke={INK} strokeWidth="1.8" strokeOpacity="0.55" markerEnd="url(#arr)" />
      {/* person */}
      <g transform="translate(410 30)">
        <circle cx="20" cy="18" r="14" fill="#fff" stroke={INK} strokeWidth="1.8" />
        <path d="M-6 80 C-6 52 46 52 46 80" fill="#fff" stroke={INK} strokeWidth="1.8" />
        <circle cx="44" cy="60" r="13" fill={TEAL} />
        <path d="M38 60 L42 64 L50 55" stroke="#fff" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <text x="20" y="100" textAnchor="middle" fontSize="12" fill={INK} opacity="0.7" fontFamily="Inter Variable, sans-serif">person decides</text>
      </g>
      <path d="M470 70 H500" stroke={INK} strokeWidth="1.8" strokeOpacity="0.55" markerEnd="url(#arr)" />
      {/* send */}
      <g transform="translate(508 52)">
        <path d="M0 18 L34 0 L24 36 L16 24 Z" fill="#fff" stroke={INK} strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M16 24 L34 0" stroke={INK} strokeWidth="1.4" />
      </g>
    </svg>
  );
}

/** Very light contour lines - the visual signature of the atlas theme. */
export function Contours({ className = "contour-bg" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 1200 600" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <g fill="none" stroke="#c9c1ae" strokeWidth="1">
        {Array.from({ length: 9 }, (_, i) => (
          <path key={i} d={`M-20 ${120 + i * 48} C 220 ${60 + i * 52}, 380 ${220 + i * 40}, 620 ${150 + i * 46} S 980 ${80 + i * 50}, 1220 ${170 + i * 44}`} opacity={0.65 - i * 0.05} />
        ))}
        {Array.from({ length: 5 }, (_, i) => (
          <ellipse key={`e${i}`} cx="940" cy="150" rx={40 + i * 34} ry={22 + i * 20} opacity={0.5 - i * 0.07} />
        ))}
      </g>
    </svg>
  );
}
