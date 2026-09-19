import { useTranslation } from 'react-i18next';
import type { QuotationCalculator } from './useQuotationCalculator';
import type { EngineResult } from './types';
import { Btn, Card, Note } from './ui';
import { cellText } from './format';

const METRICS: { labelKey: string; key: keyof EngineResult; dp: number }[] = [
  { labelKey: 'quotationCalculator.scenarioComparison.metricBasicSalary', key: 'basic', dp: 0 },
  { labelKey: 'quotationCalculator.scenarioComparison.metricGuardsUsed', key: 'guards', dp: 0 },
  { labelKey: 'quotationCalculator.scenarioComparison.metricCostPerGuardPerPeriod', key: 'costGuardPP', dp: 2 },
  { labelKey: 'quotationCalculator.scenarioComparison.metricBillingCostPerHour', key: 'cpmBill', dp: 4 },
  { labelKey: 'quotationCalculator.scenarioComparison.metricQuotedRate', key: 'quote', dp: 4 },
  { labelKey: 'quotationCalculator.scenarioComparison.metricGrossMargin', key: 'margin', dp: -1 },
  { labelKey: 'quotationCalculator.scenarioComparison.metricRevenuePerPeriod', key: 'revenuePP', dp: 2 },
  { labelKey: 'quotationCalculator.scenarioComparison.metricGrossProfitPerPeriod', key: 'profitPP', dp: 2 },
  { labelKey: 'quotationCalculator.scenarioComparison.metricContractRevenue', key: 'contractRevenue', dp: 0 },
  { labelKey: 'quotationCalculator.scenarioComparison.metricContractGrossProfit', key: 'contractProfit', dp: 0 },
];

const SCEN_NAME_KEYS = ['quotationCalculator.scenarioComparison.base', 'quotationCalculator.scenarioComparison.best', 'quotationCalculator.scenarioComparison.worst'] as const;

export default function ScenarioComparisonCard({ calc }: { calc: QuotationCalculator }) {
  const { t } = useTranslation();
  const { result, scenarios, saveScenario, clearScenarios, loadScenario } = calc;

  return (
    <Card title={t('quotationCalculator.scenarioComparison.title')}>
      <div className="flex gap-2 flex-wrap">
        <Btn onClick={() => saveScenario(0)}>{t('quotationCalculator.scenarioComparison.saveAsBase')}</Btn>
        <Btn onClick={() => saveScenario(1)}>{t('quotationCalculator.scenarioComparison.saveAsBest')}</Btn>
        <Btn onClick={() => saveScenario(2)}>{t('quotationCalculator.scenarioComparison.saveAsWorst')}</Btn>
        <Btn onClick={clearScenarios}>{t('quotationCalculator.scenarioComparison.clearAll')}</Btn>
      </div>

      <div className="overflow-x-auto mt-3 rounded-lg border border-slate-200">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="bg-slate-50 text-slate-500 text-[10.5px] uppercase tracking-wide">
              <th className="text-left font-semibold py-1.5 px-2">{t('quotationCalculator.scenarioComparison.colMetric')}</th>
              <th className="text-right font-semibold py-1.5 px-2">{t('quotationCalculator.scenarioComparison.colCurrent')}</th>
              {SCEN_NAME_KEYS.map((nameKey, i) => (
                <th key={nameKey} className="text-right font-semibold py-1.5 px-2">
                  {t(nameKey)}
                  {!scenarios[i] && ` ${t('quotationCalculator.scenarioComparison.empty')}`}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {METRICS.map((m) => (
              <tr key={m.key} className="border-t border-slate-100 tabular-nums">
                <td className="text-left py-1.5 px-2 text-slate-600">{t(m.labelKey)}</td>
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
        <Btn onClick={() => loadScenario(0)}>{t('quotationCalculator.scenarioComparison.loadBase')}</Btn>
        <Btn onClick={() => loadScenario(1)}>{t('quotationCalculator.scenarioComparison.loadBest')}</Btn>
        <Btn onClick={() => loadScenario(2)}>{t('quotationCalculator.scenarioComparison.loadWorst')}</Btn>
      </div>
      <Note>{t('quotationCalculator.scenarioComparison.note')}</Note>
    </Card>
  );
}
