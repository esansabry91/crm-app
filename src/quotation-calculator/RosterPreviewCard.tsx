import type { QuotationCalculator } from './useQuotationCalculator';
import { shiftWindow } from './engine';
import type { RosterViewMode } from './useQuotationCalculator';
import { Btn, Card, NumField, Note, Ok, Row, SelectField, Warn } from './ui';

const SHIFT_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
const SHIFT_COLORS = ['#dbeafe', '#dcfce7', '#fef3c7', '#fae8ff', '#e0e7ff', '#ffe4e6'];
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const VIEW_OPTIONS: { value: RosterViewMode; label: string }[] = [
  { value: '7', label: 'Weekly (7 days)' },
  { value: '14', label: 'Bi-weekly (14 days)' },
  { value: 'M', label: 'Monthly (calendar month)' },
];

export default function RosterPreviewCard({ calc }: { calc: QuotationCalculator }) {
  const { inputs, setField, rosterView, setRosterView, rosterMonth, setRosterMonth, rosterYear, setRosterYear, shiftMonth, jumpToThisMonth, rosterPlan, guardLabel } = calc;

  const monthly = rosterView === 'M';
  const nowYear = new Date().getFullYear();
  const yearOptions: number[] = [];
  for (let y = nowYear - 1; y <= nowYear + 3; y++) yearOptions.push(y);
  if (!yearOptions.includes(rosterYear)) yearOptions.push(rosterYear);
  yearOptions.sort((a, b) => a - b);

  const days = rosterPlan.days;
  const title = monthly ? `${MONTH_NAMES[rosterMonth]} ${rosterYear} - ${days} days, starting on a ${DAY_NAMES[rosterPlan.startDow]}` : '';

  const cannotBuild = !(rosterPlan.guards > 0) || !(rosterPlan.shiftsPerDay > 0) || !(rosterPlan.slotsPerDay > 0);

  const counts = rosterPlan.counts;
  const mn = counts.length ? Math.min(...counts) : 0;
  const mx = counts.length ? Math.max(...counts) : 0;
  const restMin = days - mx, restMax = days - mn;
  const allowed = (7 - inputs.restDays) * (days / 7);
  const allowedTxt = Math.round(allowed * 10) / 10;

  const dense = days > 7;

  return (
    <Card title="Duty Roster Suggestion">
      <Row label="Roster Start Hour (0-23)">
        <NumField value={inputs.rosterStart} onChange={(v) => setField('rosterStart', v)} step={1} min={0} max={23} />
      </Row>
      <Row label="Roster view">
        <SelectField value={rosterView} onChange={setRosterView} options={VIEW_OPTIONS} width="w-44" />
      </Row>
      <Row label="Month and year (monthly view)">
        <SelectField
          value={String(rosterMonth)}
          onChange={(v) => setRosterMonth(Number(v))}
          options={MONTH_NAMES.map((m, i) => ({ value: String(i), label: m }))}
          width="w-32"
        />
        <SelectField value={String(rosterYear)} onChange={(v) => setRosterYear(Number(v))} options={yearOptions.map((y) => ({ value: String(y), label: String(y) }))} width="w-20" />
      </Row>
      <div className="flex gap-2 mt-2">
        <Btn onClick={() => shiftMonth(-1)}>Prev month</Btn>
        <Btn onClick={() => shiftMonth(1)}>Next month</Btn>
        <Btn onClick={jumpToThisMonth}>This month</Btn>
      </div>

      {title && <div className="text-[12.5px] font-bold text-blue-800 mt-2.5">{title}</div>}

      {!cannotBuild && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 mt-3">
          {Array.from({ length: rosterPlan.shiftsPerDay }).map((_, i) => (
            <div key={i} className="flex items-center gap-2 text-[12.5px] py-0.5">
              <span className="w-3 h-3 rounded-sm shrink-0 ring-1 ring-black/5" style={{ background: SHIFT_COLORS[i % SHIFT_COLORS.length] }} />
              <span className="flex-1 text-slate-600">Shift {SHIFT_LETTERS[i % SHIFT_LETTERS.length]}</span>
              <span className="tabular-nums text-slate-500">{shiftWindow(inputs.rosterStart, inputs.shiftHrs, i)}</span>
            </div>
          ))}
        </div>
      )}

      {cannotBuild ? (
        <Warn>Cannot build a roster - check guard posts, coverage hours, hours per shift and Guards Required.</Warn>
      ) : (
        <div className="overflow-auto max-h-[420px] rounded-lg border border-slate-200 mt-3">
          <table className={dense ? 'text-[9.5px] w-full border-collapse' : 'text-[11.5px] w-full border-collapse'}>
            <thead>
              <tr>
                <th className="sticky top-0 left-0 z-[3] bg-slate-50 text-left font-semibold text-slate-600 border-b border-r border-slate-200 px-1.5 py-1 whitespace-nowrap">Guard</th>
                {Array.from({ length: days }).map((_, d) => {
                  const dow = (rosterPlan.startDow + d) % 7;
                  const label = monthly ? `${d + 1} ${DAY_NAMES[dow].charAt(0)}` : dense ? `${DAY_NAMES[dow]} W${Math.floor(d / 7) + 1}` : DAY_NAMES[dow];
                  return (
                    <th
                      key={d}
                      className={
                        'sticky top-0 z-[1] border-b border-r border-slate-200 px-1.5 py-1 text-center font-semibold whitespace-nowrap ' +
                        (dow >= 5 ? 'bg-slate-100 text-slate-400' : !monthly && Math.floor(d / 7) === 1 ? 'bg-blue-50 text-slate-600' : 'bg-slate-50 text-slate-600')
                      }
                    >
                      {label}
                    </th>
                  );
                })}
                <th className="sticky top-0 z-[1] bg-slate-50 border-b border-r border-slate-200 px-1.5 py-1 text-center font-semibold whitespace-nowrap">Shifts</th>
                <th className="sticky top-0 z-[1] bg-slate-50 border-b border-slate-200 px-1.5 py-1 text-center font-semibold whitespace-nowrap">Rest days</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: rosterPlan.guards }).map((_, g) => (
                <tr key={g}>
                  <td className="sticky left-0 z-[2] bg-white text-left font-semibold border-b border-r border-slate-200 px-1.5 py-1 whitespace-nowrap">{guardLabel(g)}</td>
                  {Array.from({ length: days }).map((_, d) => {
                    const a = rosterPlan.grid[g][d];
                    return (
                      <td
                        key={d}
                        className={'text-center border-b border-r border-slate-100 px-1.5 py-1 whitespace-nowrap ' + (a ? '' : 'text-slate-300')}
                        style={a ? { background: SHIFT_COLORS[a.shift % SHIFT_COLORS.length] } : undefined}
                        title={a ? `Shift ${SHIFT_LETTERS[a.shift % SHIFT_LETTERS.length]} ${shiftWindow(inputs.rosterStart, inputs.shiftHrs, a.shift)}, Post ${a.post}` : undefined}
                      >
                        {a ? `${SHIFT_LETTERS[a.shift % SHIFT_LETTERS.length]} P${a.post}` : 'OFF'}
                      </td>
                    );
                  })}
                  <td className="text-center font-semibold bg-slate-50 border-b border-r border-slate-100 px-1.5 py-1">{rosterPlan.counts[g]}</td>
                  <td className="text-center font-semibold bg-slate-50 border-b border-slate-100 px-1.5 py-1">{days - rosterPlan.counts[g]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!cannotBuild &&
        (rosterPlan.unfilled > 0 ? (
          <Warn>
            Short by {rosterPlan.unfilled} shift slots over {days} days. {rosterPlan.slotsPerDay} slots must be filled each covered day but only {rosterPlan.guards} guards are available, and no
            guard is double-booked on the same day. Increase Guards Required to at least {rosterPlan.slotsPerDay}.
          </Warn>
        ) : mx > allowed + 0.0001 ? (
          <Warn>
            Coverage is met, but the busiest guard works {mx} shifts in {days} days versus {allowedTxt} allowed by your rest-day rule. Add guards to stay within {allowedTxt}.
          </Warn>
        ) : (
          <Ok>
            Coverage met: all {rosterPlan.required} shift slots filled over {days} days. Each guard works {mn === mx ? mn : `${mn} to ${mx}`} shifts and gets{' '}
            {restMin === restMax ? restMin : `${restMin} to ${restMax}`} rest days.
          </Ok>
        ))}

      <Note>
        The roster is generated from Guards Required (used in all calculations), guard posts, coverage hours and hours per shift. Guards are rotated round-robin so shifts and rest days spread as
        evenly as the headcount allows. Each cell shows the shift letter and the post number; OFF means a rest day. Change Guards Required and the roster re-draws.
        {inputs.pattern === 'CUSTOM' && (
          <>
            {' '}
            <strong>Note:</strong> in Custom post list mode, this preview covers using &quot;Guard Posts (all shifts, all days)&quot; rather than the custom blocks — the custom list only drives
            the actual coverage manhours and quoted figures elsewhere on this page.
          </>
        )}
      </Note>
    </Card>
  );
}
