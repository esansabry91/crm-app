import { NEW_FEE_ITEM } from './defaults';
import type { QuotationCalculator } from './useQuotationCalculator';
import type { FeeItem } from './types';
import { Btn, Card, ItemOut, ItemRow, NumField, Note, Row, StrongHeaderRow, TextField, Warn } from './ui';
import { fmt, pct } from './format';

export default function ManagementFeeCard({ calc }: { calc: QuotationCalculator }) {
  const { feeItems, setFeeItems, result, feeBreakdown } = calc;

  function update(i: number, patch: Partial<FeeItem>) {
    setFeeItems(feeItems.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  }
  function remove(i: number) {
    setFeeItems(feeItems.filter((_, idx) => idx !== i));
  }

  return (
    <Card title="4d. Management Fee">
      <StrongHeaderRow cols={['Fee item', 'Per month', 'Full term']} />
      {feeItems.map((it, i) => (
        <ItemRow key={i} onRemove={() => remove(i)}>
          <TextField value={it.name} onChange={(v) => update(i, { name: v })} width="w-44" />
          <span>rate</span>
          <NumField value={it.pct} onChange={(v) => update(i, { pct: v })} step={0.1} min={0} width="w-16" />
          <span>% of revenue</span>
          <span className="flex-1" />
          <ItemOut>{fmt(feeBreakdown[i]?.perPeriod, 2)}</ItemOut>
          <ItemOut>{fmt(feeBreakdown[i]?.total, 2)}</ItemOut>
        </ItemRow>
      ))}
      <div className="mt-2">
        <Btn onClick={() => setFeeItems([...feeItems, { ...NEW_FEE_ITEM }])}>Add management fee item</Btn>
      </div>

      <Row label="Total management fee" strong>
        <span className="tabular-nums text-[13px] font-semibold text-slate-900 w-24 text-right">{fmt(result.feeAmt, 2)}</span>
        <span className="tabular-nums text-[13px] font-semibold text-slate-900 w-24 text-right">{fmt(result.contractFee, 2)}</span>
      </Row>
      <Row label="Total fee rate (% of revenue billed)">
        <span className="tabular-nums text-[13px] text-slate-800">{pct(result.feeRate)}</span>
      </Row>
      {!result.feasible && <Warn>Total fee rate is 100% or more of revenue, which would wipe out all gross profit. Reduce the fee rate.</Warn>}
      <Note>
        Each item is charged as a percentage of the revenue billed to the client. The fee is NOT part of the cost per manhour or the quoted rate - the client is not charged for it. It is deducted
        from gross profit after revenue is billed, producing the final gross profit and final margin shown in sections 6 and 7 and in the summary panel.
      </Note>
    </Card>
  );
}
