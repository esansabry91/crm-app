/**
 * Wraps the standalone Duty Roster console (public/duty-roster/index.html) in an <iframe>.
 * That console is a separate, self-contained vanilla-JS app (its own Firestore reads/writes,
 * its own rendering) — embedding it as-is rather than porting it into React. It shares this
 * CRM's Firebase project and picks up the same signed-in user automatically; see the comment
 * block at the top of index.html for how.
 */
export default function DutyRosterPage() {
  return (
    <div className="h-screen">
      <iframe
        src="/duty-roster/index.html"
        title="Duty Roster"
        className="w-full h-full border-0 block"
      />
    </div>
  );
}
