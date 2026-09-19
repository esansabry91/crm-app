import { useTranslation } from 'react-i18next';
import type { QuotationCalculator } from './useQuotationCalculator';
import { Btn, NumField } from './ui';
import { fmt, pct } from './format';

const CONTRACT_UNIT_WORD_KEYS: Record<'D' | 'M' | 'Y', string> = { D: 'quotationCalculator.hero.unitDays', M: 'quotationCalculator.hero.unitMonths', Y: 'quotationCalculator.hero.unitYears' };

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2.5 py-1.5 border-b border-white/15 last:border-0 text-[12.5px]">
      <span className="opacity-85">{label}</span>
      <b className="tabular-nums font-bold text-[13.5px]">{value}</b>
    </div>
  );
}

export default function HeroPanel({ calc, clientName }: { calc: QuotationCalculator; clientName: string }) {
  const { t } = useTranslation();
  const { inputs, result, adjRateDisplay, adjTouched, setAdjRate, resetAdjustedRate, syncGuardsToSuggested, resetDefaults } = calc;
  const r = result;
  const isDayTerm = r.dayBasis;
  const uWord = t(CONTRACT_UNIT_WORD_KEYS[inputs.contractUnit]);

  const ar = adjRateDisplay;
  const aMargin = ar > 0 ? (ar - r.cpmBill) / ar : NaN;
  const aRev = ar * r.manhoursPP;
  const aFee = aRev * (isFinite(r.feeRate) ? r.feeRate : 0);
  const aPro = aRev - r.costBase;
  const aFinal = aPro - aFee;
  const aFinalMargin = aRev > 0 ? aFinal / aRev : NaN;
  const dp = r.dayBasis ? 2 : 0;

  return (
    <div className="sticky top-4 flex flex-col gap-4">
      <div className="rounded-xl bg-gradient-to-br from-[#0b2b47] via-[#14527f] to-[#12806a] text-white p-5 shadow-lg">
        <div className="text-[10.5px] font-bold uppercase tracking-widest opacity-85">{t('quotationCalculator.hero.quotedRate')}</div>
        <div className="text-[38px] font-extrabold tracking-tight leading-none mt-1.5 tabular-nums">{fmt(r.quote, 2)}</div>
        <div className="text-[11.5px] opacity-80 mt-0.5">{t('quotationCalculator.hero.rmPerManhour')}</div>
        <div className="h-3" />
        <Mini label={t('quotationCalculator.hero.client')} value={clientName || '-'} />
        <Mini label={t('quotationCalculator.hero.contractPeriod')} value={`${fmt(inputs.contractMonths, 0)} ${uWord}`} />
        <Mini label={t('quotationCalculator.hero.guardsUsed')} value={fmt(r.guards, 0)} />
        <Mini label={isDayTerm ? t('quotationCalculator.hero.basicSalaryPerGuardDay') : t('quotationCalculator.hero.basicSalaryPerGuard')} value={isDayTerm ? fmt(r.basic / Math.max(1, inputs.workDaysMo), 2) : fmt(r.basic, 0)} />
        <Mini label={t('quotationCalculator.hero.billingCostPerHour')} value={fmt(r.cpmBill, 2)} />
        <Mini label={t('quotationCalculator.hero.grossMargin')} value={pct(r.margin)} />
        <Mini label={isDayTerm ? t('quotationCalculator.hero.dailyRevenue') : t('quotationCalculator.hero.monthlyRevenue')} value={fmt(isDayTerm ? r.revenuePP : r.revenue, isDayTerm ? 2 : 0)} />
        <Mini label={isDayTerm ? t('quotationCalculator.hero.dailyGrossProfit') : t('quotationCalculator.hero.monthlyGrossProfit')} value={fmt(isDayTerm ? r.profitPP : r.profit, isDayTerm ? 2 : 0)} />
        <Mini label={t('quotationCalculator.hero.lessManagementFee')} value={fmt(r.feeAmt, r.dayBasis ? 2 : 0)} />
        <Mini label={r.dayBasis ? t('quotationCalculator.hero.dailyFinalGrossProfit') : t('quotationCalculator.hero.monthlyFinalGrossProfit')} value={fmt(r.finalProfit, r.dayBasis ? 2 : 0)} />
        <Mini label={t('quotationCalculator.hero.finalGrossMargin')} value={pct(r.finalMargin)} />
        <Mini label={t('quotationCalculator.hero.contractRevenueFullTerm')} value={fmt(r.contractRevenue, 0)} />
        <Mini label={t('quotationCalculator.hero.contractGrossProfitFullTerm')} value={fmt(r.contractProfit, 0)} />
      </div>

      <div className="rounded-xl bg-gradient-to-br from-[#083f2e] via-[#0d7a52] to-[#17a06b] text-white p-5 shadow-lg">
        <div className="text-[10.5px] font-bold uppercase tracking-widest opacity-85">
          {t('quotationCalculator.hero.adjustedQuotedRate')}
          <span className="ml-1.5 font-semibold normal-case opacity-90">{adjTouched ? t('quotationCalculator.hero.manual') : t('quotationCalculator.hero.trackingSuggested')}</span>
        </div>
        <div className="mt-1.5">
          <NumField
            value={ar}
            onChange={setAdjRate}
            step={0.01}
            min={0}
            width="w-full"
            className="!bg-white/15 !border-white/45 !text-white text-[30px] font-extrabold px-3 py-1 focus:!ring-white/40"
          />
        </div>
        <div className="text-[11.5px] opacity-80 mt-0.5">{t('quotationCalculator.hero.rmPerManhourEditHint')}</div>
        <div className="h-3" />
        <Mini label={t('quotationCalculator.hero.suggestedRate')} value={fmt(r.quote, 4)} />
        <Mini label={t('quotationCalculator.hero.differenceVsSuggested')} value={fmt(ar - r.quote, 4)} />
        <Mini label={t('quotationCalculator.hero.billingCostPerHour')} value={fmt(r.cpmBill, 4)} />
        <Mini label={t('quotationCalculator.hero.grossMargin')} value={pct(aMargin)} />
        <Mini label={isDayTerm ? t('quotationCalculator.hero.dailyRevenue') : t('quotationCalculator.hero.monthlyRevenue')} value={fmt(aRev, dp)} />
        <Mini label={isDayTerm ? t('quotationCalculator.hero.dailyGrossProfit') : t('quotationCalculator.hero.monthlyGrossProfit')} value={fmt(aPro, dp)} />
        <Mini label={t('quotationCalculator.hero.lessManagementFee')} value={fmt(aFee, dp)} />
        <Mini label={t('quotationCalculator.hero.finalGrossProfit')} value={fmt(aFinal, dp)} />
        <Mini label={t('quotationCalculator.hero.finalGrossMargin')} value={pct(aFinalMargin)} />
        <Mini label={t('quotationCalculator.hero.contractRevenueFullTerm')} value={fmt(aRev * r.periods, 0)} />
        <Mini label={t('quotationCalculator.hero.contractGrossProfitFullTerm')} value={fmt(aPro * r.periods, 0)} />
        <Mini label={t('quotationCalculator.hero.profitDifferenceFullTerm')} value={fmt((aPro - r.profitPP) * r.periods, 0)} />
      </div>

      <div className="flex gap-2">
        <Btn onClick={resetAdjustedRate}>{t('quotationCalculator.hero.resetToSuggestedRate')}</Btn>
      </div>
      <div className="flex gap-2 flex-wrap">
        <Btn onClick={syncGuardsToSuggested}>{t('quotationCalculator.hero.syncToSuggested')}</Btn>
        <Btn onClick={resetDefaults}>{t('quotationCalculator.hero.resetDefaults')}</Btn>
        <Btn onClick={() => window.print()}>{t('quotationCalculator.hero.printPdf')}</Btn>
      </div>
    </div>
  );
}
