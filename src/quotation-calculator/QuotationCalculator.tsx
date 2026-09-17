/**
 * Quotation Calculator — top-level assembly. Ported from public/quotation-calculator/index.html
 * (see that file's own header comment for history, and every sibling module's doc comments for
 * how each piece maps back to the original vanilla console). This used to be loaded in an
 * <iframe> by QuotationCalculatorPage.tsx as a fully separate app; it's now a real part of this
 * CRM's React tree, sharing the same auth, the same Firestore client, and the same design
 * language as Duty Roster / Branch Collection.
 */
import { Component, useState, type ReactNode } from 'react';
import { useQuotationCalculator } from './useQuotationCalculator';
import type { OtMode } from './types';
import SaveQuotationPanel from './SaveQuotationPanel';
import SiteRequirementCard from './SiteRequirementCard';
import GuardGradesCard from './GuardGradesCard';
import ShiftRosterAndGuardsCard from './ShiftRosterAndGuardsCard';
import RosterPreviewCard from './RosterPreviewCard';
import PerGuardCostCard from './PerGuardCostCard';
import MiscCostCard from './MiscCostCard';
import ManagementFeeCard from './ManagementFeeCard';
import CostBreakdownCard from './CostBreakdownCard';
import SiteTotalsCard from './SiteTotalsCard';
import ClientQuoteCard from './ClientQuoteCard';
import ContractSummaryCard from './ContractSummaryCard';
import SensitivityChartCard from './SensitivityChartCard';
import ScenarioComparisonCard from './ScenarioComparisonCard';
import AssumptionsCard from './AssumptionsCard';
import HeroPanel from './HeroPanel';

const OT_TABS: { mode: OtMode; label: string }[] = [
  { mode: 'F', label: 'Fixed OT Rate' },
  { mode: 'M', label: 'Multiplier OT Rate' },
  { mode: 'B', label: 'Only Basic' },
];

class CalculatorErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-700 text-sm px-4 py-3 font-mono">
          Calculation error: {this.state.error.message || String(this.state.error)}
        </div>
      );
    }
    return this.props.children;
  }
}

export default function QuotationCalculator() {
  const calc = useQuotationCalculator();
  const [clientName, setClientName] = useState('');
  const [site, setSite] = useState('');
  const [notes, setNotes] = useState('');
  const [currentQuoteId, setCurrentQuoteId] = useState<string | null>(null);

  return (
    <CalculatorErrorBoundary>
      <div className="max-w-[1400px] mx-auto pb-16">
        <div className="rounded-xl bg-gradient-to-r from-[#0b2b47] via-[#14527f] to-[#12806a] text-white px-6 py-5 mb-5 shadow-md">
          <h1 className="text-xl font-bold tracking-tight">Security Guard Service - Cost per Manhour</h1>
          <p className="text-[13px] text-white/85 mt-1 max-w-[70ch]">
            Drag the sliders or type in the yellow fields. Overtime is priced at a fixed RM per hour. Guards Required drives every calculation and is editable. Currency: RM.
          </p>
          {clientName && (
            <p className="text-[13px] font-semibold text-blue-50 mt-1.5">
              Client: {clientName}
              {site ? `  —  ${site}` : ''}
            </p>
          )}
          <div className="flex gap-2 mt-3.5 flex-wrap">
            {OT_TABS.map((t) => (
              <button
                key={t.mode}
                type="button"
                onClick={() => calc.setOtMode(t.mode)}
                className={
                  'rounded-full px-4 py-1.5 text-[12.5px] font-semibold border transition-colors ' +
                  (calc.inputs.otMode === t.mode ? 'bg-white text-[#0b2b47] border-white' : 'bg-white/10 text-white border-white/35 hover:bg-white/20')
                }
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_400px] gap-5 items-start">
          <div className="min-w-0">
            <SaveQuotationPanel
              calc={calc}
              clientName={clientName}
              setClientName={setClientName}
              site={site}
              setSite={setSite}
              notes={notes}
              setNotes={setNotes}
              currentQuoteId={currentQuoteId}
              setCurrentQuoteId={setCurrentQuoteId}
            />
            <SiteRequirementCard calc={calc} />
            <GuardGradesCard calc={calc} />
            <ShiftRosterAndGuardsCard calc={calc} />
            <RosterPreviewCard calc={calc} />
            <PerGuardCostCard calc={calc} />
            <MiscCostCard calc={calc} />
            <ManagementFeeCard calc={calc} />
            <CostBreakdownCard calc={calc} />
            <SiteTotalsCard calc={calc} />
            <ClientQuoteCard calc={calc} />
            <ContractSummaryCard calc={calc} />
            <SensitivityChartCard calc={calc} />
            <ScenarioComparisonCard calc={calc} />
            <AssumptionsCard calc={calc} />
          </div>
          <div className="min-w-0">
            <HeroPanel calc={calc} clientName={clientName} />
          </div>
        </div>
      </div>
    </CalculatorErrorBoundary>
  );
}
