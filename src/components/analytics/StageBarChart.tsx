import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { StageBreakdownRow } from '../../utils/analytics';
import { VIZ } from '../../utils/vizColors';
import { formatRM } from '../../utils/format';

function colorForStage(stage: string) {
  if (stage === 'Won') return VIZ.status.good;
  if (stage === 'Lost') return VIZ.status.critical;
  return VIZ.categorical.blue;
}

export default function StageBarChart({
  data,
  metric,
}: {
  data: StageBreakdownRow[];
  metric: 'count' | 'value';
}) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 20, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={VIZ.chrome.gridline} vertical={false} />
        <XAxis
          dataKey="stage"
          tick={{ fontSize: 10.5, fill: VIZ.ink.muted }}
          axisLine={{ stroke: VIZ.chrome.baseline }}
          tickLine={false}
          interval={0}
          angle={-20}
          textAnchor="end"
          height={50}
        />
        <YAxis hide />
        <Tooltip
          formatter={(value) => (metric === 'value' ? formatRM(Number(value)) : value)}
          contentStyle={{ fontSize: 12, borderRadius: 8, borderColor: VIZ.chrome.gridline }}
        />
        <Bar dataKey={metric} radius={[4, 4, 0, 0]} maxBarSize={44}>
          {data.map((row) => (
            <Cell key={row.stage} fill={colorForStage(row.stage)} />
          ))}
          <LabelList
            dataKey={metric}
            position="top"
            formatter={(v: unknown) => (metric === 'value' ? formatRM(Number(v)) : String(v))}
            style={{ fontSize: 10.5, fill: VIZ.ink.secondary }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
