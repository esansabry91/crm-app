import { useSearchParams } from 'react-router-dom';

/**
 * Wraps the standalone Duty Roster console (public/duty-roster/index.html) in an <iframe>.
 * That console is a separate, self-contained vanilla-JS app (its own Firestore reads/writes,
 * its own rendering) — embedding it as-is rather than porting it into React. It shares this
 * CRM's Firebase project and picks up the same signed-in user automatically; see the comment
 * block at the top of index.html for how.
 *
 * Active Projects links here with ?tenderId=...&clientName=...&branch=... (see the "Duty
 * Roster" action in ActiveProjectsPage.tsx) — forwarded straight through onto the iframe's own
 * src query string unchanged, so index.html's own bootstrap code (not this file) can read them
 * with location.search and auto-create-or-select the one site tied to that tender. Visiting
 * /duty-roster with no params (e.g. from the main nav) omits the query string entirely and the
 * console falls back to its normal manual site picker.
 */
export default function DutyRosterPage() {
  const [searchParams] = useSearchParams();
  const forwarded = searchParams.toString();
  const src = forwarded ? `/duty-roster/index.html?${forwarded}` : '/duty-roster/index.html';

  return (
    <div className="h-screen">
      <iframe key={src} src={src} title="Duty Roster" className="w-full h-full border-0 block" />
    </div>
  );
}
