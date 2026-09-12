import { useSearchParams } from 'react-router-dom';

// Injected by vite.config.ts's `define` block at build time — a fresh string every
// build/deploy, used below to cache-bust the duty-roster iframe's src.
declare const __APP_BUILD_ID__: string;

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
  // Always append a build-tied version param (in addition to any forwarded tenderId/
  // clientName/branch params) so the iframe's src changes on every new deploy, forcing it to
  // re-fetch public/duty-roster/index.html instead of continuing to run whatever copy is
  // already loaded in memory from a prior SPA-internal navigation.
  const query = forwarded ? `${forwarded}&_v=${__APP_BUILD_ID__}` : `_v=${__APP_BUILD_ID__}`;
  const src = `/duty-roster/index.html?${query}`;

  return (
    <div className="h-full">
      <iframe key={src} src={src} title="Duty Roster" className="w-full h-full border-0 block" />
    </div>
  );
}
