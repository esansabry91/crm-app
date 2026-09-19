import { useTranslation } from 'react-i18next';
import { NEW_FEE_ITEM } from './defaults';
import type { QuotationCalculator } from './useQuotationCalculator';
import type { FeeItem } from './types';
import { Btn, Card, ItemOut, ItemRow, NumField, Note, Row, StrongHeaderRow, TextField, Warn } from './ui';
import { fmt, pct } from './format';

export default function ManagementFeeCard({ calc }: { calc: QuotationCalculator }) {
  const { t } = useTranslation();
  const { feeItems, setFeeItems, result, feeBreakdown } = calc;

  function update(i: number, patch: Partial<FeeItem>) {
    setFeeItems(feeItems.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  }
  function remove(i: number) {
    setFeeItems(feeItems.filter((_, idx) => idx !== i));
  }

  return (
    <Card title={t('quotationCalculator.managementFee.title')}>
      <StrongHeaderRow cols={[t('quotationCalculator.managementFee.colFeeItem'), t('quotationCalculator.managementFee.colPerMonth'), t('quotationCalculator.managementFee.colFullTerm')]} />
      {feeItems.map((it, i) => (
        <ItemRow key={i} onRemove={() => remove(i)}>
          <TextField value={it.name} onChange={(v) => update(i, { name: v })} width="w-44" />
          <span>{t('quotationCalculator.managementFee.rate')}</span>
          <NumField value={it.pct} onChange={(v) => update(i, { pct: v })} step={0.1} min={0} width="w-16" />
          <span>{t('quotationCalculator.managementFee.percentOfRevenue')}</span>
          <span className="flex-1" />
          <ItemOut>{fmt(feeBreakdown[i]?.perPeriod, 2)}</ItemOut>
          <ItemOut>{fmt(feeBreakdown[i]?.total, 2)}</ItemOut>
        </ItemRow>
      ))}
      <div className="mt-2">
        <Btn onClick={() => setFeeItems([...feeItems, { ...NEW_FEE_ITEM }])}>{t('quotationCalculator.managementFee.addItem')}</Btn>
      </div>

      <Row label={t('quotationCalculator.managementFee.totalFee')} strong>
        <span className="tabular-nums text-[13px] font-semibold text-slate-900 w-24 text-right">{fmt(result.feeAmt, 2)}</span>
        <span className="tabular-nums text-[13px] font-semibold text-slate-900 w-24 text-right">{fmt(result.contractFee, 2)}</span>
      </Row>
      <Row label={t('quotationCalculator.managementFee.totalFeeRate')}>
        <span className="tabular-nums text-[13px] text-slate-800">{pct(result.feeRate)}</span>
      </Row>
      {!result.feasible && <Warn>{t('quotationCalculator.managementFee.warnFeeRateTooHigh')}</Warn>}
      <Note>
        {t('quotationCalculator.managementFee.note')}
      </Note>
    </Card>
  );
}
