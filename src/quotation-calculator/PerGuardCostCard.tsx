import { useTranslation } from 'react-i18next';
import type { QuotationCalculator } from './useQuotationCalculator';
import { Card, NumField, Out, Row, SelectField } from './ui';
import { fmt } from './format';

const SALARY_BASIS_OPTION_KEYS = [
  { value: 'M' as const, labelKey: 'quotationCalculator.perGuardCost.monthly' },
  { value: 'D' as const, labelKey: 'quotationCalculator.perGuardCost.daily' },
];

export default function PerGuardCostCard({ calc }: { calc: QuotationCalculator }) {
  const { t } = useTranslation();
  const { inputs, setField, result } = calc;
  const otMode = inputs.otMode;
  const showOt = otMode !== 'B';
  const showFixed = otMode === 'F';
  const showMult = otMode === 'M';

  return (
    <>
      <Card title={t('quotationCalculator.perGuardCost.titleInputs')}>
        <div className="text-[10.5px] font-bold uppercase tracking-wide text-blue-700 border-l-2 border-blue-300 pl-2 mb-1.5">{t('quotationCalculator.perGuardCost.basicInputs')}</div>
        <Row label={t('quotationCalculator.perGuardCost.basicSalary')}>
          <NumField value={inputs.basic} onChange={(v) => setField('basic', v)} step={50} min={0} />
          <SelectField value={inputs.salaryBasis} onChange={(v) => setField('salaryBasis', v)} options={SALARY_BASIS_OPTION_KEYS.map((o) => ({ value: o.value, label: t(o.labelKey) }))} />
        </Row>
        <Row label={t('quotationCalculator.perGuardCost.basicSalaryMonthlyEquivalent')}>
          <Out>{fmt(result.basic, 2)}</Out>
        </Row>
        <Row label={t('quotationCalculator.perGuardCost.workingDaysPerMonth')}>
          <NumField value={inputs.workDaysMo} onChange={(v) => setField('workDaysMo', v)} step={1} min={1} />
        </Row>
        {showOt && (
          <Row label={t('quotationCalculator.perGuardCost.restDaysWorked')}>
            <NumField value={inputs.rdDays} onChange={(v) => setField('rdDays', v)} step={1} min={0} />
          </Row>
        )}
        {showOt && (
          <Row label={t('quotationCalculator.perGuardCost.publicHolidaysWorked')}>
            <NumField value={inputs.phDays} onChange={(v) => setField('phDays', v)} step={1} min={0} />
          </Row>
        )}

        {showOt && (
          <div>
            <div className="text-[10.5px] font-bold uppercase tracking-wide text-blue-700 border-l-2 border-blue-300 pl-2 mt-4 mb-1.5">{t('quotationCalculator.perGuardCost.normalOvertimeHeading')}</div>
            <Row label={t('quotationCalculator.perGuardCost.overtimeHoursPerMonth')}>
              <NumField value={inputs.otHrs} onChange={(v) => setField('otHrs', v)} step={1} min={0} />
            </Row>
            {showFixed && (
              <Row label={t('quotationCalculator.perGuardCost.overtimeRate')}>
                <NumField value={inputs.otRate} onChange={(v) => setField('otRate', v)} step={0.01} min={0} />
              </Row>
            )}
            {showMult && (
              <Row label={t('quotationCalculator.perGuardCost.overtimeRateMultiplier')}>
                <NumField value={inputs.otMult} onChange={(v) => setField('otMult', v)} step={0.05} min={0} />
              </Row>
            )}
          </div>
        )}

        {showOt && (
          <div>
            <div className="text-[10.5px] font-bold uppercase tracking-wide text-blue-700 border-l-2 border-blue-300 pl-2 mt-4 mb-1.5">{t('quotationCalculator.perGuardCost.restDayOvertimeHeading')}</div>
            <Row label={t('quotationCalculator.perGuardCost.restDayRateMultiplier')}>
              <NumField value={inputs.rdMult} onChange={(v) => setField('rdMult', v)} step={0.5} min={0} />
            </Row>
            <Row label={t('quotationCalculator.perGuardCost.restDayOtHoursPerMonth')}>
              <NumField value={inputs.rdOtHrs} onChange={(v) => setField('rdOtHrs', v)} step={1} min={0} />
            </Row>
            {showFixed && (
              <Row label={t('quotationCalculator.perGuardCost.restDayOtRate')}>
                <NumField value={inputs.rdOtRate} onChange={(v) => setField('rdOtRate', v)} step={0.01} min={0} />
              </Row>
            )}
            {showMult && (
              <Row label={t('quotationCalculator.perGuardCost.restDayOtRateMultiplier')}>
                <NumField value={inputs.rdOtMult} onChange={(v) => setField('rdOtMult', v)} step={0.5} min={0} />
              </Row>
            )}
          </div>
        )}

        {showOt && (
          <div>
            <div className="text-[10.5px] font-bold uppercase tracking-wide text-blue-700 border-l-2 border-blue-300 pl-2 mt-4 mb-1.5">{t('quotationCalculator.perGuardCost.publicHolidayOvertimeHeading')}</div>
            <Row label={t('quotationCalculator.perGuardCost.publicHolidayRateMultiplier')}>
              <NumField value={inputs.phMult} onChange={(v) => setField('phMult', v)} step={0.5} min={0} />
            </Row>
            <Row label={t('quotationCalculator.perGuardCost.publicHolidayOtHoursPerMonth')}>
              <NumField value={inputs.phOtHrs} onChange={(v) => setField('phOtHrs', v)} step={1} min={0} />
            </Row>
            {showFixed && (
              <Row label={t('quotationCalculator.perGuardCost.publicHolidayOtRate')}>
                <NumField value={inputs.phOtRate} onChange={(v) => setField('phOtRate', v)} step={0.01} min={0} />
              </Row>
            )}
            {showMult && (
              <Row label={t('quotationCalculator.perGuardCost.publicHolidayOtRateMultiplier')}>
                <NumField value={inputs.phOtMult} onChange={(v) => setField('phOtMult', v)} step={0.5} min={0} />
              </Row>
            )}
          </div>
        )}

        <div className="text-[10.5px] font-bold uppercase tracking-wide text-blue-700 border-l-2 border-blue-300 pl-2 mt-4 mb-1.5">{t('quotationCalculator.perGuardCost.statutoryHeading')}</div>
        <Row label={t('quotationCalculator.perGuardCost.epfRate')}>
          <NumField value={inputs.epf} onChange={(v) => setField('epf', v)} step={0.1} min={0} />
        </Row>
        <Row label={t('quotationCalculator.perGuardCost.socsoRate')}>
          <NumField value={inputs.socso} onChange={(v) => setField('socso', v)} step={0.05} min={0} />
        </Row>
        <Row label={t('quotationCalculator.perGuardCost.eisRate')}>
          <NumField value={inputs.eis} onChange={(v) => setField('eis', v)} step={0.05} min={0} />
        </Row>
        <Row label={t('quotationCalculator.perGuardCost.socsoEisCeiling')}>
          <NumField value={inputs.ceiling} onChange={(v) => setField('ceiling', v)} step={100} min={0} />
        </Row>
      </Card>

      <Card title={t('quotationCalculator.perGuardCost.titleBuildUp')}>
        <Row label={t('quotationCalculator.perGuardCost.normalHoursPerMonth')}>
          <Out>{fmt(result.normalHrsMo, 1)}</Out>
        </Row>
        <Row label={t('quotationCalculator.perGuardCost.hourlyBasicRate')}>
          <Out>{fmt(result.hourly, 2)}</Out>
        </Row>
        <Row label={t('quotationCalculator.perGuardCost.allowance')}>
          <Out>{fmt(result.allowPay, 2)}</Out>
        </Row>
        <Row label={t('quotationCalculator.perGuardCost.overtimePay')}>
          <Out>{fmt(result.otPay, 2)}</Out>
        </Row>
        <Row label={t('quotationCalculator.perGuardCost.restDayPay')}>
          <Out>{fmt(result.rdPay, 2)}</Out>
        </Row>
        <Row label={t('quotationCalculator.perGuardCost.restDayOtPay')}>
          <Out>{fmt(result.rdOtPay, 2)}</Out>
        </Row>
        <Row label={t('quotationCalculator.perGuardCost.publicHolidayPay')}>
          <Out>{fmt(result.phPay, 2)}</Out>
        </Row>
        <Row label={t('quotationCalculator.perGuardCost.publicHolidayOtPay')}>
          <Out>{fmt(result.phOtPay, 2)}</Out>
        </Row>
        <Row label={t('quotationCalculator.perGuardCost.grossMonthlyWages')} strong>
          <Out strong>{fmt(result.gross, 2)}</Out>
        </Row>
        <Row label={t('quotationCalculator.perGuardCost.epfContribution')}>
          <Out>{fmt(result.epfAmt, 2)}</Out>
        </Row>
        <Row label={t('quotationCalculator.perGuardCost.socsoContribution')}>
          <Out>{fmt(result.socsoAmt, 2)}</Out>
        </Row>
        <Row label={t('quotationCalculator.perGuardCost.eisContribution')}>
          <Out>{fmt(result.eisAmt, 2)}</Out>
        </Row>
        <Row label={t('quotationCalculator.perGuardCost.totalCostPerGuard', { pw: result.pw })} strong>
          <Out strong>{fmt(result.costGuardPP, 2)}</Out>
        </Row>
      </Card>
    </>
  );
}
