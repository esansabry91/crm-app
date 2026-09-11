import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { TrendPoint } from '../../utils/analytics';
import { VIZ } from '../../utils/vizColors';
import { formatRM } from '../../utils/format';

export default function PipelineTrendChart({ data }: { data: TrendPoint[] }) {
  if (data.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center text-sm text-slate-400">
        No pipeline activity yet — register a tender to start the trend.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={280}>
      <AreaChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={VIZ.chrome.gridline} vertical={false} />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 11, fill: VIZ.ink.muted }}
          axisLine={{ stroke: VIZ.chrome.baseline }}
          tickLine={false}
          minTickGap={24}
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
        <Area
          type="monotone"
          dataKey="openValue"
          name="Open pipeline value"
          stroke={VIZ.categorical.blue}
          strokeWidth={2}
          fill={VIZ.categorical.blue}
          fillOpacity={0.12}
          dot={false}
          activeDot={{ r: 4 }}
        />
        <Area
          type="monotone"
          dataKey="wonValue"
          name="Won value"
          stroke={VIZ.status.good}
          strokeWidth={2}
          fill={VIZ.status.good}
          fillOpacity={0.12}
          dot={false}
          activeDot={{ r: 4 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
