import type { PublicPlayer } from '@midnight/engine';
import { Portrait } from './ui';

/** A crow-stepped gable (the stair-edged roofline that makes a castle look Scottish). */
function crowSteps(cx: number, baseY: number, halfW: number, steps: number, stepH: number) {
  const w = halfW / steps;
  let d = `M ${cx - halfW} ${baseY}`;
  for (let i = 0; i < steps; i++)
    d += ` V ${baseY - (i + 1) * stepH} H ${cx - halfW + (i + 1) * w}`;
  for (let i = 1; i <= steps; i++) d += ` H ${cx + i * w} V ${baseY - (steps - i) * stepH}`;
  return d + ' Z';
}

const WINDOWS: [number, number][] = [
  [700, 520],
  [748, 520],
  [700, 575],
  [748, 575],
  [880, 430],
  [920, 430],
  [880, 490],
  [920, 490],
  [880, 550],
  [920, 550],
  [1060, 500],
  [1060, 560],
  [1130, 540],
  [1010, 600],
  [800, 610],
];

const PINES: [number, number, number][] = [
  [90, 760, 1.5],
  [160, 780, 1.1],
  [230, 770, 1.7],
  [330, 790, 1.2],
  [1330, 780, 1.4],
  [1410, 770, 1.8],
  [1490, 790, 1.2],
  [1560, 765, 1.6],
  [1260, 800, 1],
  [420, 800, 0.9],
];

function Pine({ x, y, s }: { x: number; y: number; s: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <path d="M0 -150 L26 -90 H12 L38 -40 H16 L46 0 H-46 L-16 -40 H-38 L-12 -90 H-26 Z" />
      <rect x="-5" y="0" width="10" height="26" />
    </g>
  );
}

/**
 * A Highland baronial castle on a hill above a loch, drawn as a silhouette against a moonlit sky:
 * conical turrets, crow-stepped gables, corbelled corner turrets, a few lit windows.
 */
export function CastleBackdrop({ night, dim }: { night: boolean; dim?: boolean }) {
  return (
    <div className={`backdrop ${night ? 'is-night' : ''} ${dim ? 'is-dim' : ''}`} aria-hidden>
      <svg viewBox="0 0 1600 900" preserveAspectRatio="xMidYMax slice">
        <defs>
          <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={night ? '#020307' : '#07080f'} />
            <stop offset="0.55" stopColor={night ? '#0b0d1a' : '#1a1020'} />
            <stop offset="1" stopColor={night ? '#171a2a' : '#3a1a22'} />
          </linearGradient>
          <radialGradient id="moonGlow" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor="#f3e7c2" stopOpacity="0.55" />
            <stop offset="1" stopColor="#f3e7c2" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="loch" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#1b2030" />
            <stop offset="1" stopColor="#05060b" />
          </linearGradient>
          <filter id="blur" x="-20%" y="-50%" width="140%" height="200%">
            <feGaussianBlur stdDeviation="22" />
          </filter>
        </defs>

        <rect width="1600" height="900" fill="url(#sky)" />
        {/* stars */}
        <g fill="#efe3c0" opacity="0.7">
          {Array.from({ length: 46 }, (_, i) => (
            <circle
              key={i}
              cx={(i * 211) % 1600}
              cy={(i * 97) % 380}
              r={i % 5 === 0 ? 1.8 : 1}
              className="star"
              style={{ animationDelay: `${(i % 7) * 0.7}s` }}
            />
          ))}
        </g>
        {/* moon */}
        <circle cx="1380" cy="170" r="190" fill="url(#moonGlow)" />
        <circle cx="1380" cy="170" r="52" fill="#f4ead0" />
        <circle cx="1362" cy="156" r="9" fill="#d9cba5" opacity="0.7" />
        <circle cx="1398" cy="188" r="6" fill="#d9cba5" opacity="0.6" />

        {/* far ridges */}
        <path
          d="M0 560 L120 500 L240 540 L380 470 L520 530 L640 480 L820 560 L980 500 L1120 540 L1260 470 L1420 540 L1600 490 V900 H0 Z"
          fill="#141524"
        />
        <path
          d="M0 640 L160 590 L300 625 L470 570 L620 620 L800 600 L980 650 L1180 600 L1350 640 L1600 590 V900 H0 Z"
          fill="#0d0e19"
        />

        {/* the hill */}
        <path
          d="M300 800 C 480 720, 560 650, 640 640 L1200 640 C 1300 660, 1380 740, 1500 800 Z"
          fill="#07080e"
        />

        {/* castle */}
        <g fill="#05060a">
          {/* main hall */}
          <rect x="640" y="520" width="360" height="130" />
          <path d="M630 520 L820 440 L1010 520 Z" />
          {/* tall central keep with crow-stepped gable */}
          <rect x="840" y="400" width="120" height="250" />
          <path d={crowSteps(900, 400, 66, 4, 16)} />
          {/* round tower, left, conical roof */}
          <rect x="620" y="470" width="86" height="180" />
          <path d="M608 472 L663 360 L718 472 Z" />
          <rect x="661" y="338" width="3" height="26" />
          {/* corbelled corner turrets */}
          <path d="M700 470 q-16 0 -16 16 v20 h32 v-20 q0 -16 -16 -16 Z" />
          <path d="M676 462 L700 412 L724 462 Z" transform="translate(30 20)" />
          {/* east wing with tall square tower */}
          <rect x="990" y="470" width="190" height="180" />
          <rect x="1020" y="420" width="90" height="230" />
          <path d="M1008 422 L1065 330 L1122 422 Z" />
          <path d={crowSteps(1135, 470, 46, 3, 14)} />
          {/* little north turret */}
          <rect x="960" y="380" width="46" height="30" />
          <path d="M954 380 L983 330 L1012 380 Z" />
          {/* chimneys */}
          <rect x="760" y="476" width="14" height="34" />
          <rect x="1150" y="420" width="14" height="34" />
          {/* flag */}
          <rect x="1064" y="298" width="3" height="40" />
          <path className="flag" d="M1067 300 l34 8 l-34 10 Z" fill="#7a1022" />
        </g>
        {/* lit windows */}
        <g fill="#f0c25a">
          {WINDOWS.map(([x, y], i) => (
            <rect
              key={i}
              x={x}
              y={y}
              width="12"
              height="22"
              rx="6"
              className="win"
              opacity={night ? (i % 3 === 0 ? 0.95 : 0) : 0.9}
              style={{ animationDelay: `${(i % 5) * 0.9}s` }}
            />
          ))}
        </g>

        {/* pines */}
        <g fill="#04050a">
          {PINES.map(([x, y, s], i) => (
            <Pine key={i} x={x} y={y} s={s} />
          ))}
        </g>

        {/* the loch */}
        <rect x="0" y="800" width="1600" height="100" fill="url(#loch)" />
        <ellipse cx="1380" cy="830" rx="100" ry="8" fill="#f3e7c2" opacity="0.14" />
        <ellipse cx="900" cy="830" rx="260" ry="18" fill="#05060a" opacity="0.55" />

        {/* mist */}
        <g filter="url(#blur)" fill="#aab0c8">
          <ellipse className="mist m1" cx="400" cy="700" rx="420" ry="40" opacity="0.18" />
          <ellipse className="mist m2" cx="1100" cy="740" rx="520" ry="46" opacity="0.2" />
          <ellipse className="mist m3" cx="800" cy="800" rx="700" ry="40" opacity="0.16" />
        </g>
      </svg>
      <div className="vignette" />
    </div>
  );
}

/** Where each seat sits, as percentages of the table's box. */
function seatPos(i: number, n: number, r: number) {
  const a = (i / n) * Math.PI * 2 - Math.PI / 2;
  return { x: 50 + r * Math.cos(a), y: 50 + r * Math.sin(a) };
}

export type TableMark = {
  speaker?: string;
  /** The vote being shown right now: an arrow from voter to target. */
  arrow?: { from: string; to: string | null };
  /** Votes received per player, shown as daggers beside their seat. */
  tally?: Record<string, number>;
  /** Players who have locked in / said they are ready. */
  ready?: string[];
};

/** Everyone seated around a great oak round table, candlelit. */
export function RoundTable({ players, marks }: { players: PublicPlayer[]; marks?: TableMark }) {
  const n = Math.max(players.length, 1);
  const pos = new Map(players.map((p, i) => [p.id, seatPos(i, n, 41)]));
  const inner = new Map(players.map((p, i) => [p.id, seatPos(i, n, 22)]));
  const size = n > 12 ? 52 : n > 8 ? 62 : 74;
  const arrow = marks?.arrow;
  const from = arrow ? inner.get(arrow.from) : undefined;
  const to = arrow?.to ? inner.get(arrow.to) : undefined;
  return (
    <div className="rt">
      <svg className="rt-table" viewBox="0 0 100 100">
        <defs>
          <radialGradient id="oak" cx="0.5" cy="0.45" r="0.6">
            <stop offset="0" stopColor="#6a3b1d" />
            <stop offset="0.7" stopColor="#3b1f10" />
            <stop offset="1" stopColor="#1f0f08" />
          </radialGradient>
          <radialGradient id="candle" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor="#ffd98a" stopOpacity="0.55" />
            <stop offset="1" stopColor="#ffd98a" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx="50" cy="50" r="33" fill="url(#oak)" stroke="#120804" strokeWidth="1.2" />
        <circle
          cx="50"
          cy="50"
          r="30"
          fill="none"
          stroke="#c8a24a"
          strokeOpacity="0.55"
          strokeWidth="0.4"
        />
        <circle
          cx="50"
          cy="50"
          r="12"
          fill="none"
          stroke="#c8a24a"
          strokeOpacity="0.4"
          strokeWidth="0.3"
        />
        {/* wood grain */}
        {Array.from({ length: 9 }, (_, i) => (
          <path
            key={i}
            d={`M ${22 + i * 7} ${22 + ((i * 5) % 11)} Q 50 ${50 + (i - 4) * 4} ${78 - i * 7} ${78 - ((i * 3) % 9)}`}
            stroke="#1a0b05"
            strokeOpacity="0.14"
            strokeWidth="0.25"
            fill="none"
          />
        ))}
        <circle cx="50" cy="50" r="18" fill="url(#candle)" />
        {/* centre candelabra */}
        <rect x="49.4" y="47" width="1.2" height="6" fill="#e8dcc0" />
        <ellipse className="flame" cx="50" cy="46.2" rx="1" ry="1.9" fill="#ffc45e" />
        {from && (
          <line
            className="arrow"
            x1={from.x}
            y1={from.y}
            x2={to ? to.x : from.x}
            y2={to ? to.y : from.y}
            stroke={to ? '#d33a4c' : '#8a8a96'}
            strokeWidth="0.8"
            strokeLinecap="round"
          />
        )}
      </svg>
      {players.map((p) => {
        const s = pos.get(p.id);
        if (!s) return null;
        const dead = p.fate !== 'alive';
        const tally = marks?.tally?.[p.id] ?? 0;
        const cls = [
          'rt-seat',
          dead ? 'is-dead' : '',
          marks?.speaker === p.id ? 'is-speaking' : '',
          arrow?.from === p.id ? 'is-voter' : '',
          arrow?.to === p.id ? 'is-target' : '',
          marks?.ready?.includes(p.id) ? 'is-ready' : '',
        ].join(' ');
        return (
          <div key={p.id} className={cls} style={{ left: `${s.x}%`, top: `${s.y}%` }}>
            <Portrait p={p} size={size} />
            <div className="rt-name">{p.name}</div>
            {tally > 0 && (
              <div className="rt-tally" aria-label={`${tally} votes`}>
                {Array.from({ length: tally }, (_, i) => (
                  <Dagger key={i} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function Dagger({ size = 18 }: { size?: number }) {
  return (
    <svg width={size * 0.4} height={size} viewBox="0 0 8 24" aria-hidden className="dagger">
      <path d="M4 0 L7 13 H1 Z" fill="#d9dbe3" />
      <rect x="0" y="13" width="8" height="2" fill="#c8a24a" />
      <rect x="3" y="15" width="2" height="6" fill="#6e1423" />
      <circle cx="4" cy="22.5" r="1.5" fill="#c8a24a" />
    </svg>
  );
}

/** The hooded figure from the title screen. */
export function HoodedFigure({ size = 120 }: { size?: number }) {
  return (
    <svg width={size} height={size * 1.25} viewBox="0 0 120 150" aria-hidden className="hood">
      <defs>
        <linearGradient id="cloak" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#24503a" />
          <stop offset="1" stopColor="#0c1f16" />
        </linearGradient>
      </defs>
      <path
        d="M60 6 C 30 6, 22 40, 24 62 C 14 90, 6 120, 4 148 H116 C 114 120, 106 90, 96 62 C 98 40, 90 6, 60 6 Z"
        fill="url(#cloak)"
        stroke="#0a1812"
        strokeWidth="2"
      />
      <path
        d="M60 22 C 42 22, 38 44, 40 62 C 44 80, 76 80, 80 62 C 82 44, 78 22, 60 22 Z"
        fill="#050806"
      />
      <path d="M60 80 L60 148" stroke="#0a1812" strokeWidth="2" opacity="0.7" />
      <circle cx="52" cy="54" r="1.6" fill="#c8a24a" opacity="0.8" />
      <circle cx="68" cy="54" r="1.6" fill="#c8a24a" opacity="0.8" />
    </svg>
  );
}

export function Ornament() {
  return (
    <div className="ornament" aria-hidden>
      <span />
      <Dagger size={22} />
      <span />
    </div>
  );
}
