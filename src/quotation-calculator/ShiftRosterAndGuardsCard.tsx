import { useTranslation } from 'react-i18next';
import type { QuotationCalculator } from './useQuotationCalculator';
import { Card, KeyRow, NumField, Note, Out, Row, Tag } from './ui';
import { fmt } from './format';

export default function ShiftRosterAndGuardsCard({ calc }: { calc: QuotationCalculator }) {
  const { t } = useTranslation();
  const { inputs, setField, result, guardsDisplay, guardsTouched, setGuards } = calc;

  return (
    <>
      <Card title={t('quotationCalculator.shiftRoster.titleShiftRoster')}>
        <Row label={t('quotationCalculator.shiftRoster.hoursPerShift')}>
          <NumField value={inputs.shiftHrs} onChange={(v) => setField('shiftHrs', v)} step={0.5} min={0.5} />
        </Row>
        <Row label={t('quotationCalculator.shiftRoster.restDaysPerWeek')}>
          <NumField value={inputs.restDays} onChange={(v) => setField('restDays', v)} step={1} min={0} max={6} />
        </Row>
        <Row label={t('quotationCalculator.shiftRoster.normalWorkingHours')}>
          <NumField value={inputs.normalHrs} onChange={(v) => setField('normalHrs', v)} step={0.5} min={0} />
        </Row>
      </Card>

      <Card title={t('quotationCalculator.shiftRoster.titleGuardsRequired')}>
        <Row label={t('quotationCalculator.shiftRoster.shiftsNeededPerDay')}>
          <Out>{fmt(result.shiftsDay, 2)}</Out>
        </Row>
        <Row label={t('quotationCalculator.shiftRoster.totalShiftSlotsPerWeek')}>
          <Out>{fmt(result.slotsWeek, 1)}</Out>
        </Row>
        <Row label={t('quotationCalculator.shiftRoster.workingDaysPerGuardPerWeek')}>
          <Out>{fmt(result.workDaysWeek, 0)}</Out>
        </Row>
        <Row label={inputs.complianceMode === 'Y' ? t('quotationCalculator.shiftRoster.guardsSuggestedCompliance') : t('quotationCalculator.shiftRoster.guardsSuggested')}>
          <Out>{fmt(result.suggested, 0)}</Out>
        </Row>
        <KeyRow label={t('quotationCalculator.shiftRoster.guardsUsedInCalculations')} htmlFor="guards" tag={<Tag>{guardsTouched ? t('quotationCalculator.shiftRoster.manualOverride') : t('quotationCalculator.shiftRoster.trackingSuggested')}</Tag>}>
          <NumField value={guardsDisplay} onChange={setGuards} step={1} min={0} />
        </KeyRow>
        <Note>
          {inputs.complianceMode === 'Y' ? t('quotationCalculator.shiftRoster.suggestedNoteCompliance') : t('quotationCalculator.shiftRoster.suggestedNote')}
        </Note>
      </Card>
    </>
  );
}
