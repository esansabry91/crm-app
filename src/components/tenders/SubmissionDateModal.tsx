import { useEffect, useState } from 'react';
import type { Tender } from '../../types';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Blocks a drag-to-Submitted kanban move until the tender owner keys in the submission date —
 * required exactly once, the moment a tender first reaches Submitted (see PipelinePage.tsx,
 * which opens this instead of calling moveTenderStage directly whenever the tender doesn't
 * already have a submittedDate). Cancelling leaves the tender exactly where it was: PipelinePage
 * never calls moveTenderStage until this confirms, so nothing in Firestore changes and the card
 * snaps back to its original column on the next render.
 *
 * Once a tender has a submittedDate, this modal is never shown again for it — changing an
 * already-set date happens only from TenderFormModal, and only for an Admin (see the "Submission
 * Date" field there, and the matching firestore.rules guard).
 */
export default function SubmissionDateModal({
  open,
  tender,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  tender: Tender | null;
  onCancel: () => void;
  onConfirm: (submittedDate: string) => void;
}) {
  const [date, setDate] = useState(today());
  const [error, setError] = useState<string | null>(null);

  // Reset to today whenever this opens (including opening again for a different tender), rather
  // than carrying over whatever was left in the field from a previous use.
  useEffect(() => {
    if (open) {
      setDate(today());
      setError(null);
    }
  }, [open, tender?.id]);

  if (!open || !tender) return null;

  const handleConfirm = () => {
    if (!date) {
      setError('Please enter the submission date.');
      return;
    }
    if (date > today()) {
      setError('Submission date cannot be a future date.');
      return;
    }
    onConfirm(date);
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-5">
        <h2 className="text-base font-semibold text-slate-900">Submission Date Required</h2>
        <p className="text-sm text-slate-500 mt-1.5">
          "{tender.clientName}" is moving to <span className="font-medium text-slate-700">Submitted</span>. Enter
          the date it was submitted to the client — once saved, only an Admin can change it.
        </p>
        <div className="mt-4">
          <label htmlFor="submissionDateInput" className="text-xs font-medium text-slate-600 block mb-1">
            Submission Date
          </label>
          <input
            id="submissionDateInput"
            type="date"
            value={date}
            max={today()}
            onChange={(e) => {
              setDate(e.target.value);
              setError(null);
            }}
            className="input w-full"
            autoFocus
          />
        </div>
        {error && <p className="text-sm text-rose-600 mt-2">{error}</p>}
        <div className="flex justify-end gap-2 mt-5">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 text-sm font-medium text-slate-600 hover:text-slate-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className="px-4 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}
