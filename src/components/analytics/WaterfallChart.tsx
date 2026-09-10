import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { WaterfallBar } from '../../utils/analytics';
import { VIZ } from '../../utils/vizColors';
import { formatRM } from '../../utils/format';

interface ChartRow {
  name: string;
  base: number;
  display: number;
  amount: number;
  kind: 'total' | 'delta';
}

/** Turns signed bridge bars into stacked-bar rows: an invisible `base` segment (the running
 *  total this bar starts from) plus a visible `display` segment (its own height), so adjacent
 *  bars appear to float at their cumulative height — the classic waterfall look, built from a
 *  plain stacked bar chart rather than a dedicated chart type Recharts doesn't ship. */
function toChartRows(bars: WaterfallBar[]): ChartRow[] {
  let running = 0;
  return bars.map((b) => {
    if (b.kind === 'total') {
      running = b.amount;
      return { name: b.label, base: 0, display: Math.max(b.amount, 0), amount: b.amount, kind: b.kind };
    }
    const start = running;
    running += b.amount;
    return {
      name: b.label,
      base: Math.min(start, running),
      display: Math.abs(b.amount),
      amount: b.amount,
      kind: b.kind,
    };
  });
}

function colorFor(row: ChartRow): string {
  if (row.kind === 'total') return VIZ.categorical.blue;
  return row.amount >= 0 ? VIZ.status.good : VIZ.status.critical;
}

function BarTopLabel({
  x,
  y,
  width,
  index,
  rows,
  formatValue,
}: {
  x?: number;
  y?: number;
  width?: number;
  index?: number;
  rows: ChartRow[];
  formatValue: (v: number) => string;
}) {
  if (x == null || y == null || width == null || index == null) return null;
  const row = rows[index];
  if (!row || row.display === 0) return null;
  const text =
    row.kind === 'total'
      ? formatValue(row.amount)
      : row.amount >= 0
        ? `+${formatValue(row.amount)}`
        : `-${formatValue(Math.abs(row.amount))}`;
  return (
    <text x={x + width / 2} y={y - 6} textAnchor="middle" fontSize={10.5} fill={VIZ.ink.secondary}>
      {text}
    </text>
  );
}

function BridgeTooltip({
  active,
  payload,
  formatValue,
}: {
  active?: boolean;
  payload?: { payload: ChartRow }[];
  formatValue: (v: number) => string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0].payload;
  const text =
    row.kind === 'total'
      ? formatValue(row.amount)
      : row.amount >= 0
        ? `+${formatValue(row.amount)}`
        : `-${formatValue(Math.abs(row.amount))}`;
  return (
    <div
      style={{
        fontSize: 12,
        borderRadius: 8,
        border: `1px solid ${VIZ.chrome.gridline}`,
        background: '#fff',
        padding: '6px 10px',
      }}
    >
      <p style={{ color: VIZ.ink.muted, marginBottom: 2 }}>{row.name}</p>
      <p style={{ color: VIZ.ink.primary, fontWeight: 600 }}>{text}</p>
    </div>
  );
}

export default function WaterfallChart({
  bars,
  formatValue = formatRM,
}: {
  bars: WaterfallBar[];
  formatValue?: (v: number) => string;
}) {
  const rows = toChartRows(bars);

  if (rows.length === 0 || rows.every((r) => r.display === 0)) {
    return <p className="text-sm text-slate-400 py-8 text-center">No activity yet for this period.</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={rows} margin={{ top: 24, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={VIZ.chrome.gridline} vertical={false} />
        <XAxis
          dataKey="name"
          tick={{ fontSize: 10.5, fill: VIZ.ink.muted }}
          axisLine={{ stroke: VIZ.chrome.baseline }}
          tickLine={false}
          interval={0}
          angle={-20}
          textAnchor="end"
          height={56}
        />
        <YAxis hide />
        <Tooltip content={<BridgeTooltip formatValue={formatValue} />} cursor={{ fill: VIZ.chrome.gridline, opacity: 0.4 }} />
        <Bar dataKey="base" stackId="w" fill="transparent" isAnimationActive={false} />
        <Bar dataKey="display" stackId="w" radius={[4, 4, 4, 4]} maxBarSize={64} isAnimationActive={false}>
          {rows.map((row, i) => (
            <Cell key={row.name + i} fill={colorFor(row)} />
          ))}
          <LabelList
            dataKey="amount"
            content={(props: object) => <BarTopLabel {...props} rows={rows} formatValue={formatValue} />}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
