/**
 * Generic yes/no modal — React equivalent of openConfirmModal() (index.html lines 1806-1822).
 * Used pervasively across both tabs: remove holiday/temp/support/additional guard, "Back to
 * Guard Pool", "Change assigned state?", dismiss guard's own reason picker is separate
 * (DismissGuardModal), etc. `open` gates rendering so a single instance can be reused per panel
 * instead of mounting/unmounting.
 */
export interface ConfirmModalProps {
  open: boolean;
  title: string;
  message: string;
  okLabel?: string;
  /** Styles the OK button destructively (red) — mirrors `opts.danger`. */
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmModal({ open, title, message, okLabel, danger, onConfirm, onCancel }: ConfirmModalProps) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onCancel}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        <p className="text-sm text-slate-600 mt-2">{message}</p>
        <div className="flex justify-end gap-2 mt-5">
          <button type="button" onClick={onCancel} className="px-3 py-1.5 text-sm font-medium text-slate-600 hover:text-slate-800">
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={
              danger
                ? "px-4 py-1.5 text-sm font-medium text-white bg-rose-600 hover:bg-rose-700 rounded-lg"
                : "px-4 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
            }
          >
            {okLabel || "OK"}
          </button>
        </div>
      </div>
    </div>
  );
}
