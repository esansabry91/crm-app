/**
 * The pop-up when every task of a day is ticked off. Each weekday has its own celebration:
 * Monday confetti, Tuesday fireworks, Wednesday balloons, Thursday a trophy, Friday party
 * poppers, Saturday shooting stars and Sunday a gold medal. Closes on click, Escape, or after a
 * few seconds. Reduced-motion users get the card without the moving parts. Ported verbatim
 * (particle generation untouched) from gdsb-portal's apps/web/src/pages/workspace/Celebration.tsx
 * — only the Tailwind tokens were swapped for crm-app's own (no custom "ink"/"panel"/"accent"
 * theme here, just plain slate/blue).
 */
import { useEffect, useMemo, type CSSProperties } from 'react';

const COLORS = ['#1d8a6a', '#eb6834', '#3d6fb6', '#d9a520', '#c2417a', '#6cb758', '#8e5cc4'];

const STYLES = [
  { title: 'Monday, done!', note: 'Confetti for a strong start to the week.' },
  { title: 'Tuesday, nailed it!', note: 'Fireworks for a full day ticked off.' },
  { title: 'Wednesday, all clear!', note: 'Halfway through the week and right on track.' },
  { title: 'Thursday champion!', note: 'Every task done. The trophy is yours.' },
  { title: 'Friday, party time!', note: 'A clean finish to the working week.' },
  { title: 'Saturday star!', note: 'Done, even on a Saturday. Shooting stars for you.' },
  { title: 'Sunday gold!', note: 'Every task done. Gold medal performance.' },
] as const;

/** Small deterministic random numbers, so each render of a style looks the same. */
function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

type Bit = { style: CSSProperties; className: string; shape: 'rect' | 'circle' | 'star' | 'balloon' | 'streak' };

function bitsFor(day: number): Bit[] {
  const r = seeded(17 + day * 31);
  const color = () => COLORS[Math.floor(r() * COLORS.length)]!;
  const v = (k: string, val: string) => ({ [k]: val }) as CSSProperties;
  switch (day) {
    case 0: // confetti rain
      return Array.from({ length: 70 }, () => ({
        className: 'cel-bit cel-fall',
        shape: 'rect',
        style: {
          left: `${r() * 100}%`,
          top: 0,
          width: 7 + r() * 5,
          height: 10 + r() * 6,
          background: color(),
          borderRadius: 2,
          animationDuration: `${2.2 + r() * 1.6}s`,
          animationDelay: `${r() * 0.9}s`,
          ...v('--dx', `${(r() - 0.5) * 30}vw`),
          ...v('--rot', `${(r() - 0.5) * 1080}deg`),
        },
      }));
    case 1: // fireworks: three bursts
      return [
        [25, 30],
        [72, 24],
        [50, 55],
      ].flatMap(([x, y], b) =>
        Array.from({ length: 22 }, (_, i) => {
          const a = (i / 22) * Math.PI * 2;
          const d = 14 + r() * 8;
          const c = COLORS[(b * 2 + (i % 2)) % COLORS.length]!;
          return {
            className: 'cel-bit cel-burst',
            shape: 'circle' as const,
            style: {
              left: `${x}%`,
              top: `${y}%`,
              width: 7,
              height: 7,
              borderRadius: 999,
              background: c,
              boxShadow: `0 0 8px ${c}`,
              animationDuration: '1.3s',
              animationDelay: `${b * 0.45}s`,
              ...v('--dx', `${Math.cos(a) * d}vw`),
              ...v('--dy', `${Math.sin(a) * d}vh`),
            },
          };
        }),
      );
    case 2: // balloons
      return Array.from({ length: 16 }, () => ({
        className: 'cel-bit cel-rise',
        shape: 'balloon',
        style: {
          left: `${4 + r() * 92}%`,
          top: '100%',
          width: 34 + r() * 14,
          height: 44 + r() * 16,
          color: color(),
          animationDuration: `${3.2 + r() * 1.8}s`,
          animationDelay: `${r() * 1.2}s`,
          ...v('--dx', `${(r() - 0.5) * 12}vw`),
        },
      }));
    case 3: // trophy sparkles
    case 6: // medal sparkles
      return Array.from({ length: 18 }, () => ({
        className: 'cel-bit cel-twinkle',
        shape: 'star',
        style: {
          left: `${30 + r() * 40}%`,
          top: `${12 + r() * 50}%`,
          width: 14 + r() * 12,
          height: 14 + r() * 12,
          color: day === 3 ? '#d9a520' : r() > 0.5 ? '#d9a520' : '#ffffff',
          animationDuration: `${0.9 + r() * 0.6}s`,
          animationDelay: `${0.4 + r() * 1.2}s`,
        },
      }));
    case 4: // party poppers from the two bottom corners
      return [0, 1].flatMap((side) =>
        Array.from({ length: 34 }, () => {
          const up = 45 + r() * 40;
          const across = (10 + r() * 45) * (side ? -1 : 1);
          const streamer = r() > 0.5;
          return {
            className: 'cel-bit cel-pop',
            shape: 'rect' as const,
            style: {
              left: side ? '96%' : '4%',
              top: '96%',
              width: streamer ? 4 : 8,
              height: streamer ? 22 : 8,
              borderRadius: streamer ? 2 : 999,
              background: color(),
              animationDuration: `${1.8 + r() * 0.8}s`,
              animationDelay: `${r() * 0.3}s`,
              ...v('--dx', `${across}vw`),
              ...v('--dy', `${-up}vh`),
              ...v('--rot', `${(r() - 0.5) * 720}deg`),
            },
          };
        }),
      );
    case 5: // shooting stars plus twinkles
      return [
        ...Array.from({ length: 9 }, () => ({
          className: 'cel-bit cel-shoot',
          shape: 'streak' as const,
          style: {
            left: `${50 + r() * 50}%`,
            top: `${r() * 35}%`,
            width: 120,
            height: 3,
            animationDuration: `${0.9 + r() * 0.5}s`,
            animationDelay: `${r() * 2}s`,
          },
        })),
        ...Array.from({ length: 22 }, () => ({
          className: 'cel-bit cel-twinkle',
          shape: 'star' as const,
          style: {
            left: `${r() * 100}%`,
            top: `${r() * 80}%`,
            width: 10 + r() * 10,
            height: 10 + r() * 10,
            color: r() > 0.4 ? '#ffe9a8' : '#ffffff',
            animationDuration: `${0.8 + r() * 0.8}s`,
            animationDelay: `${r() * 1.5}s`,
          },
        })),
      ];
    default:
      return [];
  }
}

function Shape({ bit }: { bit: Bit }) {
  if (bit.shape === 'star')
    return (
      <svg viewBox="-10 -10 20 20" className={bit.className} style={bit.style} aria-hidden>
        <path d="M0 -10 L2.4 -2.4 L10 0 L2.4 2.4 L0 10 L-2.4 2.4 L-10 0 L-2.4 -2.4 Z" fill="currentColor" />
      </svg>
    );
  if (bit.shape === 'balloon')
    return (
      <svg viewBox="0 0 40 60" className={bit.className} style={bit.style} aria-hidden>
        <ellipse cx={20} cy={20} rx={17} ry={20} fill="currentColor" />
        <ellipse cx={13} cy={12} rx={4} ry={6} fill="#ffffff" opacity={0.35} />
        <path d="M18 40 L22 40 L20 44 Z" fill="currentColor" />
        <path d="M20 44 C16 50 24 54 20 60" stroke="#8a8f8c" strokeWidth={1} fill="none" />
      </svg>
    );
  if (bit.shape === 'streak')
    return (
      <span
        className={bit.className}
        style={{ ...bit.style, borderRadius: 3, background: 'linear-gradient(90deg, #ffffff, rgba(255,255,255,0))' }}
        aria-hidden
      />
    );
  return <span className={bit.className} style={bit.style} aria-hidden />;
}

function Trophy() {
  return (
    <svg viewBox="0 0 120 120" width={120} height={120} className="cel-rise-in mx-auto" aria-hidden>
      <path d="M30 18 H90 V44 C90 66 76 78 60 78 C44 78 30 66 30 44 Z" fill="#d9a520" />
      <path d="M30 26 H16 C16 46 24 54 34 56" stroke="#d9a520" strokeWidth={6} fill="none" strokeLinecap="round" />
      <path d="M90 26 H104 C104 46 96 54 86 56" stroke="#d9a520" strokeWidth={6} fill="none" strokeLinecap="round" />
      <rect x={52} y={76} width={16} height={16} fill="#b8861b" />
      <rect x={38} y={92} width={44} height={12} rx={3} fill="#6b4f2a" />
      <path d="M44 24 C44 40 48 52 56 60" stroke="#fff3c4" strokeWidth={4} fill="none" strokeLinecap="round" opacity={0.7} />
      <text x={60} y={53} textAnchor="middle" fontSize={20} fontWeight={700} fill="#fff7dc">
        1
      </text>
    </svg>
  );
}

function Medal() {
  return (
    <div className="relative mx-auto h-[150px] w-[150px]">
      <svg viewBox="-75 -75 150 150" width={150} height={150} className="cel-spin absolute inset-0" aria-hidden>
        {Array.from({ length: 12 }, (_, i) => (
          <path key={i} d="M0 0 L-6 -72 L6 -72 Z" fill="#f6d77a" opacity={0.35} transform={`rotate(${i * 30})`} />
        ))}
      </svg>
      <svg viewBox="0 0 100 140" width={100} height={140} className="cel-swing absolute left-[25px] top-0" aria-hidden>
        <path d="M30 0 L50 60 L70 0 Z" fill="#c2417a" />
        <path d="M40 0 L50 32 L60 0 Z" fill="#3d6fb6" />
        <circle cx={50} cy={90} r={34} fill="#d9a520" stroke="#b8861b" strokeWidth={5} />
        <path d="M50 70 L55.9 82 L69 83.8 L59.5 93 L61.8 106 L50 99.8 L38.2 106 L40.5 93 L31 83.8 L44.1 82 Z" fill="#fff3c4" />
      </svg>
    </div>
  );
}

/** `weekday`: 0 = Monday … 6 = Sunday (see weekdayIndex() in utils/workspaceDates.ts). */
export function Celebration({ weekday, dayLabel, taskCount, onClose }: { weekday: number; dayLabel: string; taskCount: number; onClose: () => void }) {
  const bits = useMemo(() => bitsFor(weekday), [weekday]);
  const style = STYLES[weekday] ?? STYLES[0];
  const dark = weekday === 1 || weekday === 5;
  useEffect(() => {
    const t = window.setTimeout(onClose, 5200);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={style.title}
      onClick={onClose}
      className={`fixed inset-0 z-50 flex items-center justify-center overflow-hidden px-4 ${dark ? 'bg-[#0d1426]/75' : 'bg-black/25'}`}
    >
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {bits.map((b, i) => (
          <Shape key={i} bit={b} />
        ))}
      </div>
      <div className="cel-card relative w-full max-w-sm rounded-2xl border border-slate-200 bg-white px-6 py-6 text-center shadow-2xl">
        {weekday === 3 ? <Trophy /> : weekday === 6 ? <Medal /> : null}
        <p className="text-2xl font-semibold text-slate-900">{style.title}</p>
        <p className="mt-2 text-sm text-slate-700">
          {taskCount === 1 ? `Your task for ${dayLabel} is done.` : `All ${taskCount} tasks for ${dayLabel} done.`}
        </p>
        <p className="mt-1 text-sm text-slate-400">{style.note}</p>
        <button
          type="button"
          onClick={onClose}
          className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
        >
          Keep going
        </button>
      </div>
    </div>
  );
}
