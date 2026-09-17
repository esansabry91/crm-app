import type { QuotationCalculator } from './useQuotationCalculator';
import { NEW_GRADE_COMPULSORY, NEW_GRADE_SPECIAL } from './defaults';
import type { GradeItem } from './types';
import { Btn, Card, ItemOut, ItemRow, NumField, Note, Ok, Row, SelectField, StrongHeaderRow, TextField, Warn } from './ui';
import { fmt } from './format';

const GRADES_ON_OPTIONS = [
  { value: 'N' as const, label: 'No - single guard type' },
  { value: 'Y' as const, label: 'Yes - graded team' },
];

function GradeList({
  items,
  costs,
  kind,
  onUpdate,
  onRemove,
}: {
  items: GradeItem[];
  costs: { costPerPerson: number; totalCost: number }[];
  kind: 'C' | 'S';
  onUpdate: (i: number, patch: Partial<GradeItem>) => void;
  onRemove: (i: number) => void;
}) {
  return (
    <>
      {items.map((it, i) =>
        it.kind === kind ? (
          <ItemRow key={i} onRemove={() => onRemove(i)}>
            <TextField value={it.name} onChange={(v) => onUpdate(i, { name: v })} width="w-32" />
            <span>pax</span>
            <NumField value={it.n} onChange={(v) => onUpdate(i, { n: v })} step={1} min={0} width="w-14" />
            <span>basic RM</span>
            <NumField value={it.basic} onChange={(v) => onUpdate(i, { basic: v })} step={50} min={0} width="w-20" />
            <span>allow RM</span>
            <NumField value={it.allow} onChange={(v) => onUpdate(i, { allow: v })} step={10} min={0} width="w-16" />
            <span>to</span>
            <NumField value={it.na} onChange={(v) => onUpdate(i, { na: v })} step={1} min={0} width="w-14" />
            <span>pax</span>
            <span className="flex-1" />
            <ItemOut>{fmt(costs[i]?.costPerPerson, 2)}</ItemOut>
            <ItemOut>{fmt(costs[i]?.totalCost, 2)}</ItemOut>
          </ItemRow>
        ) : null
      )}
    </>
  );
}

export default function GuardGradesCard({ calc }: { calc: QuotationCalculator }) {
  const { inputs, setField, gradeItems, setGradeItems, result } = calc;
  const on = inputs.gradesOn === 'Y';

  function updateGrade(i: number, patch: Partial<GradeItem>) {
    setGradeItems(gradeItems.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  }
  function removeGrade(i: number) {
    setGradeItems(gradeItems.filter((_, idx) => idx !== i));
  }
  function addCompulsory() {
    setGradeItems([...gradeItems, { ...NEW_GRADE_COMPULSORY }]);
  }
  function addSpecial() {
    setGradeItems([...gradeItems, { ...NEW_GRADE_SPECIAL }]);
  }

  // The whole grade-lists block (including these messages) only renders while `on` is true —
  // matching index.html's #gradeBody, which is display:none when guard grades are switched
  // off, so the vanilla console's "grades are switched off" message is never actually visible
  // either; no need to compute it here.
  const messages: { kind: 'warn' | 'ok'; text: string }[] = [];
  if (on) {
    const over = gradeItems.filter((g) => (g.na || 0) > (g.n || 0)).map((g) => g.name);
    if (over.length) {
      messages.push({ kind: 'warn', text: `With-allowance headcount exceeds total headcount for: ${over.join(', ')}. Capped at the grade headcount.` });
    }
    if (result.headGraded > result.guardsRequired) {
      messages.push({
        kind: 'warn',
        text: `Graded headcount ${result.headGraded} exceeds Guards Required ${result.guardsRequired}, so there are no remaining security guards and total headcount has risen to ${result.totalHead}.`,
      });
    } else {
      messages.push({ kind: 'ok', text: `${result.headGraded} graded plus ${result.remaining} remaining security guards = ${result.totalHead} total headcount.` });
    }
    if (result.headC <= 0) messages.push({ kind: 'warn', text: 'No compulsory grades entered, so section 6b has nothing to bill separately.' });
  }

  return (
    <Card title="1b. Guard Grades - Secondary Requirement">
      <Row label="Use guard grades" htmlFor="gradesOn">
        <SelectField value={inputs.gradesOn} onChange={(v) => setField('gradesOn', v)} options={GRADES_ON_OPTIONS} width="w-40" />
      </Row>

      {on && (
        <div>
          <div className="text-[10.5px] font-bold uppercase tracking-wide text-blue-700 border-l-2 border-blue-300 pl-2 mt-4 mb-1.5">
            Compulsory grades - billed to the client at their own rate
          </div>
          <StrongHeaderRow cols={['Grade / headcount / basic / allowance', 'Cost / person', 'Total cost']} />
          <GradeList items={gradeItems} costs={result.gradeItemCosts} kind="C" onUpdate={updateGrade} onRemove={removeGrade} />
          <div className="mt-2">
            <Btn onClick={addCompulsory}>Add compulsory grade</Btn>
          </div>

          <div className="text-[10.5px] font-bold uppercase tracking-wide text-blue-700 border-l-2 border-blue-300 pl-2 mt-4 mb-1.5">
            Special grades - billed together with the remaining security guards
          </div>
          <StrongHeaderRow cols={['Grade / headcount / basic / allowance', 'Cost / person', 'Total cost']} />
          <GradeList items={gradeItems} costs={result.gradeItemCosts} kind="S" onUpdate={updateGrade} onRemove={removeGrade} />
          <div className="mt-2">
            <Btn onClick={addSpecial}>Add special grade</Btn>
          </div>

          <Row label="Headcount in graded roles (compulsory + special)">
            <span className="tabular-nums text-[13px] text-slate-800">{fmt(result.headGraded, 0)}</span>
          </Row>
          <Row label="Remaining security guards (on section 4 basic salary)">
            <span className="tabular-nums text-[13px] text-slate-800">{fmt(result.remaining, 0)}</span>
          </Row>
          <Row label="Total headcount / total guard cost" strong>
            <span className="tabular-nums text-[13px] font-semibold text-slate-900">{fmt(result.totalHead, 0)}</span>
            <span className="tabular-nums text-[13px] font-semibold text-slate-900">{fmt(result.gradeCost, 2)}</span>
          </Row>

          <div className="mt-2 space-y-1.5">
            {messages.map((m, i) =>
              m.kind === 'warn' ? <Warn key={i}>{m.text}</Warn> : <Ok key={i}>{m.text}</Ok>
            )}
          </div>

          <Note>
            Compulsory grades are quoted to the client separately in section 6b, with their own markup. Special grades are pooled with the remaining security guards and quoted at the main rate in
            section 6. Remaining headcount is Guards Required less all graded headcount, and those guards are costed on the Basic Salary in section 4. Overtime, rest-day and public-holiday terms
            and all statutory rates are shared by every grade. Coverage manhours and misc costs are split between the two billing streams in proportion to headcount.
          </Note>
        </div>
      )}
    </Card>
  );
}
