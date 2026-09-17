import type { ReactNode } from 'react';
import type { QuotationCalculator } from './useQuotationCalculator';
import { NEW_POST_ITEM } from './defaults';
import type { ComplianceMode, PostDayType, PostPeriod, PostPattern } from './types';
import { Card, ItemOut, ItemRow, NumField, Note, Row, SelectField, StrongHeaderRow, Btn } from './ui';
import { fmt } from './format';
import { COMPLIANCE_MAX_WEEKLY_HOURS } from '../duty-roster/complianceRules';

const PATTERN_OPTIONS: { value: PostPattern; label: string }[] = [
  { value: 'U', label: 'Same posts at all times' },
  { value: 'DN', label: 'Different posts for day and night shift' },
  { value: 'WW', label: 'Different posts for weekday and weekend (day = night)' },
  { value: 'FULL', label: 'Different posts for weekday/weekend and day/night' },
  { value: 'CUSTOM', label: 'Custom post list - mixed shift hours' },
];

const DAY_TYPE_OPTIONS: { value: PostDayType; label: string }[] = [
  { value: 'WD', label: 'Weekday' },
  { value: 'WE', label: 'Weekend' },
  { value: 'ALL', label: 'Every day' },
];

const PERIOD_OPTIONS: { value: PostPeriod; label: string }[] = [
  { value: 'D', label: 'Day shift' },
  { value: 'N', label: 'Night shift' },
];

const CONTRACT_UNIT_OPTIONS = [
  { value: 'D' as const, label: 'Days' },
  { value: 'M' as const, label: 'Months' },
  { value: 'Y' as const, label: 'Years' },
];

const COMPLIANCE_MODE_OPTIONS: { value: ComplianceMode; label: string }[] = [
  { value: 'N', label: 'Off' },
  { value: 'Y', label: 'On' },
];

export default function SiteRequirementCard({ calc }: { calc: QuotationCalculator }) {
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
    <Card title="1. Client Site Requirement">
      <Row label="Post Requirement Pattern" htmlFor="postPattern">
        <SelectField value={pattern} onChange={(v) => setField('pattern', v)} options={PATTERN_OPTIONS} width="w-64" />
      </Row>

      {pattern === 'U' && (
        <Row label="Guard Posts (all shifts, all days)">
          <NumField value={inputs.postsU} onChange={(v) => setField('postsU', v)} step={1} min={0} />
        </Row>
      )}

      {pattern === 'DN' && (
        <>
          <Row label="Guard Posts - Day Shift">
            <NumField value={inputs.postsDay} onChange={(v) => setField('postsDay', v)} step={1} min={0} />
          </Row>
          <Row label="Guard Posts - Night Shift">
            <NumField value={inputs.postsNight} onChange={(v) => setField('postsNight', v)} step={1} min={0} />
          </Row>
        </>
      )}

      {pattern === 'WW' && (
        <>
          <Row label="Guard Posts - Weekday (Mon-Fri)">
            <NumField value={inputs.postsWd} onChange={(v) => setField('postsWd', v)} step={1} min={0} />
          </Row>
          <Row label="Guard Posts - Weekend (Sat-Sun)">
            <NumField value={inputs.postsWe} onChange={(v) => setField('postsWe', v)} step={1} min={0} />
          </Row>
        </>
      )}

      {pattern === 'FULL' && (
        <>
          <Row label="Guard Posts - Weekday Day Shift">
            <NumField value={inputs.postsWdDay} onChange={(v) => setField('postsWdDay', v)} step={1} min={0} />
          </Row>
          <Row label="Guard Posts - Weekday Night Shift">
            <NumField value={inputs.postsWdNight} onChange={(v) => setField('postsWdNight', v)} step={1} min={0} />
          </Row>
          <Row label="Guard Posts - Weekend Day Shift">
            <NumField value={inputs.postsWeDay} onChange={(v) => setField('postsWeDay', v)} step={1} min={0} />
          </Row>
          <Row label="Guard Posts - Weekend Night Shift">
            <NumField value={inputs.postsWeNight} onChange={(v) => setField('postsWeNight', v)} step={1} min={0} />
          </Row>
        </>
      )}

      <Row label="Coverage Hours per Day">
        <NumField value={inputs.hoursDay} onChange={(v) => setField('hoursDay', v)} step={0.5} min={0} />
      </Row>
      <Row label="Coverage Days per Week">
        <NumField value={inputs.daysWeek} onChange={(v) => setField('daysWeek', v)} step={1} min={0} max={7} />
      </Row>
      <Row label="Contract Period">
        <NumField value={inputs.contractMonths} onChange={(v) => setField('contractMonths', v)} step={1} min={1} width="w-20" />
        <SelectField value={inputs.contractUnit} onChange={(v) => setField('contractUnit', v)} options={CONTRACT_UNIT_OPTIONS} />
      </Row>

      <Row label="RBA/SMETA Compliance Mode" htmlFor="complianceMode">
        <SelectField value={inputs.complianceMode} onChange={(v) => setField('complianceMode', v)} options={COMPLIANCE_MODE_OPTIONS} width="w-32" />
      </Row>
      <Note>
        Caps every guard at {COMPLIANCE_MAX_WEEKLY_HOURS}h/week (regular + OT combined) when quoting a client site that must comply with the RBA Code of Conduct, SMETA/ETI, or Malaysia&apos;s
        Employment Act — the strictest of the three, so it satisfies all of them at once. When on, Guards Required - Suggested (Section 3) and every downstream cost/quote figure reflect the
        headcount actually needed to stay compliant, not just the bare roster-coverage minimum.
      </Note>

      {pattern === 'CUSTOM' && (
        <div>
          <div className="text-[10.5px] font-bold uppercase tracking-wide text-blue-700 border-l-2 border-blue-300 pl-2 mt-4 mb-1.5">Custom post list</div>
          <StrongHeaderRow cols={['Post block', 'Slots / week', 'Manhours / week']} />
          {postItems.map((it, i) => (
            <ItemRow key={i} onRemove={() => removePost(i)}>
              <NumField value={it.posts} onChange={(v) => updatePost(i, { posts: v })} step={1} min={0} width="w-14" />
              <span>post(s)</span>
              <SelectField value={it.period} onChange={(v) => updatePost(i, { period: v })} options={PERIOD_OPTIONS} />
              <span>at</span>
              <NumField value={it.hours} onChange={(v) => updatePost(i, { hours: v })} step={0.5} min={0} width="w-16" />
              <span>hour shift on</span>
              <SelectField value={it.dayType} onChange={(v) => updatePost(i, { dayType: v })} options={DAY_TYPE_OPTIONS} />
              <span className="flex-1" />
              <ItemOut>{fmt(result.postBreakdown[i]?.slotsPerWeek, 0)}</ItemOut>
              <ItemOut>{fmt(result.postBreakdown[i]?.manHoursPerWeek, 1)}</ItemOut>
            </ItemRow>
          ))}
          <div className="mt-2">
            <Btn onClick={addPost}>Add post block</Btn>
          </div>
          <Row label="Total across blocks" strong>
            <Out>{fmt(customTotals.slots, 0)}</Out>
            <Out>{fmt(customTotals.mh, 1)}</Out>
          </Row>
          <Note>
            Each block is a number of posts covering one shift length, on weekdays, weekends or every day, in the day or night period. Example: 1 post day shift 12 hours on weekdays, plus 2
            posts day shift 16 hours on weekdays. Blocks are independent so shift lengths can differ. In this mode Coverage Hours per Day and Hours per Shift no longer drive coverage - Hours per
            Shift still drives the wage build-up - and Coverage Days per Week still decides which days are worked.
          </Note>
        </div>
      )}

      <Row label="Shift Slots per Week (all posts)">
        <Out>{fmt(result.slotsWeek, 1)}</Out>
      </Row>
      <Note>
        A shift counts as day when it starts between 06:00 and 18:00 (derived from Roster Start Hour and Hours per Shift); anything else is night. Weekend means Saturday and Sunday. If Coverage
        Days per Week is 5 or fewer, weekend posts are never used.
      </Note>

      {inputs.complianceMode === 'Y' && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 text-amber-800 text-[12.5px] px-3 py-2 mt-2">
          RBA/SMETA compliance mode is on: no guard may exceed {COMPLIANCE_MAX_WEEKLY_HOURS}h/week. This site&apos;s ~{fmt(result.weeklyManHours, 0)}h/week of coverage needs at least{' '}
          <strong>{fmt(result.suggested, 0)}</strong> guard{result.suggested === 1 ? '' : 's'} to keep every guard&apos;s shifts under that cap
          {result.suggested > result.suggestedWithoutCompliance
            ? ` — ${fmt(result.suggested - result.suggestedWithoutCompliance, 0)} more than the ${fmt(result.suggestedWithoutCompliance, 0)} the roster math alone would suggest.`
            : ' (already covered by the roster math alone).'}
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
