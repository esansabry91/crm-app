import { useEffect, useState, type FormEvent } from 'react';
import type { Role, Tender } from '../../types';
import { renewContract } from '../../services/tenders';
import { formatDate, formatRM } from '../../utils/format';

interface Props {
  open: boolean;
  onClose: () => void;
  tender: Tender | null;
  actor: { uid: string; name: string; role?: Role };
}

/**
 * Renews an Active Project's contract in place — right from the Active Projects list, so a
 * Branch Manager running a project day-to-day doesn't have to go find its card on the Sales
 * Funnel Pipeline (or, once it's aged past a year, the Archive page) just to extend a date. Only
 * touches Contract End and Tender Value; Contract Start is left as-is, since a straight renewal
 * with no real break in work is a continuation of the same engagement, not a new one — see
 * renewContract()'s doc comment in services/tenders.ts for the full reasoning and who can call
 * it (owner, admin, or the Branch Manager currently running this project's activeBranch).
 */
export default function RenewContractModal({ open, onClose, tender, actor }: Props) {
  const [contractEnd, setContractEnd] = useState('');
  const [tenderValue, setTenderValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !tender) return;
    setContractEnd(tender.contractEnd);
    setTenderValue(String(tender.tenderValue));
    setError(null);
  }, [open, tender]);

  if (!open || !tender) return null;

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!contractEnd) {
      setError('Enter the new Contract End date.');
      return;
    }
    if (contractEnd <= tender.contractEnd) {
      setError(
        `New Contract End should be after the current end date (${formatDate(tender.contractEnd)}) — this renews the contract, it doesn't shorten it.`
      );
      return;
    }
    const valueNum = Number(tenderValue);
    if (tenderValue.trim() === '' || !Number.isFinite(valueNum) || valueNum < 0) {
      setError('Enter a valid Tender Value.');
      return;
    }

    setSaving(true);
    try {
      await renewContract(tender, { contractEnd, tenderValue: valueNum }, actor);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not renew this contract. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Renew Contract</h2>
            <p className="text-xs text-slate-400 mt-0.5">{tender.clientName}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">
            ×
          </button>
        </div>

        <form onSubmit={handleSave} className="px-6 py-5 space-y-4">
          <p className="text-xs text-slate-500">
            For a contract that's continuing straight through with no real break in work — extend
            its end date and, if the rate changed, its value. This is the same tender, not a new
            deal: it keeps its site, its guards, and its place in Past Projects history untouched.
          </p>

          <Field label="Current Contract End">
            <p className="text-sm text-slate-600">{formatDate(tender.contractEnd)}</p>
          </Field>

          <Field label="New Contract End">
            <input
              type="date"
              value={contractEnd}
              onChange={(e) => setContractEnd(e.target.value)}
              className="input"
            />
          </Field>

          <Field label="Current Tender Value">
            <p className="text-sm text-slate-600">{formatRM(tender.tenderValue)}</p>
          </Field>

          <Field label="New Tender Value (RM)">
            <input
              type="number"
              min={0}
              step="0.01"
              value={tenderValue}
              onChange={(e) => setTenderValue(e.target.value)}
              className="input"
              placeholder="0.00"
            />
            <span className="block text-xs text-slate-400 mt-1">
              Leave as-is if the rate isn't changing. Changing it logs a value-change entry in
              this tender's history, same as any other correction.
            </span>
          </Field>

          {error && <p className="text-sm text-rose-600">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-60"
            >
              {saving ? 'Renewing…' : 'Renew Contract'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-slate-500 mb-1">{label}</span>
      {children}
    </label>
  );
}
