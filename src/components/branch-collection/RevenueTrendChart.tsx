import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { VIZ } from '../../utils/vizColors';
import { formatRM } from '../../utils/format';

export interface RevenueTrendPoint {
  key: string;
  label: string;
  revenue: number;
  discrepancy: number;
}

/** Bar chart of invoiced revenue vs. discrepancy over time, at whatever granularity the caller
 *  already rolled the data up to (monthly/quarterly/yearly) — this component only renders, it
 *  doesn't group. Mirrors PipelineTrendChart's look (same VIZ palette/axis conventions) so the
 *  Revenue tab reads as part of the same app rather than a bolted-on widget. */
export default function RevenueTrendChart({ data }: { data: RevenueTrendPoint[] }) {
  if (data.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center text-sm text-slate-400">
        No invoices yet — generate one to start the trend.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={VIZ.chrome.gridline} vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11, fill: VIZ.ink.muted }}
          axisLine={{ stroke: VIZ.chrome.baseline }}
          tickLine={false}
          minTickGap={16}
        />
        <YAxis
          tick={{ fontSize: 11, fill: VIZ.ink.muted }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => formatRM(v)}
          width={80}
        />
        <Tooltip
          formatter={(value) => formatRM(Number(value))}
          contentStyle={{ fontSize: 12, borderRadius: 8, borderColor: VIZ.chrome.gridline }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="revenue" name="Invoiced revenue" fill={VIZ.categorical.blue} radius={[4, 4, 0, 0]} maxBarSize={44} />
        <Bar dataKey="discrepancy" name="Discrepancy" fill={VIZ.status.warning} radius={[4, 4, 0, 0]} maxBarSize={44} />
      </BarChart>
    </ResponsiveContainer>
  );
}
