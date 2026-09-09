import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { BrandBreakdownRow } from '../../utils/analytics';
import { VIZ } from '../../utils/vizColors';
import { formatRM } from '../../utils/format';

export default function BrandBreakdownSection({ rows }: { rows: BrandBreakdownRow[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-slate-400 py-8 text-center">No tenders registered yet.</p>;
  }

  return (
    <div className="space-y-5">
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={VIZ.chrome.gridline} vertical={false} />
          <XAxis
            dataKey="brandName"
            tick={{ fontSize: 12, fill: VIZ.ink.muted }}
            axisLine={{ stroke: VIZ.chrome.baseline }}
            tickLine={false}
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
          <Bar dataKey="submittedValue" name="Total submitted" fill={VIZ.categorical.blue} radius={[4, 4, 0, 0]} maxBarSize={38} />
          <Bar dataKey="wonValue" name="Won" fill={VIZ.status.good} radius={[4, 4, 0, 0]} maxBarSize={38} />
          <Bar dataKey="lostValue" name="Lost" fill={VIZ.status.critical} radius={[4, 4, 0, 0]} maxBarSize={38} />
        </BarChart>
      </ResponsiveContainer>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-400 border-b border-slate-100">
              <th className="py-2 pr-4 font-medium">Brand</th>
              <th className="py-2 pr-4 font-medium text-right">Total Tenders</th>
              <th className="py-2 pr-4 font-medium text-right">Total Value</th>
              <th className="py-2 pr-4 font-medium text-right">Won</th>
              <th className="py-2 pr-4 font-medium text-right">Won Value</th>
              <th className="py-2 pr-4 font-medium text-right">Lost</th>
              <th className="py-2 font-medium text-right">Lost Value</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.brandId} className="border-b border-slate-50 last:border-0">
                <td className="py-2 pr-4 font-medium text-slate-800">{r.brandName}</td>
                <td className="py-2 pr-4 text-right tabular-nums">{r.submittedCount}</td>
                <td className="py-2 pr-4 text-right tabular-nums">{formatRM(r.submittedValue)}</td>
                <td className="py-2 pr-4 text-right tabular-nums text-emerald-700">{r.wonCount}</td>
                <td className="py-2 pr-4 text-right tabular-nums text-emerald-700">{formatRM(r.wonValue)}</td>
                <td className="py-2 pr-4 text-right tabular-nums text-rose-600">{r.lostCount}</td>
                <td className="py-2 text-right tabular-nums text-rose-600">{formatRM(r.lostValue)}</td>
              </tr>
            ))}
            <tr className="font-semibold text-slate-900">
              <td className="py-2 pr-4">Total (all brands)</td>
              <td className="py-2 pr-4 text-right tabular-nums">
                {rows.reduce((s, r) => s + r.submittedCount, 0)}
              </td>
              <td className="py-2 pr-4 text-right tabular-nums">
                {formatRM(rows.reduce((s, r) => s + r.submittedValue, 0))}
              </td>
              <td className="py-2 pr-4 text-right tabular-nums">{rows.reduce((s, r) => s + r.wonCount, 0)}</td>
              <td className="py-2 pr-4 text-right tabular-nums">
                {formatRM(rows.reduce((s, r) => s + r.wonValue, 0))}
              </td>
              <td className="py-2 pr-4 text-right tabular-nums">{rows.reduce((s, r) => s + r.lostCount, 0)}</td>
              <td className="py-2 text-right tabular-nums">
                {formatRM(rows.reduce((s, r) => s + r.lostValue, 0))}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
