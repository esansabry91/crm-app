import type { QuotationCalculator } from './useQuotationCalculator';
import { Card, Note, Out, Row } from './ui';
import { fmt } from './format';

export default function SiteTotalsCard({ calc }: { calc: QuotationCalculator }) {
  const { result } = calc;
  return (
    <Card title="5. Site Totals and Result">
      <Row label="Guards Required Used for this Site">
        <Out>{fmt(result.guards, 0)}</Out>
      </Row>
      <Row label={`${result.pw} Guard Wage Cost - Site (RM)`}>
        <Out>{fmt(result.siteGuardCostPP, 2)}</Out>
      </Row>
      <Row label={`${result.pw} Misc / Equipment Cost - Site (RM)`}>
        <Out>{fmt(result.miscPP, 2)}</Out>
      </Row>
      <Row label="of which compulsory grades (RM)">
        <Out>{fmt(result.siteCostC, 2)}</Out>
      </Row>
      <Row label="of which main stream (RM)">
        <Out>{fmt(result.siteCostS, 2)}</Out>
      </Row>
      <Row label={`TOTAL ${result.pw} Site Cost (RM)`} strong>
        <Out strong>{fmt(result.siteCostPP, 2)}</Out>
      </Row>
      <Row label={`Total Site Coverage Manhours per ${result.dayBasis ? 'Day' : 'Month'}`}>
        <Out>{fmt(result.manhoursPP, 1)}</Out>
      </Row>
      <Row label="Cost per Manhour - Client Billing Basis (RM/hr)" strong>
        <Out strong>{fmt(result.cpmBill, 4)}</Out>
      </Row>
      <Row label="Cost per Manhour - Per-Guard Basis (RM/hr)">
        <Out>{fmt(result.cpmGuard, 4)}</Out>
      </Row>
      <Note>Site cost = Guards Required (used) x Total Monthly Cost per Guard. Manhours use 4.348 weeks per month.</Note>
    </Card>
  );
}
