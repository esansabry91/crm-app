import type { QuotationCalculator } from './useQuotationCalculator';
import { Card, NumField, Out, Row, SelectField } from './ui';
import { fmt } from './format';

const SALARY_BASIS_OPTIONS = [
  { value: 'M' as const, label: 'Monthly' },
  { value: 'D' as const, label: 'Daily' },
];

export default function PerGuardCostCard({ calc }: { calc: QuotationCalculator }) {
  const { inputs, setField, result } = calc;
  const otMode = inputs.otMode;
  const showOt = otMode !== 'B';
  const showFixed = otMode === 'F';
  const showMult = otMode === 'M';

  return (
    <>
      <Card title="4. Per-Guard Monthly Cost - Inputs">
        <div className="text-[10.5px] font-bold uppercase tracking-wide text-blue-700 border-l-2 border-blue-300 pl-2 mb-1.5">Basic Inputs</div>
        <Row label="Basic Salary (RM)">
          <NumField value={inputs.basic} onChange={(v) => setField('basic', v)} step={50} min={0} />
          <SelectField value={inputs.salaryBasis} onChange={(v) => setField('salaryBasis', v)} options={SALARY_BASIS_OPTIONS} />
        </Row>
        <Row label="Basic Salary - Monthly Equivalent (RM)">
          <Out>{fmt(result.basic, 2)}</Out>
        </Row>
        <Row label="Working Days per Month">
          <NumField value={inputs.workDaysMo} onChange={(v) => setField('workDaysMo', v)} step={1} min={1} />
        </Row>
        {showOt && (
          <Row label="Rest Days Worked per Month (within normal shift)">
            <NumField value={inputs.rdDays} onChange={(v) => setField('rdDays', v)} step={1} min={0} />
          </Row>
        )}
        {showOt && (
          <Row label="Public Holidays Worked per Month (within shift)">
            <NumField value={inputs.phDays} onChange={(v) => setField('phDays', v)} step={1} min={0} />
          </Row>
        )}

        {showOt && (
          <div>
            <div className="text-[10.5px] font-bold uppercase tracking-wide text-blue-700 border-l-2 border-blue-300 pl-2 mt-4 mb-1.5">Normal Overtime</div>
            <Row label="Overtime Hours per Month (per guard)">
              <NumField value={inputs.otHrs} onChange={(v) => setField('otHrs', v)} step={1} min={0} />
            </Row>
            {showFixed && (
              <Row label="Overtime Rate (RM per hour)">
                <NumField value={inputs.otRate} onChange={(v) => setField('otRate', v)} step={0.01} min={0} />
              </Row>
            )}
            {showMult && (
              <Row label="Overtime Rate Multiplier (x normal hourly rate)">
                <NumField value={inputs.otMult} onChange={(v) => setField('otMult', v)} step={0.05} min={0} />
              </Row>
            )}
          </div>
        )}

        {showOt && (
          <div>
            <div className="text-[10.5px] font-bold uppercase tracking-wide text-blue-700 border-l-2 border-blue-300 pl-2 mt-4 mb-1.5">Rest Day Overtime</div>
            <Row label="Rest Day Rate Multiplier (x normal daily rate)">
              <NumField value={inputs.rdMult} onChange={(v) => setField('rdMult', v)} step={0.5} min={0} />
            </Row>
            <Row label="Rest Day OT Hours per Month (beyond shift)">
              <NumField value={inputs.rdOtHrs} onChange={(v) => setField('rdOtHrs', v)} step={1} min={0} />
            </Row>
            {showFixed && (
              <Row label="Rest Day OT Rate (RM per hour)">
                <NumField value={inputs.rdOtRate} onChange={(v) => setField('rdOtRate', v)} step={0.01} min={0} />
              </Row>
            )}
            {showMult && (
              <Row label="Rest Day OT Rate Multiplier (x normal hourly rate)">
                <NumField value={inputs.rdOtMult} onChange={(v) => setField('rdOtMult', v)} step={0.5} min={0} />
              </Row>
            )}
          </div>
        )}

        {showOt && (
          <div>
            <div className="text-[10.5px] font-bold uppercase tracking-wide text-blue-700 border-l-2 border-blue-300 pl-2 mt-4 mb-1.5">Public Holiday Overtime</div>
            <Row label="Public Holiday Rate Multiplier (x normal daily rate)">
              <NumField value={inputs.phMult} onChange={(v) => setField('phMult', v)} step={0.5} min={0} />
            </Row>
            <Row label="Public Holiday OT Hours per Month (beyond shift)">
              <NumField value={inputs.phOtHrs} onChange={(v) => setField('phOtHrs', v)} step={1} min={0} />
            </Row>
            {showFixed && (
              <Row label="Public Holiday OT Rate (RM per hour)">
                <NumField value={inputs.phOtRate} onChange={(v) => setField('phOtRate', v)} step={0.01} min={0} />
              </Row>
            )}
            {showMult && (
              <Row label="Public Holiday OT Rate Multiplier (x normal hourly rate)">
                <NumField value={inputs.phOtMult} onChange={(v) => setField('phOtMult', v)} step={0.5} min={0} />
              </Row>
            )}
          </div>
        )}

        <div className="text-[10.5px] font-bold uppercase tracking-wide text-blue-700 border-l-2 border-blue-300 pl-2 mt-4 mb-1.5">Statutory Employer Contribution</div>
        <Row label="EPF Employer Contribution Rate (%)">
          <NumField value={inputs.epf} onChange={(v) => setField('epf', v)} step={0.1} min={0} />
        </Row>
        <Row label="SOCSO Employer Contribution Rate (%)">
          <NumField value={inputs.socso} onChange={(v) => setField('socso', v)} step={0.05} min={0} />
        </Row>
        <Row label="EIS Employer Contribution Rate (%)">
          <NumField value={inputs.eis} onChange={(v) => setField('eis', v)} step={0.05} min={0} />
        </Row>
        <Row label="SOCSO/EIS Wage Ceiling (RM)">
          <NumField value={inputs.ceiling} onChange={(v) => setField('ceiling', v)} step={100} min={0} />
        </Row>
      </Card>

      <Card title="4b. Per-Guard Monthly Cost - Build-Up">
        <Row label="Normal Hours per Month (per guard)">
          <Out>{fmt(result.normalHrsMo, 1)}</Out>
        </Row>
        <Row label="Hourly Basic Rate (RM/hr)">
          <Out>{fmt(result.hourly, 2)}</Out>
        </Row>
        <Row label="Allowance (RM)">
          <Out>{fmt(result.allowPay, 2)}</Out>
        </Row>
        <Row label="Overtime Pay (RM)">
          <Out>{fmt(result.otPay, 2)}</Out>
        </Row>
        <Row label="Rest Day Pay (RM)">
          <Out>{fmt(result.rdPay, 2)}</Out>
        </Row>
        <Row label="Rest Day OT Pay (RM)">
          <Out>{fmt(result.rdOtPay, 2)}</Out>
        </Row>
        <Row label="Public Holiday Pay (RM)">
          <Out>{fmt(result.phPay, 2)}</Out>
        </Row>
        <Row label="Public Holiday OT Pay (RM)">
          <Out>{fmt(result.phOtPay, 2)}</Out>
        </Row>
        <Row label="Gross Monthly Wages (RM)" strong>
          <Out strong>{fmt(result.gross, 2)}</Out>
        </Row>
        <Row label="EPF Employer Contribution (on basic salary) (RM)">
          <Out>{fmt(result.epfAmt, 2)}</Out>
        </Row>
        <Row label="SOCSO Employer Contribution (RM)">
          <Out>{fmt(result.socsoAmt, 2)}</Out>
        </Row>
        <Row label="EIS Employer Contribution (RM)">
          <Out>{fmt(result.eisAmt, 2)}</Out>
        </Row>
        <Row label={`Total ${result.pw} Cost per Guard (RM)`} strong>
          <Out strong>{fmt(result.costGuardPP, 2)}</Out>
        </Row>
      </Card>
    </>
  );
}
