/**
 * Central state hook for the Quotation Calculator — owns every input the vanilla console kept
 * as a page-level `var`, and derives the engine result (R) from them with useMemo instead of an
 * imperative calc()/calcCore() pass. See engine.ts's own doc comment for the porting approach;
 * this hook is the React-state equivalent of index.html's lines ~529-536 (state vars) plus
 * calcCore()/resetAll()/newQuotation()/loadScen()/applyState() (the functions that mutate them).
 */
import { useMemo, useState } from 'react';
import {
  DEFAULT_INPUTS,
  defaultFeeItems,
  defaultGradeItems,
  defaultMiscItems,
  defaultPostItems,
} from './defaults';
import {
  computeFeeBreakdown,
  computeSensitivitySeries,
  engine,
  guardLabel as guardLabelFn,
  rosterPlan as rosterPlanFn,
} from './engine';
import type {
  FeeItem,
  GradeItem,
  MiscItem,
  OtMode,
  PostItem,
  QuotationInputs,
  QuotationState,
  ScenarioSlots,
  ScenarioSnapshot,
} from './types';
import type { SensitivityDriverKey } from './engine';

export type RosterViewMode = '7' | '14' | 'M';

const SCALAR_FIELD_NAMES = [
  'postsU', 'postsDay', 'postsNight', 'postsWd', 'postsWe',
  'postsWdDay', 'postsWdNight', 'postsWeDay', 'postsWeNight',
  'hoursDay', 'daysWeek', 'shiftHrs', 'restDays', 'normalHrs', 'guards',
  'basic', 'workDaysMo', 'otHrs', 'otRate', 'otMult',
  'rdDays', 'rdMult', 'rdOtHrs', 'rdOtRate', 'rdOtMult',
  'phDays', 'phMult', 'phOtHrs', 'phOtRate', 'phOtMult',
  'epf', 'socso', 'eis', 'ceiling', 'markup', 'compMarkup',
  'contractMonths', 'rosterStart',
] as const;

function nowMonthYear() {
  const d = new Date();
  return { month: d.getMonth(), year: d.getFullYear() };
}

export function useQuotationCalculator() {
  const [inputs, setInputsState] = useState<QuotationInputs>(DEFAULT_INPUTS);
  const [postItems, setPostItems] = useState<PostItem[]>(defaultPostItems);
  const [gradeItems, setGradeItems] = useState<GradeItem[]>(defaultGradeItems);
  const [miscItems, setMiscItems] = useState<MiscItem[]>(defaultMiscItems);
  const [feeItems, setFeeItems] = useState<FeeItem[]>(defaultFeeItems);

  const [guardsTouched, setGuardsTouched] = useState(false);
  const [adjTouched, setAdjTouched] = useState(false);
  const [adjRateOverride, setAdjRateOverride] = useState(0);

  const [rosterView, setRosterView] = useState<RosterViewMode>('7');
  const initialMonth = nowMonthYear();
  const [rosterMonth, setRosterMonth] = useState(initialMonth.month);
  const [rosterYear, setRosterYear] = useState(initialMonth.year);

  const [scenarios, setScenarios] = useState<ScenarioSlots>([null, null, null]);
  const [sensitivityDriver, setSensitivityDriver] = useState<SensitivityDriverKey>('markup');

  const collections = useMemo(
    () => ({ postItems, gradeItems, miscItems, feeItems }),
    [postItems, gradeItems, miscItems, feeItems]
  );

  const result = useMemo(() => engine(inputs, guardsTouched, collections), [inputs, guardsTouched, collections]);

  // Guards field display — index.html's calcCore(): first tracks r.suggested while untouched,
  // then (regardless of touched) snaps up to r.guards (totalHead) whenever guard grades are on
  // and headcount from graded roles alone exceeds what's typed. See engine.ts's rosterPlan() doc
  // comment neighbour for why this doesn't need a state-sync effect — it's a pure function of
  // the already-computed result, not a second source of truth.
  let guardsDisplay = guardsTouched ? inputs.guards : isFinite(result.suggested) ? result.suggested : inputs.guards;
  if (result.gradesOn && isFinite(result.guards)) guardsDisplay = result.guards;

  const adjRateDisplay = adjTouched ? adjRateOverride : isFinite(result.quote) ? result.quote : 0;

  const feeBreakdown = useMemo(
    () => computeFeeBreakdown(feeItems, result.revenuePP, result.periods),
    [feeItems, result.revenuePP, result.periods]
  );

  const sensitivity = useMemo(
    () => computeSensitivitySeries(inputs, collections, guardsTouched, sensitivityDriver),
    [inputs, collections, guardsTouched, sensitivityDriver]
  );

  function setField<K extends keyof QuotationInputs>(key: K, value: QuotationInputs[K]) {
    setInputsState((prev) => ({ ...prev, [key]: value }));
  }

  /** Guards field's own setter — the only field whose edits also flip guardsTouched, matching
   *  the vanilla `if(id==='guards'){ guardsTouched = true; }` inside every input's listener. */
  function setGuards(value: number) {
    setGuardsTouched(true);
    setField('guards', value);
  }

  function syncGuardsToSuggested() {
    setGuardsTouched(false);
  }

  function setAdjRate(value: number) {
    setAdjTouched(true);
    setAdjRateOverride(value);
  }

  function resetAdjustedRate() {
    setAdjTouched(false);
  }

  function setOtMode(mode: OtMode) {
    setField('otMode', mode);
  }

  /** "Reset defaults" — index.html's resetAll(): only the 38 scalar fields go back to their
   *  shipped defaults. Post pattern, salary basis, guard grades on/off, contract unit and OT
   *  mode are deliberately left as-is (that's what the original does — resetAll() only ever
   *  loops over `ids`, never the selects), same for the post/grade/misc/fee item arrays. */
  function resetDefaults() {
    setInputsState((prev) => {
      const next = { ...prev };
      for (const key of SCALAR_FIELD_NAMES) {
        (next as QuotationInputs)[key] = DEFAULT_INPUTS[key];
      }
      return next;
    });
    setGuardsTouched(false);
    setAdjTouched(false);
  }

  /** "New Quotation" — index.html's newQuotation(): a full reset, including the select-driven
   *  fields and every line-item collection resetAll() leaves alone, plus jumping the roster
   *  preview back to the current month. Client name/site/notes and the currently-loaded quote id
   *  are owned by the save panel, not here — see SaveQuotationPanel. */
  function newQuotation() {
    setInputsState(DEFAULT_INPUTS);
    setPostItems(defaultPostItems());
    setGradeItems(defaultGradeItems());
    setMiscItems(defaultMiscItems());
    setFeeItems(defaultFeeItems());
    setGuardsTouched(false);
    setAdjTouched(false);
    setAdjRateOverride(0);
    setRosterView('M');
    const my = nowMonthYear();
    setRosterMonth(my.month);
    setRosterYear(my.year);
  }

  function collectState(): QuotationState {
    return {
      inputs,
      otMode: inputs.otMode,
      guardsTouched,
      adjTouched,
      adjRate: adjRateDisplay,
      rosterView,
      rosterMonth,
      rosterYear,
      postItems,
      gradeItems,
      miscItems,
      feeItems,
    };
  }

  function applyState(state: QuotationState) {
    setInputsState(state.inputs);
    setPostItems(state.postItems);
    setGradeItems(state.gradeItems);
    setMiscItems(state.miscItems);
    setFeeItems(state.feeItems);
    setGuardsTouched(state.guardsTouched);
    setAdjTouched(state.adjTouched);
    setAdjRateOverride(state.adjRate);
    setRosterView(state.rosterView);
    setRosterMonth(state.rosterMonth);
    setRosterYear(state.rosterYear);
  }

  // ---- Duty Roster Suggestion nav ----
  function shiftMonth(delta: number) {
    let m = rosterMonth + delta;
    let y = rosterYear;
    if (m < 0) { m = 11; y -= 1; }
    if (m > 11) { m = 0; y += 1; }
    setRosterMonth(m);
    setRosterYear(y);
    setRosterView('M');
  }

  function jumpToThisMonth() {
    const my = nowMonthYear();
    setRosterMonth(my.month);
    setRosterYear(my.year);
    setRosterView('M');
  }

  const rosterPlan = useMemo(() => {
    const monthly = rosterView === 'M';
    let days: number, startDow: number, seed: number;
    if (monthly) {
      const daysInMonth = new Date(rosterYear, rosterMonth + 1, 0).getDate();
      startDow = (new Date(rosterYear, rosterMonth, 1).getDay() + 6) % 7;
      days = daysInMonth;
      seed = rosterYear * 12 + rosterMonth;
    } else {
      days = parseInt(rosterView, 10);
      startDow = 0;
      seed = 0;
    }
    return rosterPlanFn(inputs, postItems, result.guards, days, startDow, seed);
  }, [inputs, postItems, result.guards, rosterView, rosterMonth, rosterYear]);

  function guardLabel(i: number): string {
    return guardLabelFn(i, result.gradesOn, gradeItems);
  }

  // ---- Scenario comparison ----
  function saveScenario(slot: 0 | 1 | 2) {
    const snap: ScenarioSnapshot = { inputs, touched: guardsTouched, postPattern: inputs.pattern, result };
    setScenarios((prev) => {
      const next = [...prev] as ScenarioSlots;
      next[slot] = snap;
      return next;
    });
  }

  function clearScenarios() {
    setScenarios([null, null, null]);
  }

  /** Loads a saved scenario back into the live calculator — index.html's loadScen(): only the
   *  scalar fields, post pattern and the guardsTouched flag are restored, exactly like the
   *  original (salary basis, contract unit, guard grades on/off, OT mode and every line-item
   *  collection are left as whatever they currently are — loadScen() never touches them). */
  function loadScenario(slot: 0 | 1 | 2) {
    const snap = scenarios[slot];
    if (!snap) return;
    setInputsState((prev) => {
      const next = { ...prev };
      for (const key of SCALAR_FIELD_NAMES) {
        (next as QuotationInputs)[key] = snap.inputs[key];
      }
      next.pattern = snap.postPattern;
      return next;
    });
    setGuardsTouched(snap.touched);
  }

  return {
    inputs, setField, setGuards, guardsDisplay, guardsTouched, syncGuardsToSuggested,
    adjRateDisplay, adjTouched, setAdjRate, resetAdjustedRate,
    setOtMode,
    postItems, setPostItems, gradeItems, setGradeItems, miscItems, setMiscItems, feeItems, setFeeItems,
    result, feeBreakdown,
    sensitivity, sensitivityDriver, setSensitivityDriver,
    rosterView, setRosterView, rosterMonth, setRosterMonth, rosterYear, setRosterYear,
    shiftMonth, jumpToThisMonth, rosterPlan, guardLabel,
    scenarios, saveScenario, clearScenarios, loadScenario,
    resetDefaults, newQuotation, collectState, applyState,
  };
}

export type QuotationCalculator = ReturnType<typeof useQuotationCalculator>;
