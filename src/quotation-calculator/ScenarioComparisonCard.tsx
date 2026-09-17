import type { QuotationCalculator } from './useQuotationCalculator';
import type { EngineResult } from './types';
import { Btn, Card, Note } from './ui';
import { cellText } from './format';

const METRICS: { label: string; key: keyof EngineResult; dp: number }[] = [
  { label: 'Basic salary (RM)', key: 'basic', dp: 0 },
  { label: 'Guards used', key: 'guards', dp: 0 },
  { label: 'Cost per guard per period (RM)', key: 'costGuardPP', dp: 2 },
  { label: 'Billing cost / hour (RM)', key: 'cpmBill', dp: 4 },
  { label: 'Quoted rate (RM/hr)', key: 'quote', dp: 4 },
  { label: 'Gross margin', key: 'margin', dp: -1 },
  { label: 'Revenue per period (RM)', key: 'revenuePP', dp: 2 },
  { label: 'Gross profit per period (RM)', key: 'profitPP', dp: 2 },
  { label: 'Contract revenue (RM)', key: 'contractRevenue', dp: 0 },
  { label: 'Contract gross profit (RM)', key: 'contractProfit', dp: 0 },
];

const SCEN_NAMES = ['Base', 'Best', 'Worst'] as const;

export default function ScenarioComparisonCard({ calc }: { calc: QuotationCalculator }) {
  const { result, scenarios, saveScenario, clearScenarios, loadScenario } = calc;

  return (
    <Card title="Scenario Comparison">
      <div className="flex gap-2 flex-wrap">
        <Btn onClick={() => saveScenario(0)}>Save as Base</Btn>
        <Btn onClick={() => saveScenario(1)}>Save as Best</Btn>
        <Btn onClick={() => saveScenario(2)}>Save as Worst</Btn>
        <Btn onClick={clearScenarios}>Clear all</Btn>
      </div>

      <div className="overflow-x-auto mt-3 rounded-lg border border-slate-200">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="bg-slate-50 text-slate-500 text-[10.5px] uppercase tracking-wide">
              <th className="text-left font-semibold py-1.5 px-2">Metric</th>
              <th className="text-right font-semibold py-1.5 px-2">Current</th>
              {SCEN_NAMES.map((name, i) => (
                <th key={name} className="text-right font-semibold py-1.5 px-2">
                  {name}
                  {!scenarios[i] && ' (empty)'}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {METRICS.map((m) => (
              <tr key={m.key} className="border-t border-slate-100 tabular-nums">
                <td className="text-left py-1.5 px-2 text-slate-600">{m.label}</td>
                <td className="text-right py-1.5 px-2">{cellText(result[m.key] as number, m.dp)}</td>
                {[0, 1, 2].map((s) => {
                  const snap = scenarios[s];
                  if (!snap) return (
                    <td key={s} className="text-right py-1.5 px-2 text-slate-300">
                      -
                    </td>
                  );
                  const val = snap.result[m.key] as number;
                  const base = scenarios[0];
                  const delta = s > 0 && base ? val - (base.result[m.key] as number) : null;
                  const showDelta = delta !== null && isFinite(delta) && Math.abs(delta) > 0.0000001;
                  return (
                    <td key={s} className="text-right py-1.5 px-2">
                      {cellText(val, m.dp)}
                      {showDelta && (
                        <span className={'block text-[10.5px] font-medium ' + (delta! > 0 ? 'text-rose-600' : 'text-emerald-600')}>
                          {delta! > 0 ? '+' : ''}
                          {cellText(delta, m.dp)}
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex gap-2 flex-wrap mt-3">
        <Btn onClick={() => loadScenario(0)}>Load Base</Btn>
        <Btn onClick={() => loadScenario(1)}>Load Best</Btn>
        <Btn onClick={() => loadScenario(2)}>Load Worst</Btn>
      </div>
      <Note>Best and Worst show the difference against Base underneath each figure. Scenarios live in this browser tab only and are lost when you refresh.</Note>
    </Card>
  );
}
