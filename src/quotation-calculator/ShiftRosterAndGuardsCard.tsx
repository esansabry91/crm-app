import type { QuotationCalculator } from './useQuotationCalculator';
import { Card, KeyRow, NumField, Note, Out, Row, Tag } from './ui';
import { fmt } from './format';

export default function ShiftRosterAndGuardsCard({ calc }: { calc: QuotationCalculator }) {
  const { inputs, setField, result, guardsDisplay, guardsTouched, setGuards } = calc;

  return (
    <>
      <Card title="2. Shift and Roster Parameters">
        <Row label="Hours per Shift">
          <NumField value={inputs.shiftHrs} onChange={(v) => setField('shiftHrs', v)} step={0.5} min={0.5} />
        </Row>
        <Row label="Rest Days per Guard per Week">
          <NumField value={inputs.restDays} onChange={(v) => setField('restDays', v)} step={1} min={0} max={6} />
        </Row>
        <Row label="Normal Working Hours (per day)">
          <NumField value={inputs.normalHrs} onChange={(v) => setField('normalHrs', v)} step={0.5} min={0} />
        </Row>
      </Card>

      <Card title="3. Guards Required">
        <Row label="Shifts Needed per Day">
          <Out>{fmt(result.shiftsDay, 2)}</Out>
        </Row>
        <Row label="Total Shift-Slots per Week">
          <Out>{fmt(result.slotsWeek, 1)}</Out>
        </Row>
        <Row label="Working Days per Guard per Week">
          <Out>{fmt(result.workDaysWeek, 0)}</Out>
        </Row>
        <Row label={inputs.complianceMode === 'Y' ? 'Guards Required - Suggested (roster math + compliance cap)' : 'Guards Required - Suggested (from roster math)'}>
          <Out>{fmt(result.suggested, 0)}</Out>
        </Row>
        <KeyRow label="Guards Required - USED IN ALL CALCULATIONS" htmlFor="guards" tag={<Tag>{guardsTouched ? 'manual override' : 'tracking suggested'}</Tag>}>
          <NumField value={guardsDisplay} onChange={setGuards} step={1} min={0} />
        </KeyRow>
        <Note>
          The suggested figure assumes each guard covers one shift on each working day (rest days rotate across the roster)
          {inputs.complianceMode === 'Y' ? ', raised as needed to keep every guard under the RBA/SMETA compliance cap set in Section 1' : ''}. The editable field is what every downstream
          calculation uses - it follows the suggestion automatically until you change it. Press Sync to suggested to reconnect it.
        </Note>
      </Card>
    </>
  );
}
