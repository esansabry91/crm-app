import { useTranslation } from 'react-i18next';
import type { QuotationCalculator } from './useQuotationCalculator';
import { NEW_MISC_COMPULSORY, NEW_MISC_LUMP_SUM, NEW_MISC_RENTAL } from './defaults';
import type { MiscItem } from './types';
import { Btn, Card, ItemOut, ItemRow, NumField, Note, Row, StrongHeaderRow, TextField } from './ui';
import { fmt } from './format';

export default function MiscCostCard({ calc }: { calc: QuotationCalculator }) {
  const { t } = useTranslation();
  const { miscItems, setMiscItems, result } = calc;

  function update(i: number, patch: Partial<MiscItem>) {
    setMiscItems(miscItems.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  }
  function remove(i: number) {
    setMiscItems(miscItems.filter((_, idx) => idx !== i));
  }

  const compulsory = miscItems.map((it, i) => ({ it, i })).filter((x) => x.it.type === 'C');
  const optional = miscItems.map((it, i) => ({ it, i })).filter((x) => x.it.type !== 'C');

  return (
    <Card title={t('quotationCalculator.miscCost.title')}>
      <StrongHeaderRow cols={[t('quotationCalculator.miscCost.colItem'), t('quotationCalculator.miscCost.colPerMonth'), t('quotationCalculator.miscCost.colFullTerm')]} />
      <div className="text-[10.5px] font-bold uppercase tracking-wide text-blue-700 border-l-2 border-blue-300 pl-2 mt-3 mb-1.5">
        {t('quotationCalculator.miscCost.compulsoryHeading')}
      </div>
      {compulsory.map(({ it, i }) => (
        <ItemRow key={i} onRemove={() => remove(i)}>
          <TextField value={it.name} onChange={(v) => update(i, { name: v })} width="w-40" />
          <span>{t('quotationCalculator.miscCost.qtyPerGuard')}</span>
          <NumField value={it.qty} onChange={(v) => update(i, { qty: v })} step={1} min={0} width="w-14" />
          <span>{t('quotationCalculator.miscCost.xRm')}</span>
          <NumField value={it.unit} onChange={(v) => update(i, { unit: v })} step={1} min={0} width="w-20" />
          <span className="flex-1" />
          <ItemOut>{fmt(result.miscBreakdown[i]?.perPeriod, 2)}</ItemOut>
          <ItemOut>{fmt(result.miscBreakdown[i]?.total, 2)}</ItemOut>
        </ItemRow>
      ))}
      <div className="mt-2">
        <Btn onClick={() => setMiscItems([...miscItems, { ...NEW_MISC_COMPULSORY }])}>{t('quotationCalculator.miscCost.addCompulsoryItem')}</Btn>
      </div>

      <div className="text-[10.5px] font-bold uppercase tracking-wide text-blue-700 border-l-2 border-blue-300 pl-2 mt-4 mb-1.5">
        {t('quotationCalculator.miscCost.optionalHeading')}
      </div>
      {optional.map(({ it, i }) => (
        <ItemRow key={i} onRemove={() => remove(i)}>
          <TextField value={it.name} onChange={(v) => update(i, { name: v })} width="w-40" />
          <span>{t('quotationCalculator.miscCost.units')}</span>
          <NumField value={it.qty} onChange={(v) => update(i, { qty: v })} step={1} min={0} width="w-14" />
          <span>{t('quotationCalculator.miscCost.xRm')}</span>
          <NumField value={it.unit} onChange={(v) => update(i, { unit: v })} step={1} min={0} width="w-24" />
          <span>{it.type === 'L' ? t('quotationCalculator.miscCost.perUnitOneOff') : t('quotationCalculator.miscCost.perUnitPerMonth')}</span>
          <span className="flex-1" />
          <ItemOut>{fmt(result.miscBreakdown[i]?.perPeriod, 2)}</ItemOut>
          <ItemOut>{fmt(result.miscBreakdown[i]?.total, 2)}</ItemOut>
        </ItemRow>
      ))}
      <div className="mt-2 flex gap-2">
        <Btn onClick={() => setMiscItems([...miscItems, { ...NEW_MISC_LUMP_SUM }])}>{t('quotationCalculator.miscCost.addLumpSumItem')}</Btn>
        <Btn onClick={() => setMiscItems([...miscItems, { ...NEW_MISC_RENTAL }])}>{t('quotationCalculator.miscCost.addMonthlyRentalItem')}</Btn>
      </div>

      <Row label={t('quotationCalculator.miscCost.totalMisc')} strong>
        <span className="tabular-nums text-[13px] font-semibold text-slate-900 w-24 text-right">{fmt(result.miscPP, 2)}</span>
        <span className="tabular-nums text-[13px] font-semibold text-slate-900 w-24 text-right">{fmt(result.miscTotal, 2)}</span>
      </Row>
      <Note>
        {t('quotationCalculator.miscCost.note')}
      </Note>
    </Card>
  );
}
