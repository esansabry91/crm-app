import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { QuotationCalculator } from './useQuotationCalculator';
import type { SensitivityDriverKey } from './engine';
import { Card, Note, Row, SelectField } from './ui';
import { fmt } from './format';

const DRIVER_OPTION_KEYS: { value: SensitivityDriverKey; labelKey: string }[] = [
  { value: 'markup', labelKey: 'quotationCalculator.sensitivityChart.driverMarkup' },
  { value: 'guards', labelKey: 'quotationCalculator.sensitivityChart.driverGuards' },
  { value: 'basic', labelKey: 'quotationCalculator.sensitivityChart.driverBasic' },
  { value: 'otHrs', labelKey: 'quotationCalculator.sensitivityChart.driverOtHrs' },
  { value: 'otX', labelKey: 'quotationCalculator.sensitivityChart.driverOtX' },
];

const W = 470, H = 210, ML = 54, MR = 12, MT = 12, MB = 30;
const PW = W - ML - MR, PH = H - MT - MB;

export default function SensitivityChartCard({ calc }: { calc: QuotationCalculator }) {
  const { t } = useTranslation();
  const { sensitivityDriver, setSensitivityDriver, sensitivity } = calc;
  const { points, lo, hi, dp, current } = sensitivity;

  const valid = points.filter((p) => isFinite(p.y));
  let body: ReactNode = <div className="text-xs text-slate-400 py-6 text-center">{t('quotationCalculator.sensitivityChart.notEnoughRange')}</div>;

  if (valid.length && hi > lo) {
    let ymin = Math.min(...valid.map((p) => p.y));
    let ymax = Math.max(...valid.map((p) => p.y));
    if (ymax - ymin < 0.001) { ymin -= 1; ymax += 1; }
    const px = (x: number) => ML + ((x - lo) / (hi - lo)) * PW;
    const py = (y: number) => MT + ((ymax - y) / (ymax - ymin)) * PH;
    const polyPoints = points
      .filter((p) => isFinite(p.y))
      .map((p) => `${px(p.x)},${py(p.y)}`)
      .join(' ');
    const gridLines = Array.from({ length: 5 }).map((_, g) => ymin + ((ymax - ymin) * g) / 4);

    body = (
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} className="mt-1">
        {gridLines.map((yv, i) => (
          <g key={i}>
            <line x1={ML} y1={py(yv)} x2={ML + PW} y2={py(yv)} stroke="#e6ecf2" strokeWidth={1} />
            <text x={ML - 8} y={py(yv) + 4} textAnchor="end" fontSize={10} fill="#5b6b7f">
              {fmt(yv, 2)}
            </text>
          </g>
        ))}
        <polyline points={polyPoints} fill="none" stroke="#1e6f9f" strokeWidth={2.5} />
        <line x1={ML} y1={MT + PH} x2={ML + PW} y2={MT + PH} stroke="#b7c4d1" strokeWidth={1} />
        <text x={ML} y={H - 8} fontSize={10} fill="#5b6b7f">
          {fmt(lo, dp)}
        </text>
        <text x={ML + PW} y={H - 8} textAnchor="end" fontSize={10} fill="#5b6b7f">
          {fmt(hi, dp)}
        </text>
        {current && (
          <>
            <line x1={px(current.x)} y1={MT} x2={px(current.x)} y2={MT + PH} stroke="#b3261e" strokeWidth={1} strokeDasharray="4 3" />
            <circle cx={px(current.x)} cy={py(current.y)} r={4.5} fill="#b3261e" />
            <text x={Math.min(px(current.x) + 8, ML + PW - 4)} y={Math.max(py(current.y) - 9, MT + 10)} fontSize={11} fill="#b3261e" fontWeight={700}>
              {fmt(current.y, 2)}
            </text>
          </>
        )}
      </svg>
    );
  }

  return (
    <Card title={t('quotationCalculator.sensitivityChart.title')}>
      <Row label={t('quotationCalculator.sensitivityChart.driverToVary')}>
        <SelectField value={sensitivityDriver} onChange={setSensitivityDriver} options={DRIVER_OPTION_KEYS.map((o) => ({ value: o.value, label: t(o.labelKey) }))} width="w-56" />
      </Row>
      {body}
      <Note>{t('quotationCalculator.sensitivityChart.note')}</Note>
    </Card>
  );
}
