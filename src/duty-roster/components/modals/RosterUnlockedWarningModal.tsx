/**
 * "Roster sheet is unlocked" 3-button warning — React equivalent of
 * openRosterUnlockedWarningModal() (index.html lines ~4917-4965), shown by useUnlockGuard.ts
 * whenever a navigation is attempted while the Roster tab is unlocked with pending drags. Unlike
 * ConfirmModal (Cancel/OK), this has three distinct actions — a veil click/dismiss counts as
 * "Stay here", matching the original exactly.
 */
export interface RosterUnlockedWarningModalProps {
  open: boolean;
  pendingCount: number;
  onStay: () => void;
  onDiscard: () => void;
  onLock: () => void;
}

export default function RosterUnlockedWarningModal({ open, pendingCount, onStay, onDiscard, onLock }: RosterUnlockedWarningModalProps) {
  if (!open) return null;
  const message = `You have ${pendingCount} pending drag rearrangement${pendingCount === 1 ? "" : "s"} that ${
    pendingCount === 1 ? "isn't" : "aren't"
  } locked in yet. Lock the roster or discard these changes before leaving.`;
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onStay}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-slate-900">Roster sheet is unlocked</h2>
        <p className="text-sm text-slate-600 mt-2">{message}</p>
        <div className="flex justify-end gap-2 mt-5">
          <button type="button" onClick={onStay} className="px-3 py-1.5 text-sm font-medium text-slate-600 hover:text-slate-800">
            Stay here
          </button>
          <button type="button" onClick={onDiscard} className="px-4 py-1.5 text-sm font-medium text-white bg-rose-600 hover:bg-rose-700 rounded-lg">
            Discard changes
          </button>
          <button type="button" onClick={onLock} className="px-4 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg">
            Lock roster
          </button>
        </div>
      </div>
    </div>
  );
}
