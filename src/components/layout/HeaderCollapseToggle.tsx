/**
 * Small chevron toggle sitting next to a page's <h1> — collapses everything below the title
 * (subtitle, filters, and on some pages the stat tiles) down to just the title row. On a
 * landscape phone, the app's own top bar plus a page's full sticky header can eat close to half
 * the short viewport before the user ever reaches the stats or chart the page is actually about;
 * this lets them reclaim that space on demand without losing the filters — one tap away again.
 */
export default function HeaderCollapseToggle({
  expanded,
  onToggle,
}: {
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={expanded ? 'Collapse header details' : 'Expand header details'}
      aria-expanded={expanded}
      className="p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 shrink-0"
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={`transition-transform ${expanded ? '' : '-rotate-90'}`}
      >
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </button>
  );
}
