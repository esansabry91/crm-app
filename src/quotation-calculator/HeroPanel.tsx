import type { QuotationCalculator } from './useQuotationCalculator';
import { Btn, NumField } from './ui';
import { fmt, pct } from './format';

const CONTRACT_UNIT_WORD: Record<'D' | 'M' | 'Y', string> = { D: 'days', M: 'months', Y: 'years' };

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2.5 py-1.5 border-b border-white/15 last:border-0 text-[12.5px]">
      <span className="opacity-85">{label}</span>
      <b className="tabular-nums font-bold text-[13.5px]">{value}</b>
    </div>
  );
}

export default function HeroPanel({ calc, clientName }: { calc: QuotationCalculator; clientName: string }) {
  const { inputs, result, adjRateDisplay, adjTouched, setAdjRate, resetAdjustedRate, syncGuardsToSuggested, resetDefaults } = calc;
  const r = result;
  const isDayTerm = r.dayBasis;
  const uWord = CONTRACT_UNIT_WORD[inputs.contractUnit];

  const ar = adjRateDisplay;
  const aMargin = ar > 0 ? (ar - r.cpmBill) / ar : NaN;
  const aRev = ar * r.manhoursPP;
  const aFee = aRev * (isFinite(r.feeRate) ? r.feeRate : 0);
  const aPro = aRev - r.costBase;
  const aFinal = aPro - aFee;
  const aFinalMargin = aRev > 0 ? aFinal / aRev : NaN;
  const dp = r.dayBasis ? 2 : 0;

  return (
    <div className="sticky top-4 flex flex-col gap-4">
      <div className="rounded-xl bg-gradient-to-br from-[#0b2b47] via-[#14527f] to-[#12806a] text-white p-5 shadow-lg">
        <div className="text-[10.5px] font-bold uppercase tracking-widest opacity-85">Quoted Rate to Client</div>
        <div className="text-[38px] font-extrabold tracking-tight leading-none mt-1.5 tabular-nums">{fmt(r.quote, 2)}</div>
        <div className="text-[11.5px] opacity-80 mt-0.5">RM per manhour</div>
        <div className="h-3" />
        <Mini label="Client" value={clientName || '-'} />
        <Mini label="Contract period" value={`${fmt(inputs.contractMonths, 0)} ${uWord}`} />
        <Mini label="Guards used" value={fmt(r.guards, 0)} />
        <Mini label={isDayTerm ? 'Basic salary per guard (per day)' : 'Basic salary per guard'} value={isDayTerm ? fmt(r.basic / Math.max(1, inputs.workDaysMo), 2) : fmt(r.basic, 0)} />
        <Mini label="Billing cost / hour" value={fmt(r.cpmBill, 2)} />
        <Mini label="Gross margin" value={pct(r.margin)} />
        <Mini label={isDayTerm ? 'Daily revenue' : 'Monthly revenue'} value={fmt(isDayTerm ? r.revenuePP : r.revenue, isDayTerm ? 2 : 0)} />
        <Mini label={isDayTerm ? 'Daily gross profit' : 'Monthly gross profit'} value={fmt(isDayTerm ? r.profitPP : r.profit, isDayTerm ? 2 : 0)} />
        <Mini label="Less: management fee" value={fmt(r.feeAmt, r.dayBasis ? 2 : 0)} />
        <Mini label={`${r.dayBasis ? 'Daily' : 'Monthly'} final gross profit`} value={fmt(r.finalProfit, r.dayBasis ? 2 : 0)} />
        <Mini label="Final gross margin" value={pct(r.finalMargin)} />
        <Mini label="Contract revenue (full term)" value={fmt(r.contractRevenue, 0)} />
        <Mini label="Contract gross profit (full term)" value={fmt(r.contractProfit, 0)} />
      </div>

      <div className="rounded-xl bg-gradient-to-br from-[#083f2e] via-[#0d7a52] to-[#17a06b] text-white p-5 shadow-lg">
        <div className="text-[10.5px] font-bold uppercase tracking-widest opacity-85">
          Adjusted Quoted Rate to Client
          <span className="ml-1.5 font-semibold normal-case opacity-90">{adjTouched ? '(manual)' : '(tracking suggested)'}</span>
        </div>
        <div className="mt-1.5">
          <NumField
            value={ar}
            onChange={setAdjRate}
            step={0.01}
            min={0}
            width="w-full"
            className="!bg-white/15 !border-white/45 !text-white text-[30px] font-extrabold px-3 py-1 focus:!ring-white/40"
          />
        </div>
        <div className="text-[11.5px] opacity-80 mt-0.5">RM per manhour - edit this to test a price</div>
        <div className="h-3" />
        <Mini label="Suggested rate" value={fmt(r.quote, 4)} />
        <Mini label="Difference vs suggested" value={fmt(ar - r.quote, 4)} />
        <Mini label="Billing cost / hour" value={fmt(r.cpmBill, 4)} />
        <Mini label="Gross margin" value={pct(aMargin)} />
        <Mini label={isDayTerm ? 'Daily revenue' : 'Monthly revenue'} value={fmt(aRev, dp)} />
        <Mini label={isDayTerm ? 'Daily gross profit' : 'Monthly gross profit'} value={fmt(aPro, dp)} />
        <Mini label="Less: management fee" value={fmt(aFee, dp)} />
        <Mini label="Final gross profit" value={fmt(aFinal, dp)} />
        <Mini label="Final gross margin" value={pct(aFinalMargin)} />
        <Mini label="Contract revenue (full term)" value={fmt(aRev * r.periods, 0)} />
        <Mini label="Contract gross profit (full term)" value={fmt(aPro * r.periods, 0)} />
        <Mini label="Profit difference (full term)" value={fmt((aPro - r.profitPP) * r.periods, 0)} />
      </div>

      <div className="flex gap-2">
        <Btn onClick={resetAdjustedRate}>Reset to suggested rate</Btn>
      </div>
      <div className="flex gap-2 flex-wrap">
        <Btn onClick={syncGuardsToSuggested}>Sync to suggested</Btn>
        <Btn onClick={resetDefaults}>Reset defaults</Btn>
        <Btn onClick={() => window.print()}>Print / PDF</Btn>
      </div>
    </div>
  );
}
