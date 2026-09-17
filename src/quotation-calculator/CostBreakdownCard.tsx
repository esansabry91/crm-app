import type { QuotationCalculator } from './useQuotationCalculator';
import { Card } from './ui';
import { fmt } from './format';

const ITEMS: { label: string; key: 'basic' | 'allowPay' | 'otPay' | 'rdPay' | 'rdOtPay' | 'phPay' | 'phOtPay' | 'epfAmt' | 'socsoAmt' | 'eisAmt'; color: string }[] = [
  { label: 'Basic Salary', key: 'basic', color: '#1f4e78' },
  { label: 'Allowance', key: 'allowPay', color: '#7c3aed' },
  { label: 'Overtime', key: 'otPay', color: '#2e75b6' },
  { label: 'Rest Day', key: 'rdPay', color: '#5b9bd5' },
  { label: 'Rest Day OT', key: 'rdOtPay', color: '#9dc3e6' },
  { label: 'Public Holiday', key: 'phPay', color: '#c55a11' },
  { label: 'Public Holiday OT', key: 'phOtPay', color: '#f4b183' },
  { label: 'EPF', key: 'epfAmt', color: '#548235' },
  { label: 'SOCSO', key: 'socsoAmt', color: '#a9d18e' },
  { label: 'EIS', key: 'eisAmt', color: '#d6e4c8' },
];

export default function CostBreakdownCard({ calc }: { calc: QuotationCalculator }) {
  const { result } = calc;
  const total = result.costGuardPP;
  const segments = ITEMS.map((it) => ({ ...it, amt: result[it.key] }))
    .filter((it) => isFinite(it.amt) && it.amt > 0)
    .map((it) => ({ ...it, share: total > 0 ? it.amt / total : 0 }));

  return (
    <Card title={`Cost Breakdown - One Guard per ${result.dayBasis ? 'Day' : 'Month'}`}>
      <div className="flex h-7 w-full rounded-lg overflow-hidden border border-slate-200 shadow-inner">
        {segments.map((s) => (
          <div key={s.label} title={`${s.label}: RM ${fmt(s.amt, 2)} (${(s.share * 100).toFixed(1)}%)`} style={{ width: `${s.share * 100}%`, background: s.color }} className="h-full transition-all" />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-3.5 sm:grid-cols-2">
        {segments.map((s) => (
          <div key={s.label} className="flex items-center gap-2 text-[12.5px] py-1 px-1.5 rounded hover:bg-slate-50">
            <span className="w-3 h-3 rounded-sm shrink-0 ring-1 ring-black/5" style={{ background: s.color }} />
            <span className="flex-1 text-slate-600">{s.label}</span>
            <span className="tabular-nums text-slate-500">
              {fmt(s.amt, 2)} ({(s.share * 100).toFixed(1)}%)
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}
