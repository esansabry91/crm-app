import { useTranslation } from 'react-i18next';
import type { QuotationCalculator } from './useQuotationCalculator';
import { Card, Note } from './ui';

const OT_MODE_NOTE_KEYS: Record<'F' | 'M' | 'B', string> = {
  F: 'quotationCalculator.assumptions.otModeFixed',
  M: 'quotationCalculator.assumptions.otModeMultiplier',
  B: 'quotationCalculator.assumptions.otModeOnlyBasic',
};

export default function AssumptionsCard({ calc }: { calc: QuotationCalculator }) {
  const { t } = useTranslation();
  const otMode = calc.inputs.otMode;
  return (
    <Card title={t('quotationCalculator.assumptions.title')}>
      <Note>{t('quotationCalculator.assumptions.epfNote')}</Note>
      <Note>{t('quotationCalculator.assumptions.socsoEisNote')}</Note>
      <Note>{t(OT_MODE_NOTE_KEYS[otMode])}</Note>
    </Card>
  );
}
