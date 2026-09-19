import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { QuotationCalculator } from './useQuotationCalculator';
import { NEW_POST_ITEM } from './defaults';
import type { PostDayType, PostPeriod, PostPattern } from './types';
import { Card, ItemOut, ItemRow, NumField, Note, Row, SelectField, StrongHeaderRow, Btn, ToggleSwitch } from './ui';
import { fmt } from './format';
import { COMPLIANCE_MAX_WEEKLY_HOURS } from '../duty-roster/complianceRules';

const PATTERN_OPTION_KEYS: { value: PostPattern; labelKey: string }[] = [
  { value: 'U', labelKey: 'quotationCalculator.siteRequirement.patternU' },
  { value: 'DN', labelKey: 'quotationCalculator.siteRequirement.patternDN' },
  { value: 'WW', labelKey: 'quotationCalculator.siteRequirement.patternWW' },
  { value: 'FULL', labelKey: 'quotationCalculator.siteRequirement.patternFULL' },
  { value: 'CUSTOM', labelKey: 'quotationCalculator.siteRequirement.patternCUSTOM' },
];

const DAY_TYPE_OPTION_KEYS: { value: PostDayType; labelKey: string }[] = [
  { value: 'WD', labelKey: 'quotationCalculator.siteRequirement.dayTypeWD' },
  { value: 'WE', labelKey: 'quotationCalculator.siteRequirement.dayTypeWE' },
  { value: 'ALL', labelKey: 'quotationCalculator.siteRequirement.dayTypeALL' },
];

const PERIOD_OPTION_KEYS: { value: PostPeriod; labelKey: string }[] = [
  { value: 'D', labelKey: 'quotationCalculator.siteRequirement.periodD' },
  { value: 'N', labelKey: 'quotationCalculator.siteRequirement.periodN' },
];

const CONTRACT_UNIT_OPTION_KEYS = [
  { value: 'D' as const, labelKey: 'quotationCalculator.siteRequirement.unitDays' },
  { value: 'M' as const, labelKey: 'quotationCalculator.siteRequirement.unitMonths' },
  { value: 'Y' as const, labelKey: 'quotationCalculator.siteRequirement.unitYears' },
];

export default function SiteRequirementCard({ calc }: { calc: QuotationCalculator }) {
  const { t } = useTranslation();
  const { inputs, setField, postItems, setPostItems, result } = calc;
  const pattern = inputs.pattern;

  function updatePost(i: number, patch: Partial<(typeof postItems)[number]>) {
    setPostItems(postItems.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  }
  function removePost(i: number) {
    setPostItems(postItems.filter((_, idx) => idx !== i));
  }
  function addPost() {
    setPostItems([...postItems, { ...NEW_POST_ITEM }]);
  }

  const customTotals = postItems.reduce(
    (acc, _it, i) => {
      const b = result.postBreakdown[i];
      if (b) {
        acc.slots += b.slotsPerWeek;
        acc.mh += b.manHoursPerWeek;
      }
      return acc;
    },
    { slots: 0, mh: 0 }
  );

  return (
    <Card title={t('quotationCalculator.siteRequirement.title')}>
      <Row label={t('quotationCalculator.siteRequirement.postRequirementPattern')} htmlFor="postPattern">
        <SelectField value={pattern} onChange={(v) => setField('pattern', v)} options={PATTERN_OPTION_KEYS.map((o) => ({ value: o.value, label: t(o.labelKey) }))} width="w-64" />
      </Row>

      {pattern === 'U' && (
        <Row label={t('quotationCalculator.siteRequirement.guardPostsAll')}>
          <NumField value={inputs.postsU} onChange={(v) => setField('postsU', v)} step={1} min={0} />
        </Row>
      )}

      {pattern === 'DN' && (
        <>
          <Row label={t('quotationCalculator.siteRequirement.guardPostsDayShift')}>
            <NumField value={inputs.postsDay} onChange={(v) => setField('postsDay', v)} step={1} min={0} />
          </Row>
          <Row label={t('quotationCalculator.siteRequirement.guardPostsNightShift')}>
            <NumField value={inputs.postsNight} onChange={(v) => setField('postsNight', v)} step={1} min={0} />
          </Row>
        </>
      )}

      {pattern === 'WW' && (
        <>
          <Row label={t('quotationCalculator.siteRequirement.guardPostsWeekday')}>
            <NumField value={inputs.postsWd} onChange={(v) => setField('postsWd', v)} step={1} min={0} />
          </Row>
          <Row label={t('quotationCalculator.siteRequirement.guardPostsWeekend')}>
            <NumField value={inputs.postsWe} onChange={(v) => setField('postsWe', v)} step={1} min={0} />
          </Row>
        </>
      )}

      {pattern === 'FULL' && (
        <>
          <Row label={t('quotationCalculator.siteRequirement.guardPostsWeekdayDay')}>
            <NumField value={inputs.postsWdDay} onChange={(v) => setField('postsWdDay', v)} step={1} min={0} />
          </Row>
          <Row label={t('quotationCalculator.siteRequirement.guardPostsWeekdayNight')}>
            <NumField value={inputs.postsWdNight} onChange={(v) => setField('postsWdNight', v)} step={1} min={0} />
          </Row>
          <Row label={t('quotationCalculator.siteRequirement.guardPostsWeekendDay')}>
            <NumField value={inputs.postsWeDay} onChange={(v) => setField('postsWeDay', v)} step={1} min={0} />
          </Row>
          <Row label={t('quotationCalculator.siteRequirement.guardPostsWeekendNight')}>
            <NumField value={inputs.postsWeNight} onChange={(v) => setField('postsWeNight', v)} step={1} min={0} />
          </Row>
        </>
      )}

      <Row label={t('quotationCalculator.siteRequirement.coverageHoursPerDay')}>
        <NumField value={inputs.hoursDay} onChange={(v) => setField('hoursDay', v)} step={0.5} min={0} />
      </Row>
      <Row label={t('quotationCalculator.siteRequirement.coverageDaysPerWeek')}>
        <NumField value={inputs.daysWeek} onChange={(v) => setField('daysWeek', v)} step={1} min={0} max={7} />
      </Row>
      <Row label={t('quotationCalculator.siteRequirement.contractPeriod')}>
        <NumField value={inputs.contractMonths} onChange={(v) => setField('contractMonths', v)} step={1} min={1} width="w-20" />
        <SelectField value={inputs.contractUnit} onChange={(v) => setField('contractUnit', v)} options={CONTRACT_UNIT_OPTION_KEYS.map((o) => ({ value: o.value, label: t(o.labelKey) }))} />
      </Row>

      <div
        className={
          'rounded-lg border px-3 py-2.5 my-2 transition-colors ' +
          (inputs.complianceMode === 'Y' ? 'bg-emerald-50 border-emerald-200' : 'bg-slate-50 border-slate-200')
        }
      >
        <div className="flex items-center justify-between gap-3">
          <label htmlFor="complianceMode" className="text-[13px] font-bold text-slate-900">
            {t('quotationCalculator.siteRequirement.complianceModeLabel')}
          </label>
          <ToggleSwitch id="complianceMode" checked={inputs.complianceMode === 'Y'} onChange={(v) => setField('complianceMode', v ? 'Y' : 'N')} />
        </div>
        <p className="text-xs text-slate-600 mt-1.5">
          {t('quotationCalculator.siteRequirement.complianceModeDesc', { maxHours: COMPLIANCE_MAX_WEEKLY_HOURS })}
        </p>
      </div>

      {pattern === 'CUSTOM' && (
        <div>
          <div className="text-[10.5px] font-bold uppercase tracking-wide text-blue-700 border-l-2 border-blue-300 pl-2 mt-4 mb-1.5">{t('quotationCalculator.siteRequirement.customPostListHeading')}</div>
          <StrongHeaderRow cols={[t('quotationCalculator.siteRequirement.colPostBlock'), t('quotationCalculator.siteRequirement.colSlotsPerWeek'), t('quotationCalculator.siteRequirement.colManhoursPerWeek')]} />
          {postItems.map((it, i) => (
            <ItemRow key={i} onRemove={() => removePost(i)}>
              <NumField value={it.posts} onChange={(v) => updatePost(i, { posts: v })} step={1} min={0} width="w-14" />
              <span>{t('quotationCalculator.siteRequirement.postsUnit')}</span>
              <SelectField value={it.period} onChange={(v) => updatePost(i, { period: v })} options={PERIOD_OPTION_KEYS.map((o) => ({ value: o.value, label: t(o.labelKey) }))} />
              <span>{t('quotationCalculator.siteRequirement.at')}</span>
              <NumField value={it.hours} onChange={(v) => updatePost(i, { hours: v })} step={0.5} min={0} width="w-16" />
              <span>{t('quotationCalculator.siteRequirement.hourShiftOn')}</span>
              <SelectField value={it.dayType} onChange={(v) => updatePost(i, { dayType: v })} options={DAY_TYPE_OPTION_KEYS.map((o) => ({ value: o.value, label: t(o.labelKey) }))} />
              <span className="flex-1" />
              <ItemOut>{fmt(result.postBreakdown[i]?.slotsPerWeek, 0)}</ItemOut>
              <ItemOut>{fmt(result.postBreakdown[i]?.manHoursPerWeek, 1)}</ItemOut>
            </ItemRow>
          ))}
          <div className="mt-2">
            <Btn onClick={addPost}>{t('quotationCalculator.siteRequirement.addPostBlock')}</Btn>
          </div>
          <Row label={t('quotationCalculator.siteRequirement.totalAcrossBlocks')} strong>
            <Out>{fmt(customTotals.slots, 0)}</Out>
            <Out>{fmt(customTotals.mh, 1)}</Out>
          </Row>
          <Note>
            {t('quotationCalculator.siteRequirement.customPostListNote')}
          </Note>
        </div>
      )}

      <Row label={t('quotationCalculator.siteRequirement.shiftSlotsPerWeek')}>
        <Out>{fmt(result.slotsWeek, 1)}</Out>
      </Row>
      <Note>
        {t('quotationCalculator.siteRequirement.dayNightNote')}
      </Note>

      {inputs.complianceMode === 'Y' && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 text-amber-800 text-[12.5px] px-3 py-2 mt-2">
          {t('quotationCalculator.siteRequirement.complianceBannerIntro', { maxHours: COMPLIANCE_MAX_WEEKLY_HOURS, weeklyManHours: fmt(result.weeklyManHours, 0) })}{' '}
          <strong>{fmt(result.suggested, 0)}</strong> {t('quotationCalculator.siteRequirement.complianceBannerGuardWord', { count: result.suggested })} {t('quotationCalculator.siteRequirement.complianceBannerCapSuffix')}
          {result.suggested > result.suggestedWithoutCompliance
            ? ` ${t('quotationCalculator.siteRequirement.complianceBannerMoreThan', { extra: fmt(result.suggested - result.suggestedWithoutCompliance, 0), base: fmt(result.suggestedWithoutCompliance, 0) })}`
            : ` ${t('quotationCalculator.siteRequirement.complianceBannerAlreadyCovered')}`}
        </div>
      )}
    </Card>
  );
}

// Local Out wrapper kept file-scoped so the strong "Total across blocks" row's two numeric cells
// line up with the header's two `w-24 text-right` columns above them.
function Out({ children }: { children: ReactNode }) {
  return <span className="tabular-nums text-[13px] text-slate-800 text-right w-24 shrink-0 font-semibold">{children}</span>;
}
