import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { QuotationCalculator } from './useQuotationCalculator';
import { NEW_GRADE_COMPULSORY, NEW_GRADE_SPECIAL } from './defaults';
import type { GradeItem } from './types';
import { Btn, Card, ItemOut, ItemRow, NumField, Note, Ok, Row, SelectField, StrongHeaderRow, TextField, Warn } from './ui';
import { fmt } from './format';

const GRADES_ON_OPTION_KEYS = [
  { value: 'N' as const, labelKey: 'quotationCalculator.guardGrades.gradesOffOption' },
  { value: 'Y' as const, labelKey: 'quotationCalculator.guardGrades.gradesOnOption' },
];

function GradeList({
  items,
  costs,
  kind,
  onUpdate,
  onRemove,
  t,
}: {
  items: GradeItem[];
  costs: { costPerPerson: number; totalCost: number }[];
  kind: 'C' | 'S';
  onUpdate: (i: number, patch: Partial<GradeItem>) => void;
  onRemove: (i: number) => void;
  t: TFunction;
}) {
  return (
    <>
      {items.map((it, i) =>
        it.kind === kind ? (
          <ItemRow key={i} onRemove={() => onRemove(i)}>
            <TextField value={it.name} onChange={(v) => onUpdate(i, { name: v })} width="w-32" />
            <span>{t('quotationCalculator.guardGrades.pax')}</span>
            <NumField value={it.n} onChange={(v) => onUpdate(i, { n: v })} step={1} min={0} width="w-14" />
            <span>{t('quotationCalculator.guardGrades.basicRm')}</span>
            <NumField value={it.basic} onChange={(v) => onUpdate(i, { basic: v })} step={50} min={0} width="w-20" />
            <span>{t('quotationCalculator.guardGrades.allowRm')}</span>
            <NumField value={it.allow} onChange={(v) => onUpdate(i, { allow: v })} step={10} min={0} width="w-16" />
            <span>{t('quotationCalculator.guardGrades.to')}</span>
            <NumField value={it.na} onChange={(v) => onUpdate(i, { na: v })} step={1} min={0} width="w-14" />
            <span>{t('quotationCalculator.guardGrades.pax')}</span>
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
  const { t } = useTranslation();
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
      messages.push({ kind: 'warn', text: t('quotationCalculator.guardGrades.warnAllowanceExceedsHeadcount', { names: over.join(', ') }) });
    }
    if (result.headGraded > result.guardsRequired) {
      messages.push({
        kind: 'warn',
        text: t('quotationCalculator.guardGrades.warnGradedExceedsRequired', { graded: result.headGraded, required: result.guardsRequired, total: result.totalHead }),
      });
    } else {
      messages.push({ kind: 'ok', text: t('quotationCalculator.guardGrades.okHeadcountSummary', { graded: result.headGraded, remaining: result.remaining, total: result.totalHead }) });
    }
    if (result.headC <= 0) messages.push({ kind: 'warn', text: t('quotationCalculator.guardGrades.warnNoCompulsoryGrades') });
  }

  return (
    <Card title={t('quotationCalculator.guardGrades.title')}>
      <Row label={t('quotationCalculator.guardGrades.useGuardGrades')} htmlFor="gradesOn">
        <SelectField value={inputs.gradesOn} onChange={(v) => setField('gradesOn', v)} options={GRADES_ON_OPTION_KEYS.map((o) => ({ value: o.value, label: t(o.labelKey) }))} width="w-40" />
      </Row>

      {on && (
        <div>
          <div className="text-[10.5px] font-bold uppercase tracking-wide text-blue-700 border-l-2 border-blue-300 pl-2 mt-4 mb-1.5">
            {t('quotationCalculator.guardGrades.compulsoryHeading')}
          </div>
          <StrongHeaderRow cols={[t('quotationCalculator.guardGrades.colGradeHeadcount'), t('quotationCalculator.guardGrades.colCostPerPerson'), t('quotationCalculator.guardGrades.colTotalCost')]} />
          <GradeList items={gradeItems} costs={result.gradeItemCosts} kind="C" onUpdate={updateGrade} onRemove={removeGrade} t={t} />
          <div className="mt-2">
            <Btn onClick={addCompulsory}>{t('quotationCalculator.guardGrades.addCompulsoryGrade')}</Btn>
          </div>

          <div className="text-[10.5px] font-bold uppercase tracking-wide text-blue-700 border-l-2 border-blue-300 pl-2 mt-4 mb-1.5">
            {t('quotationCalculator.guardGrades.specialHeading')}
          </div>
          <StrongHeaderRow cols={[t('quotationCalculator.guardGrades.colGradeHeadcount'), t('quotationCalculator.guardGrades.colCostPerPerson'), t('quotationCalculator.guardGrades.colTotalCost')]} />
          <GradeList items={gradeItems} costs={result.gradeItemCosts} kind="S" onUpdate={updateGrade} onRemove={removeGrade} t={t} />
          <div className="mt-2">
            <Btn onClick={addSpecial}>{t('quotationCalculator.guardGrades.addSpecialGrade')}</Btn>
          </div>

          <Row label={t('quotationCalculator.guardGrades.headcountInGradedRoles')}>
            <span className="tabular-nums text-[13px] text-slate-800">{fmt(result.headGraded, 0)}</span>
          </Row>
          <Row label={t('quotationCalculator.guardGrades.remainingSecurityGuards')}>
            <span className="tabular-nums text-[13px] text-slate-800">{fmt(result.remaining, 0)}</span>
          </Row>
          <Row label={t('quotationCalculator.guardGrades.totalHeadcountCost')} strong>
            <span className="tabular-nums text-[13px] font-semibold text-slate-900">{fmt(result.totalHead, 0)}</span>
            <span className="tabular-nums text-[13px] font-semibold text-slate-900">{fmt(result.gradeCost, 2)}</span>
          </Row>

          <div className="mt-2 space-y-1.5">
            {messages.map((m, i) =>
              m.kind === 'warn' ? <Warn key={i}>{m.text}</Warn> : <Ok key={i}>{m.text}</Ok>
            )}
          </div>

          <Note>
            {t('quotationCalculator.guardGrades.note')}
          </Note>
        </div>
      )}
    </Card>
  );
}
