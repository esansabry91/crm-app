import DutyRosterApp from "../duty-roster/DutyRosterApp";

/**
 * Route entry point for /duty-roster. Used to wrap the standalone console
 * (public/duty-roster/index.html) in an <iframe> — see git history for that version's own doc
 * comment on why. Now just renders the native-React composed page (Task #22); the deep-link
 * query-string params Active Projects/LinkedSiteDetailsCard forward here (?tenderId=&clientName=
 * &branch=&siteId=) are read directly by DutyRosterApp itself via useSearchParams(), same as
 * before.
 */
export default function DutyRosterPage() {
  return <DutyRosterApp />;
}
