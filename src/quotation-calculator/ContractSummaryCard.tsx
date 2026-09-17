import type { QuotationCalculator } from './useQuotationCalculator';
import { Card, Note, Out, Row } from './ui';
import { fmt, pct } from './format';

export default function ContractSummaryCard({ calc }: { calc: QuotationCalculator }) {
  const { result } = calc;
  return (
    <Card title="7. Contract Summary">
      <div className="text-[10.5px] font-bold uppercase tracking-wide text-blue-700 border-l-2 border-blue-300 pl-2 mb-1.5">
        Contract period is set in section 1 - Client Site Requirement
      </div>
      <Row label="Equivalent months">
        <Out>{result.months.toFixed(2)}</Out>
      </Row>
      <Row label="Equivalent years">
        <Out>{(result.months / 12).toFixed(2)}</Out>
      </Row>
      <Row label="Item" strong>
        <span className="tabular-nums text-[13px] font-semibold text-slate-900 w-24 text-right">Per month</span>
        <span className="tabular-nums text-[13px] font-semibold text-slate-900 w-24 text-right">Full term</span>
      </Row>
      <Row label="Coverage manhours">
        <Out>{fmt(result.manhoursPP, 1)}</Out>
        <Out>{fmt(result.contractManhours, 1)}</Out>
      </Row>
      <Row label="Revenue (RM)">
        <Out>{fmt(result.revenuePP, 2)}</Out>
        <Out>{fmt(result.contractRevenue, 2)}</Out>
      </Row>
      <Row label="Guard wage cost (RM)">
        <Out>{fmt(result.siteGuardCostPP, 2)}</Out>
        <Out>{fmt(result.contractGuardCost, 2)}</Out>
      </Row>
      <Row label="Misc / equipment cost (RM)">
        <Out>{fmt(result.miscPP, 2)}</Out>
        <Out>{fmt(result.miscTotal, 2)}</Out>
      </Row>
      <Row label="Total cost (RM)">
        <Out>{fmt(result.siteCostPP, 2)}</Out>
        <Out>{fmt(result.contractCost, 2)}</Out>
      </Row>
      <Row label="Gross profit (RM)" strong>
        <Out strong>{fmt(result.profitPP, 2)}</Out>
        <Out strong>{fmt(result.contractProfit, 2)}</Out>
      </Row>
      <Row label="Less: management fee (RM)">
        <Out>{fmt(result.feeAmt, 2)}</Out>
        <Out>{fmt(result.contractFee, 2)}</Out>
      </Row>
      <Row label="FINAL gross profit after fee (RM)" strong>
        <Out strong>{fmt(result.finalProfit, 2)}</Out>
        <Out strong>{fmt(result.contractFinalProfit, 2)}</Out>
      </Row>
      <Row label="Gross margin (before fee)">
        <Out>{pct(result.margin)}</Out>
      </Row>
      <Row label="FINAL gross margin after fee" strong>
        <Out strong>{pct(result.finalMargin)}</Out>
      </Row>
      <Note>
        Full-term figures are the monthly result multiplied by the contract period. They assume the cost base, headcount and quoted rate hold for the whole term - no salary escalation or annual
        price revision is modelled.
      </Note>
    </Card>
  );
}
