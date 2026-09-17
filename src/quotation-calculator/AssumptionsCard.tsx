import type { QuotationCalculator } from './useQuotationCalculator';
import { Card, Note } from './ui';

const OT_MODE_NOTES: Record<'F' | 'M' | 'B', string> = {
  F: 'Overtime mode: FIXED RATE. Every overtime hour is paid at the RM per hour entered above, independent of the basic hourly rate.',
  M: 'Overtime mode: MULTIPLIER. Every overtime hour is paid at the multiplier times the basic hourly rate, so it moves with basic salary.',
  B: 'Overtime mode: ONLY BASIC. Overtime, rest day pay and public holiday pay are excluded entirely - cost per guard is based on basic salary (plus statutory contributions) only.',
};

export default function AssumptionsCard({ calc }: { calc: QuotationCalculator }) {
  const otMode = calc.inputs.otMode;
  return (
    <Card title="Assumption Sources">
      <Note>EPF employer rate 13% applies for monthly wages up to RM5,000 (12% above) - per KWSP Third Schedule. EPF is charged on basic salary only, not on overtime or premium pay.</Note>
      <Note>SOCSO (Category 1) and EIS employer rates are simplified flat-rate approximations of PERKESO tiered contribution tables; use the official PERKESO table for payroll-exact figures.</Note>
      <Note>{OT_MODE_NOTES[otMode]}</Note>
    </Card>
  );
}
