import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useTranslation } from 'react-i18next';
import { VIZ } from '../../utils/vizColors';
import { formatRM } from '../../utils/format';

export interface OutstandingTrendChartPoint {
  key: string;
  label: string;
  outstanding: number;
}

/** Area chart of the total outstanding balance over time (see computeOutstandingTrend's doc
 *  comment in services/invoices.ts for how each point is reconstructed) — mirrors
 *  PipelineTrendChart's single-series Area styling (same VIZ palette, stroke/fill weights) so it
 *  reads as part of the same app. A single series needs no legend box — the chart's own title
 *  above it already names what's plotted. */
export default function OutstandingTrendChart({ data }: { data: OutstandingTrendChartPoint[] }) {
  const { t } = useTranslation();
  if (data.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center text-sm text-slate-400">
        {t('branchCollection.revenueTrendChart.empty')}
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={280}>
      <AreaChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={VIZ.chrome.gridline} vertical={false} />
        <XAxis
          dataKey="label"
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
        <Area
          type="monotone"
          dataKey="outstanding"
          name={t('branchCollection.outstandingTrendChart.totalOutstanding')}
          stroke={VIZ.status.warning}
          strokeWidth={2}
          fill={VIZ.status.warning}
          fillOpacity={0.16}
          dot={false}
          activeDot={{ r: 4 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
