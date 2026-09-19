import { useTranslation } from 'react-i18next';
import type { QuotationCalculator } from './useQuotationCalculator';
import { Card, Note, Out, Row } from './ui';
import { fmt, pct } from './format';

export default function ContractSummaryCard({ calc }: { calc: QuotationCalculator }) {
  const { t } = useTranslation();
  const { result } = calc;
  return (
    <Card title={t('quotationCalculator.contractSummary.title')}>
      <div className="text-[10.5px] font-bold uppercase tracking-wide text-blue-700 border-l-2 border-blue-300 pl-2 mb-1.5">
        {t('quotationCalculator.contractSummary.contractPeriodNote')}
      </div>
      <Row label={t('quotationCalculator.contractSummary.equivalentMonths')}>
        <Out>{result.months.toFixed(2)}</Out>
      </Row>
      <Row label={t('quotationCalculator.contractSummary.equivalentYears')}>
        <Out>{(result.months / 12).toFixed(2)}</Out>
      </Row>
      <Row label={t('quotationCalculator.contractSummary.item')} strong>
        <span className="tabular-nums text-[13px] font-semibold text-slate-900 w-24 text-right">{t('quotationCalculator.contractSummary.perMonth')}</span>
        <span className="tabular-nums text-[13px] font-semibold text-slate-900 w-24 text-right">{t('quotationCalculator.contractSummary.fullTerm')}</span>
      </Row>
      <Row label={t('quotationCalculator.contractSummary.coverageManhours')}>
        <Out>{fmt(result.manhoursPP, 1)}</Out>
        <Out>{fmt(result.contractManhours, 1)}</Out>
      </Row>
      <Row label={t('quotationCalculator.contractSummary.revenue')}>
        <Out>{fmt(result.revenuePP, 2)}</Out>
        <Out>{fmt(result.contractRevenue, 2)}</Out>
      </Row>
      <Row label={t('quotationCalculator.contractSummary.guardWageCost')}>
        <Out>{fmt(result.siteGuardCostPP, 2)}</Out>
        <Out>{fmt(result.contractGuardCost, 2)}</Out>
      </Row>
      <Row label={t('quotationCalculator.contractSummary.miscCost')}>
        <Out>{fmt(result.miscPP, 2)}</Out>
        <Out>{fmt(result.miscTotal, 2)}</Out>
      </Row>
      <Row label={t('quotationCalculator.contractSummary.totalCost')}>
        <Out>{fmt(result.siteCostPP, 2)}</Out>
        <Out>{fmt(result.contractCost, 2)}</Out>
      </Row>
      <Row label={t('quotationCalculator.contractSummary.grossProfit')} strong>
        <Out strong>{fmt(result.profitPP, 2)}</Out>
        <Out strong>{fmt(result.contractProfit, 2)}</Out>
      </Row>
      <Row label={t('quotationCalculator.contractSummary.lessManagementFee')}>
        <Out>{fmt(result.feeAmt, 2)}</Out>
        <Out>{fmt(result.contractFee, 2)}</Out>
      </Row>
      <Row label={t('quotationCalculator.contractSummary.finalGrossProfit')} strong>
        <Out strong>{fmt(result.finalProfit, 2)}</Out>
        <Out strong>{fmt(result.contractFinalProfit, 2)}</Out>
      </Row>
      <Row label={t('quotationCalculator.contractSummary.grossMargin')}>
        <Out>{pct(result.margin)}</Out>
      </Row>
      <Row label={t('quotationCalculator.contractSummary.finalGrossMargin')} strong>
        <Out strong>{pct(result.finalMargin)}</Out>
      </Row>
      <Note>
        {t('quotationCalculator.contractSummary.fullTermNote')}
      </Note>
    </Card>
  );
}
