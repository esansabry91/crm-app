import type { QuotationCalculator } from './useQuotationCalculator';
import { NEW_MISC_COMPULSORY, NEW_MISC_LUMP_SUM, NEW_MISC_RENTAL } from './defaults';
import type { MiscItem } from './types';
import { Btn, Card, ItemOut, ItemRow, NumField, Note, Row, StrongHeaderRow, TextField } from './ui';
import { fmt } from './format';

export default function MiscCostCard({ calc }: { calc: QuotationCalculator }) {
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
    <Card title="4c. Misc / Equipment Cost">
      <StrongHeaderRow cols={['Item', 'Per month', 'Full term']} />
      <div className="text-[10.5px] font-bold uppercase tracking-wide text-blue-700 border-l-2 border-blue-300 pl-2 mt-3 mb-1.5">
        Compulsory items - issued per guard over the contract period
      </div>
      {compulsory.map(({ it, i }) => (
        <ItemRow key={i} onRemove={() => remove(i)}>
          <TextField value={it.name} onChange={(v) => update(i, { name: v })} width="w-40" />
          <span>qty per guard</span>
          <NumField value={it.qty} onChange={(v) => update(i, { qty: v })} step={1} min={0} width="w-14" />
          <span>x RM</span>
          <NumField value={it.unit} onChange={(v) => update(i, { unit: v })} step={1} min={0} width="w-20" />
          <span className="flex-1" />
          <ItemOut>{fmt(result.miscBreakdown[i]?.perPeriod, 2)}</ItemOut>
          <ItemOut>{fmt(result.miscBreakdown[i]?.total, 2)}</ItemOut>
        </ItemRow>
      ))}
      <div className="mt-2">
        <Btn onClick={() => setMiscItems([...miscItems, { ...NEW_MISC_COMPULSORY }])}>Add compulsory item</Btn>
      </div>

      <div className="text-[10.5px] font-bold uppercase tracking-wide text-blue-700 border-l-2 border-blue-300 pl-2 mt-4 mb-1.5">
        Optional items - one-off lump sum or monthly rental over the contract period
      </div>
      {optional.map(({ it, i }) => (
        <ItemRow key={i} onRemove={() => remove(i)}>
          <TextField value={it.name} onChange={(v) => update(i, { name: v })} width="w-40" />
          <span>units</span>
          <NumField value={it.qty} onChange={(v) => update(i, { qty: v })} step={1} min={0} width="w-14" />
          <span>x RM</span>
          <NumField value={it.unit} onChange={(v) => update(i, { unit: v })} step={1} min={0} width="w-24" />
          <span>{it.type === 'L' ? 'per unit, one-off' : 'per unit per month'}</span>
          <span className="flex-1" />
          <ItemOut>{fmt(result.miscBreakdown[i]?.perPeriod, 2)}</ItemOut>
          <ItemOut>{fmt(result.miscBreakdown[i]?.total, 2)}</ItemOut>
        </ItemRow>
      ))}
      <div className="mt-2 flex gap-2">
        <Btn onClick={() => setMiscItems([...miscItems, { ...NEW_MISC_LUMP_SUM }])}>Add lump sum item</Btn>
        <Btn onClick={() => setMiscItems([...miscItems, { ...NEW_MISC_RENTAL }])}>Add monthly rental item</Btn>
      </div>

      <Row label="Total misc / equipment cost" strong>
        <span className="tabular-nums text-[13px] font-semibold text-slate-900 w-24 text-right">{fmt(result.miscPP, 2)}</span>
        <span className="tabular-nums text-[13px] font-semibold text-slate-900 w-24 text-right">{fmt(result.miscTotal, 2)}</span>
      </Row>
      <Note>
        Every line is priced as quantity x price per unit. Compulsory items use quantity per guard x price per unit x Guards Required, paid once and spread over the contract period. A lump sum
        item is units x price per unit paid once for the whole term, shown per month as the term average. A monthly rental item is units x price per unit charged every month of the term. All
        misc costs are added to the site cost, so they flow into the cost per manhour, the quoted rate and the contract summary.
      </Note>
    </Card>
  );
}
