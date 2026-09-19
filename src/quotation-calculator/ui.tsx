/**
 * Shared presentational primitives for the Quotation Calculator's cards — a Tailwind-based
 * restyle of index.html's bespoke `<style>` block (`.card`, `.row`, `.out`, `.msub`, `.note`,
 * `.warn`/`.okmsg`, `.tag`, `.xbtn`, `input[type=number]` etc.), matching the visual language
 * already established by the Duty Roster / Branch Collection ports (rounded-xl white cards,
 * slate borders, blue/emerald accents — see e.g. SummaryReportPanel.tsx) rather than
 * reproducing the original page's own gradient-hero design system one-for-one. Functionally
 * these are drop-in equivalents of the original CSS classes.
 */
import type { InputHTMLAttributes, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

export function Card({ title, tag, children, id }: { title: ReactNode; tag?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <div id={id} className="rounded-xl border border-slate-200 bg-white p-4 mb-4">
      <h2 className="text-[11px] font-bold uppercase tracking-wider text-blue-800 border-b border-slate-100 pb-2 mb-3">
        {title}
        {tag}
      </h2>
      {children}
    </div>
  );
}

export function SubHeading({ children }: { children: ReactNode }) {
  return <div className="text-[10.5px] font-bold uppercase tracking-wide text-blue-700 border-l-2 border-blue-300 pl-2 mt-4 mb-1.5">{children}</div>;
}

export function Row({
  label,
  htmlFor,
  strong,
  children,
}: {
  label: ReactNode;
  htmlFor?: string;
  strong?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={
        'flex items-center justify-between gap-3 py-1.5 border-b border-dotted border-slate-100 last:border-0' +
        (strong ? ' bg-slate-50 -mx-2 px-2 rounded-md border-b border-slate-200' : '')
      }
    >
      <label htmlFor={htmlFor} className={'text-[13px] text-slate-600 flex-1' + (strong ? ' font-semibold text-slate-900' : '')}>
        {label}
      </label>
      <div className="flex items-center gap-2 shrink-0">{children}</div>
    </div>
  );
}

export function KeyRow({ label, htmlFor, tag, children }: { label: ReactNode; htmlFor?: string; tag?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 px-2.5 -mx-2 my-1 rounded-md bg-emerald-50 border-y border-emerald-100 border-l-2 border-l-emerald-500">
      <label htmlFor={htmlFor} className="text-[13px] font-bold text-slate-900 flex-1">
        {label}
        {tag}
      </label>
      <div className="flex items-center gap-2 shrink-0">{children}</div>
    </div>
  );
}

/** A color-coded on/off switch — green track + "ON" when checked, gray track + "OFF" when not, so
 *  the state reads at a glance rather than needing to open a dropdown to see which value is
 *  selected. Color is never the only signal (the ON/OFF text is always shown alongside it). */
export function ToggleSwitch({ checked, onChange, id }: { checked: boolean; onChange: (v: boolean) => void; id?: string }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex items-center gap-2 focus:outline-none group"
    >
      <span
        className={
          'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors ' +
          (checked
            ? 'bg-emerald-500 border-emerald-600 group-focus-visible:ring-2 group-focus-visible:ring-emerald-300'
            : 'bg-slate-300 border-slate-400 group-focus-visible:ring-2 group-focus-visible:ring-slate-300')
        }
      >
        <span
          className={
            'inline-block h-[18px] w-[18px] transform rounded-full bg-white shadow transition-transform ' +
            (checked ? 'translate-x-[22px]' : 'translate-x-[3px]')
          }
        />
      </span>
      <span className={'text-[11px] font-bold tracking-wide w-6 ' + (checked ? 'text-emerald-700' : 'text-slate-500')}>{checked ? t('quotationCalculator.ui.on') : t('quotationCalculator.ui.off')}</span>
    </button>
  );
}

export function Out({ children, strong }: { children: ReactNode; strong?: boolean }) {
  return <span className={'tabular-nums text-[13px] text-slate-800 text-right min-w-[6.5rem]' + (strong ? ' font-semibold' : '')}>{children}</span>;
}

type NumProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'type'> & {
  value: number;
  onChange: (v: number) => void;
  width?: string;
};

export function NumField({ value, onChange, width, className, ...rest }: NumProps) {
  return (
    <input
      type="number"
      value={Number.isFinite(value) ? value : ''}
      onFocus={(e) => e.target.select()}
      onChange={(e) => {
        const n = parseFloat(e.target.value);
        onChange(isFinite(n) ? n : 0);
      }}
      className={
        'rounded-md border border-amber-200 bg-amber-50/50 px-2 py-1 text-[13px] text-right tabular-nums text-blue-900 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400 ' +
        (width || 'w-24') +
        (className ? ' ' + className : '')
      }
      {...rest}
    />
  );
}

export function TextField({
  value,
  onChange,
  width,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  width?: string;
  placeholder?: string;
}) {
  return (
    <input
      type="text"
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={'rounded-md border border-amber-200 bg-amber-50/50 px-2 py-1 text-[13px] text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400 ' + (width || 'w-full')}
    />
  );
}

export function SelectField<T extends string>({
  value,
  onChange,
  options,
  width,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  width?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className={'rounded-md border border-slate-200 bg-white px-2 py-1 text-[13px] text-slate-800 cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-200 ' + (width || '')}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Note({ children }: { children: ReactNode }) {
  return <p className="text-[11.5px] leading-relaxed text-slate-500 bg-slate-50 border-l-2 border-slate-200 rounded-r-md px-3 py-2 mt-3">{children}</p>;
}

export function Warn({ children }: { children: ReactNode }) {
  return <div className="text-xs font-medium text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2 mt-2">{children}</div>;
}

export function Ok({ children }: { children: ReactNode }) {
  return <div className="text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2 mt-2">{children}</div>;
}

export function Tag({ children }: { children: ReactNode }) {
  return <span className="ml-2 align-middle text-[10px] font-bold text-blue-700 bg-blue-50 rounded-full px-2 py-0.5 normal-case tracking-normal">{children}</span>;
}

export function Btn({
  children,
  onClick,
  variant = 'default',
  small,
  type = 'button',
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'default' | 'primary' | 'danger';
  small?: boolean;
  type?: 'button' | 'submit';
}) {
  const base = 'rounded-lg font-medium border transition-colors ' + (small ? 'text-[11px] px-2.5 py-1' : 'text-[12.5px] px-3 py-1.5');
  const styles =
    variant === 'primary'
      ? ' bg-blue-600 text-white border-blue-600 hover:bg-blue-700'
      : variant === 'danger'
        ? ' text-rose-600 border-rose-200 hover:bg-rose-50'
        : ' text-slate-700 border-slate-200 hover:bg-slate-50';
  return (
    <button type={type} onClick={onClick} className={base + styles}>
      {children}
    </button>
  );
}

export function ItemRow({ children, onRemove }: { children: ReactNode; onRemove: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2 flex-wrap py-1.5 border-b border-dotted border-slate-100 last:border-0">
      <div className="flex items-center gap-1.5 flex-wrap flex-1 text-[12.5px] text-slate-600">{children}</div>
      <button type="button" onClick={onRemove} className="shrink-0 text-[10.5px] font-medium text-rose-500 hover:text-rose-700 px-2 py-1 rounded hover:bg-rose-50">
        {t('quotationCalculator.ui.remove')}
      </button>
    </div>
  );
}

export function ItemOut({ children }: { children: ReactNode }) {
  return <span className="tabular-nums text-[12.5px] text-slate-700 w-24 text-right shrink-0">{children}</span>;
}

export function StrongHeaderRow({ cols }: { cols: ReactNode[] }) {
  return (
    <div className="flex items-center gap-2 py-1 border-b border-slate-200 text-[11px] font-semibold text-slate-500">
      <div className="flex-1">{cols[0]}</div>
      {cols.slice(1).map((c, i) => (
        <span key={i} className="w-24 text-right shrink-0">
          {c}
        </span>
      ))}
      <span className="w-[52px] shrink-0" />
    </div>
  );
}
