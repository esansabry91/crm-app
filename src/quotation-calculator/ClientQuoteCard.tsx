import type { QuotationCalculator } from './useQuotationCalculator';
import { Card, NumField, Note, Out, Row } from './ui';
import { fmt, pct } from './format';

export default function ClientQuoteCard({ calc }: { calc: QuotationCalculator }) {
  const { inputs, setField, gradeItems, result } = calc;

  const mk = 1 + inputs.compMarkup / 100;
  const compulsoryRows =
    result.gradesOn && result.headC > 0
      ? gradeItems
          .map((g, i) => ({ g, cost: result.gradeItemCosts[i] }))
          .filter((r) => r.g.kind === 'C' && Math.max(0, Math.round(r.g.n || 0)) > 0)
          .map(({ g, cost }) => {
            const n = Math.max(0, Math.round(g.n || 0));
            const share = result.totalHead > 0 ? n / result.totalHead : 0;
            const mh = result.manhoursPP * share;
            const itemCost = (cost ? cost.totalCost : 0) + result.miscPP * share;
            const cpm = mh > 0 ? itemCost / mh : NaN;
            const rate = cpm * mk;
            const rev = isFinite(rate) ? rate * mh : 0;
            const profit = rev - itemCost;
            return { name: g.name, n, mh, cost: itemCost, cpm, rate, rev, profit };
          })
      : [];

  return (
    <>
      <Card title="6. Client Quote">
        <Row label="Markup on Cost (%)">
          <NumField value={inputs.markup} onChange={(v) => setField('markup', v)} step={1} min={0} />
        </Row>
        <Row label="Quoted Rate per Manhour (RM/hr)" strong>
          <Out strong>{fmt(result.quote, 4)}</Out>
        </Row>
        <Row label="Gross Margin - Main Stream (%)">
          <Out>{pct(result.margin)}</Out>
        </Row>
        <Row label="Gross Margin - All Streams (%)">
          <Out>{pct(result.marginTotal)}</Out>
        </Row>
        <Row label={`${result.pw} Revenue - Site (RM)`}>
          <Out>{fmt(result.revenuePP, 2)}</Out>
        </Row>
        <Row label={`${result.pw} Gross Profit - Site (RM)`}>
          <Out>{fmt(result.profitPP, 2)}</Out>
        </Row>
        <Row label={`Less: Management Fee (RM)`}>
          <Out>{fmt(result.feeAmt, 2)}</Out>
        </Row>
        <Row label={`FINAL ${result.pw} Gross Profit after Management Fee (RM)`} strong>
          <Out strong>{fmt(result.finalProfit, 2)}</Out>
        </Row>
        <Row label="FINAL Gross Margin after Management Fee" strong>
          <Out strong>{pct(result.finalMargin)}</Out>
        </Row>
      </Card>

      {result.gradesOn && (
        <Card title="6b. Compulsory Grade Billing - Separate Rate">
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="bg-slate-50 text-slate-500 text-[10.5px] uppercase tracking-wide">
                  <th className="text-left font-semibold py-1.5 px-2">Compulsory grade</th>
                  <th className="text-right font-semibold py-1.5 px-2">Pax</th>
                  <th className="text-right font-semibold py-1.5 px-2">Manhours</th>
                  <th className="text-right font-semibold py-1.5 px-2">Cost (RM)</th>
                  <th className="text-right font-semibold py-1.5 px-2">Cost/hr</th>
                  <th className="text-right font-semibold py-1.5 px-2">Rate/hr</th>
                  <th className="text-right font-semibold py-1.5 px-2">Revenue</th>
                  <th className="text-right font-semibold py-1.5 px-2">Gross profit</th>
                </tr>
              </thead>
              <tbody>
                {compulsoryRows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="text-center text-slate-400 py-3">
                      No compulsory grades entered.
                    </td>
                  </tr>
                ) : (
                  compulsoryRows.map((r) => (
                    <tr key={r.name} className="border-t border-slate-100 tabular-nums">
                      <td className="text-left py-1.5 px-2">{r.name}</td>
                      <td className="text-right py-1.5 px-2">{fmt(r.n, 0)}</td>
                      <td className="text-right py-1.5 px-2">{fmt(r.mh, 1)}</td>
                      <td className="text-right py-1.5 px-2">{fmt(r.cost, 2)}</td>
                      <td className="text-right py-1.5 px-2">{fmt(r.cpm, 4)}</td>
                      <td className="text-right py-1.5 px-2">{fmt(r.rate, 4)}</td>
                      <td className="text-right py-1.5 px-2">{fmt(r.rev, 2)}</td>
                      <td className="text-right py-1.5 px-2">{fmt(r.profit, 2)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <Row label="TOTAL compulsory headcount" strong>
            <Out strong>{fmt(result.headC, 0)}</Out>
          </Row>
          <Row label={`Coverage manhours per ${result.dayBasis ? 'day' : 'month'} (pro-rata)`}>
            <Out>{fmt(result.mhC, 1)}</Out>
          </Row>
          <Row label={`${result.pw} Cost - compulsory grades (RM)`}>
            <Out>{fmt(result.siteCostC, 2)}</Out>
          </Row>
          <Row label="Cost per Manhour - Compulsory (RM/hr)">
            <Out>{fmt(result.cpmC, 4)}</Out>
          </Row>
          <Row label="Markup on Cost - Compulsory (%)">
            <NumField value={inputs.compMarkup} onChange={(v) => setField('compMarkup', v)} step={1} min={0} />
          </Row>
          <Row label="QUOTED RATE - Compulsory (RM/hr)" strong>
            <Out strong>{fmt(result.quoteC, 4)}</Out>
          </Row>
          <Row label="Gross margin - Compulsory">
            <Out>{pct(result.marginC)}</Out>
          </Row>
          <Row label={`${result.pw} Revenue - Compulsory (RM)`}>
            <Out>{fmt(result.revenueC, 2)}</Out>
          </Row>
          <Row label={`${result.pw} Gross profit - Compulsory (RM)`}>
            <Out>{fmt(result.profitC, 2)}</Out>
          </Row>
          <Note>
            Every compulsory grade is listed individually with its own headcount, share of coverage manhours, cost, cost per manhour, quoted rate, revenue and gross profit. Each carries the
            compulsory markup below. Manhours and misc cost are allocated in proportion to headcount, so the individual lines add up to the totals shown, and this stream&apos;s revenue and gross
            profit feed the totals in sections 6 and 7.
          </Note>
        </Card>
      )}
    </>
  );
}
