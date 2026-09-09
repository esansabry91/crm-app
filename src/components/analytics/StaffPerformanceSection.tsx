import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { StaffPerformanceRow } from '../../utils/analytics';
import { VIZ } from '../../utils/vizColors';
import { formatRM } from '../../utils/format';

export default function StaffPerformanceSection({ rows }: { rows: StaffPerformanceRow[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-slate-400 py-8 text-center">No tenders registered yet.</p>;
  }

  const chartData = [...rows].sort((a, b) => b.wonValue - a.wonValue);

  return (
    <div className="space-y-5">
      <ResponsiveContainer width="100%" height={Math.max(160, chartData.length * 42)}>
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ top: 0, right: 70, bottom: 0, left: 8 }}
        >
          <CartesianGrid stroke={VIZ.chrome.gridline} horizontal={false} />
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="ownerName"
            width={110}
            tick={{ fontSize: 12, fill: VIZ.ink.secondary }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            formatter={(value) => formatRM(Number(value))}
            contentStyle={{ fontSize: 12, borderRadius: 8, borderColor: VIZ.chrome.gridline }}
          />
          <Bar dataKey="wonValue" name="Won value" fill={VIZ.categorical.blue} radius={[0, 4, 4, 0]} maxBarSize={22}>
            <LabelList
              dataKey="wonValue"
              position="right"
              formatter={(v: unknown) => formatRM(Number(v))}
              style={{ fontSize: 11, fill: VIZ.ink.secondary }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-400 border-b border-slate-100">
              <th className="py-2 pr-4 font-medium">Staff</th>
              <th className="py-2 pr-4 font-medium text-right">Total Tenders</th>
              <th className="py-2 pr-4 font-medium text-right">Total Value</th>
              <th className="py-2 pr-4 font-medium text-right">Won</th>
              <th className="py-2 pr-4 font-medium text-right">Won Value</th>
              <th className="py-2 pr-4 font-medium text-right">Lost</th>
              <th className="py-2 font-medium text-right">Win Rate</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.ownerUid} className="border-b border-slate-50 last:border-0">
                <td className="py-2 pr-4 font-medium text-slate-800">{r.ownerName}</td>
                <td className="py-2 pr-4 text-right tabular-nums">{r.totalCount}</td>
                <td className="py-2 pr-4 text-right tabular-nums">{formatRM(r.totalValue)}</td>
                <td className="py-2 pr-4 text-right tabular-nums text-emerald-700">{r.wonCount}</td>
                <td className="py-2 pr-4 text-right tabular-nums text-emerald-700">{formatRM(r.wonValue)}</td>
                <td className="py-2 pr-4 text-right tabular-nums text-rose-600">{r.lostCount}</td>
                <td className="py-2 text-right tabular-nums">{Math.round(r.winRate * 100)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
