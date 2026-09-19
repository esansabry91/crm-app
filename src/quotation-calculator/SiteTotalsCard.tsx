import { useTranslation } from 'react-i18next';
import type { QuotationCalculator } from './useQuotationCalculator';
import { Card, Note, Out, Row } from './ui';
import { fmt } from './format';

export default function SiteTotalsCard({ calc }: { calc: QuotationCalculator }) {
  const { t } = useTranslation();
  const { result } = calc;
  return (
    <Card title={t('quotationCalculator.siteTotals.title')}>
      <Row label={t('quotationCalculator.siteTotals.guardsUsed')}>
        <Out>{fmt(result.guards, 0)}</Out>
      </Row>
      <Row label={t('quotationCalculator.siteTotals.guardWageCost', { pw: result.pw })}>
        <Out>{fmt(result.siteGuardCostPP, 2)}</Out>
      </Row>
      <Row label={t('quotationCalculator.siteTotals.miscCost', { pw: result.pw })}>
        <Out>{fmt(result.miscPP, 2)}</Out>
      </Row>
      <Row label={t('quotationCalculator.siteTotals.ofWhichCompulsory')}>
        <Out>{fmt(result.siteCostC, 2)}</Out>
      </Row>
      <Row label={t('quotationCalculator.siteTotals.ofWhichMainStream')}>
        <Out>{fmt(result.siteCostS, 2)}</Out>
      </Row>
      <Row label={t('quotationCalculator.siteTotals.totalSiteCost', { pw: result.pw })} strong>
        <Out strong>{fmt(result.siteCostPP, 2)}</Out>
      </Row>
      <Row label={result.dayBasis ? t('quotationCalculator.siteTotals.totalCoverageManhoursDay') : t('quotationCalculator.siteTotals.totalCoverageManhoursMonth')}>
        <Out>{fmt(result.manhoursPP, 1)}</Out>
      </Row>
      <Row label={t('quotationCalculator.siteTotals.cpmBilling')} strong>
        <Out strong>{fmt(result.cpmBill, 4)}</Out>
      </Row>
      <Row label={t('quotationCalculator.siteTotals.cpmPerGuard')}>
        <Out>{fmt(result.cpmGuard, 4)}</Out>
      </Row>
      <Note>{t('quotationCalculator.siteTotals.note')}</Note>
    </Card>
  );
}
