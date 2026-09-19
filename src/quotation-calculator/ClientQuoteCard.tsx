import { useTranslation } from 'react-i18next';
import type { QuotationCalculator } from './useQuotationCalculator';
import { Card, NumField, Note, Out, Row } from './ui';
import { fmt, pct } from './format';

export default function ClientQuoteCard({ calc }: { calc: QuotationCalculator }) {
  const { t } = useTranslation();
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
      <Card title={t('quotationCalculator.clientQuote.title')}>
        <Row label={t('quotationCalculator.clientQuote.markupOnCost')}>
          <NumField value={inputs.markup} onChange={(v) => setField('markup', v)} step={1} min={0} />
        </Row>
        <Row label={t('quotationCalculator.clientQuote.quotedRatePerManhour')} strong>
          <Out strong>{fmt(result.quote, 4)}</Out>
        </Row>
        <Row label={t('quotationCalculator.clientQuote.grossMarginMainStream')}>
          <Out>{pct(result.margin)}</Out>
        </Row>
        <Row label={t('quotationCalculator.clientQuote.grossMarginAllStreams')}>
          <Out>{pct(result.marginTotal)}</Out>
        </Row>
        <Row label={t('quotationCalculator.clientQuote.revenueSite', { pw: result.pw })}>
          <Out>{fmt(result.revenuePP, 2)}</Out>
        </Row>
        <Row label={t('quotationCalculator.clientQuote.grossProfitSite', { pw: result.pw })}>
          <Out>{fmt(result.profitPP, 2)}</Out>
        </Row>
        <Row label={t('quotationCalculator.clientQuote.lessManagementFee')}>
          <Out>{fmt(result.feeAmt, 2)}</Out>
        </Row>
        <Row label={t('quotationCalculator.clientQuote.finalGrossProfit', { pw: result.pw })} strong>
          <Out strong>{fmt(result.finalProfit, 2)}</Out>
        </Row>
        <Row label={t('quotationCalculator.clientQuote.finalGrossMargin')} strong>
          <Out strong>{pct(result.finalMargin)}</Out>
        </Row>
      </Card>

      {result.gradesOn && (
        <Card title={t('quotationCalculator.clientQuote.title6b')}>
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="bg-slate-50 text-slate-500 text-[10.5px] uppercase tracking-wide">
                  <th className="text-left font-semibold py-1.5 px-2">{t('quotationCalculator.clientQuote.colCompulsoryGrade')}</th>
                  <th className="text-right font-semibold py-1.5 px-2">{t('quotationCalculator.clientQuote.colPax')}</th>
                  <th className="text-right font-semibold py-1.5 px-2">{t('quotationCalculator.clientQuote.colManhours')}</th>
                  <th className="text-right font-semibold py-1.5 px-2">{t('quotationCalculator.clientQuote.colCost')}</th>
                  <th className="text-right font-semibold py-1.5 px-2">{t('quotationCalculator.clientQuote.colCostPerHr')}</th>
                  <th className="text-right font-semibold py-1.5 px-2">{t('quotationCalculator.clientQuote.colRatePerHr')}</th>
                  <th className="text-right font-semibold py-1.5 px-2">{t('quotationCalculator.clientQuote.colRevenue')}</th>
                  <th className="text-right font-semibold py-1.5 px-2">{t('quotationCalculator.clientQuote.colGrossProfit')}</th>
                </tr>
              </thead>
              <tbody>
                {compulsoryRows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="text-center text-slate-400 py-3">
                      {t('quotationCalculator.clientQuote.noCompulsoryGrades')}
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
          <Row label={t('quotationCalculator.clientQuote.totalCompulsoryHeadcount')} strong>
            <Out strong>{fmt(result.headC, 0)}</Out>
          </Row>
          <Row label={result.dayBasis ? t('quotationCalculator.clientQuote.coverageManhoursDay') : t('quotationCalculator.clientQuote.coverageManhoursMonth')}>
            <Out>{fmt(result.mhC, 1)}</Out>
          </Row>
          <Row label={t('quotationCalculator.clientQuote.costCompulsoryGrades', { pw: result.pw })}>
            <Out>{fmt(result.siteCostC, 2)}</Out>
          </Row>
          <Row label={t('quotationCalculator.clientQuote.cpmCompulsory')}>
            <Out>{fmt(result.cpmC, 4)}</Out>
          </Row>
          <Row label={t('quotationCalculator.clientQuote.markupCompulsory')}>
            <NumField value={inputs.compMarkup} onChange={(v) => setField('compMarkup', v)} step={1} min={0} />
          </Row>
          <Row label={t('quotationCalculator.clientQuote.quotedRateCompulsory')} strong>
            <Out strong>{fmt(result.quoteC, 4)}</Out>
          </Row>
          <Row label={t('quotationCalculator.clientQuote.grossMarginCompulsory')}>
            <Out>{pct(result.marginC)}</Out>
          </Row>
          <Row label={t('quotationCalculator.clientQuote.revenueCompulsory', { pw: result.pw })}>
            <Out>{fmt(result.revenueC, 2)}</Out>
          </Row>
          <Row label={t('quotationCalculator.clientQuote.grossProfitCompulsory', { pw: result.pw })}>
            <Out>{fmt(result.profitC, 2)}</Out>
          </Row>
          <Note>
            {t('quotationCalculator.clientQuote.compulsoryNote')}
          </Note>
        </Card>
      )}
    </>
  );
}
