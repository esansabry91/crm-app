import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import { VIZ } from '../../utils/vizColors';
import { formatRM } from '../../utils/format';

export default function PipelineVsWonChart({
  openValue,
  wonValue,
}: {
  openValue: number;
  wonValue: number;
}) {
  const data = [
    { name: 'Open Pipeline Value', value: openValue },
    { name: 'Won Value', value: wonValue },
  ];

  return (
    <ResponsiveContainer width="100%" height={140}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 90, bottom: 0, left: 8 }}>
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="name"
          width={130}
          tick={{ fontSize: 12, fill: VIZ.ink.secondary }}
          axisLine={false}
          tickLine={false}
        />
        <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={36}>
          <Cell fill={VIZ.categorical.blue} />
          <Cell fill={VIZ.status.good} />
          <LabelList
            dataKey="value"
            position="right"
            formatter={(v: unknown) => formatRM(Number(v))}
            style={{ fontSize: 12, fill: VIZ.ink.primary, fontWeight: 600 }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
