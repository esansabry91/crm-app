import { useEffect, useRef, useState } from 'react';
import type { RaceFrame, RaceMetric, RaceTimeView } from '../../utils/analytics';
import { VIZ } from '../../utils/vizColors';
import { formatRM } from '../../utils/format';

const PALETTE = Object.values(VIZ.categorical);
const STEP_MS = 900;
const ROW_HEIGHT = 40;

const TIME_VIEWS: { value: RaceTimeView; label: string }[] = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'ytd', label: 'Year-to-Date' },
  { value: 'alltime', label: 'All-time' },
  { value: 'yearly', label: 'Yearly' },
];

const METRICS: { value: RaceMetric; label: string }[] = [
  { value: 'won', label: 'Won value' },
  { value: 'submitted', label: 'Total submitted' },
];

export default function RaceBarChart({
  frames,
  metric,
  timeView,
  onMetricChange,
  onTimeViewChange,
  colorDomain,
}: {
  frames: RaceFrame[];
  // Metric toggle is optional — charts with only one metric (e.g. Active Projects, which
  // always ranks by active project value) simply omit these two props and the toggle row
  // is left out entirely.
  metric?: RaceMetric;
  timeView: RaceTimeView;
  onMetricChange?: (m: RaceMetric) => void;
  onTimeViewChange: (v: RaceTimeView) => void;
  // A fixed, shared ordering of every department (e.g. ['HQ', ...branch names]) used to pick
  // each bar's color by that department's position in THIS list rather than its rank in the
  // current frame. Without this, the same branch can land on a different color in every chart
  // (or even every frame) purely because its ranking shifted — pass a stable domain so a branch
  // always renders in the same color everywhere it appears.
  colorDomain?: string[];
}) {
  const [frameIndex, setFrameIndex] = useState(Math.max(frames.length - 1, 0));
  const [playing, setPlaying] = useState(false);
  const timerRef = useRef<number | null>(null);

  // Whenever the underlying frames change (metric/time-view/data), land on the latest period.
  useEffect(() => {
    setPlaying(false);
    setFrameIndex(Math.max(frames.length - 1, 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frames]);

  useEffect(() => {
    if (!playing) return;
    if (frameIndex >= frames.length - 1) {
      setPlaying(false);
      return;
    }
    timerRef.current = window.setTimeout(() => setFrameIndex((i) => i + 1), STEP_MS);
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [playing, frameIndex, frames.length]);

  const frame: RaceFrame | undefined = frames[frameIndex];

  if (!frame) {
    return <p className="text-sm text-slate-400 py-8 text-center">No data yet for this view.</p>;
  }

  const departmentOrder = colorDomain ?? frames[frames.length - 1]?.bars.map((b) => b.department) ?? [];
  const colorFor = (dept: string) => {
    const idx = Math.max(departmentOrder.indexOf(dept), 0);
    return PALETTE[idx % PALETTE.length];
  };

  const maxValue = Math.max(1, ...frame.bars.map((b) => b.value));
  const handlePlay = () => {
    if (frameIndex >= frames.length - 1) setFrameIndex(0);
    setPlaying(true);
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1">
          {TIME_VIEWS.map((tv) => (
            <button
              key={tv.value}
              onClick={() => onTimeViewChange(tv.value)}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition ${
                timeView === tv.value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {tv.label}
            </button>
          ))}
        </div>
        {onMetricChange && (
          <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1">
            {METRICS.map((mtc) => (
              <button
                key={mtc.value}
                onClick={() => onMetricChange(mtc.value)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition ${
                  metric === mtc.value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {mtc.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="relative" style={{ height: frame.bars.length * ROW_HEIGHT }}>
        {frame.bars.map((bar, rank) => (
          <div
            key={bar.department}
            className="absolute inset-x-0 flex items-center gap-3 transition-all duration-500 ease-out"
            style={{ top: rank * ROW_HEIGHT, height: ROW_HEIGHT - 8 }}
          >
            <span className="w-6 shrink-0 text-[11px] font-semibold text-slate-400 text-right">{rank + 1}</span>
            <span className="w-24 shrink-0 text-xs font-medium text-slate-600 truncate">{bar.department}</span>
            <div className="flex-1 h-full bg-slate-50 rounded-md overflow-hidden">
              <div
                className="h-full rounded-md flex items-center justify-end px-2 transition-all duration-500 ease-out"
                style={{
                  width: `${Math.max((bar.value / maxValue) * 100, bar.value > 0 ? 3 : 0)}%`,
                  backgroundColor: colorFor(bar.department),
                }}
              >
                {bar.value > 0 && (
                  <span className="text-[10px] font-semibold text-white whitespace-nowrap">
                    {formatRM(bar.value)}
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3 mt-4 pt-3 border-t border-slate-100">
        <button
          onClick={playing ? () => setPlaying(false) : handlePlay}
          className="w-8 h-8 flex items-center justify-center rounded-full bg-blue-600 text-white hover:bg-blue-700 shrink-0 text-xs"
          title={playing ? 'Pause' : 'Play'}
        >
          {playing ? '❚❚' : '▶'}
        </button>
        <button
          onClick={() => {
            setPlaying(false);
            setFrameIndex((i) => Math.max(i - 1, 0));
          }}
          disabled={frameIndex === 0}
          className="text-xs font-medium text-slate-500 hover:text-slate-700 disabled:opacity-30"
        >
          ◀ Prev
        </button>
        <input
          type="range"
          min={0}
          max={Math.max(frames.length - 1, 0)}
          value={frameIndex}
          onChange={(e) => {
            setPlaying(false);
            setFrameIndex(Number(e.target.value));
          }}
          className="flex-1 accent-blue-600"
        />
        <button
          onClick={() => {
            setPlaying(false);
            setFrameIndex((i) => Math.min(i + 1, frames.length - 1));
          }}
          disabled={frameIndex === frames.length - 1}
          className="text-xs font-medium text-slate-500 hover:text-slate-700 disabled:opacity-30"
        >
          Next ▶
        </button>
        <span className="text-xs font-semibold text-slate-700 w-28 text-right shrink-0">{frame.periodLabel}</span>
      </div>
    </div>
  );
}
