import { useEffect, useState } from 'react';
import { registerBufferGuard } from '../../services/guards';
import { formatMykadInput, formatPhoneInput, isValidMykad, isValidPhone } from '../../utils/format';

/**
 * Buffer Guards' own "+ Register" entry point — mirrors RegisterGuardModal's role for the Guard
 * Pool. Duty Roster's temp-guard assignment flow (syncBufferGuardOnAssign() in
 * public/duty-roster/index.html) is the OTHER way a buffer guard gets on file, created
 * automatically the first time someone covers a shift; this lets an admin add someone to the
 * roster up front, before they've ever actually covered one. Same required fields as Duty
 * Roster's "Assign a temporary guard" form, since they describe the same person.
 */
export default function RegisterBufferGuardModal({
  open,
  onClose,
  onRegistered,
}: {
  open: boolean;
  onClose: () => void;
  onRegistered: (message: string) => void;
}) {
  const [name, setName] = useState('');
  const [rate, setRate] = useState('');
  const [mykadNumber, setMykadNumber] = useState('');
  const [age, setAge] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [stateVal, setStateVal] = useState('');
  const [city, setCity] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName('');
    setRate('');
    setMykadNumber('');
    setAge('');
    setPhoneNumber('');
    setStateVal('');
    setCity('');
    setError(null);
  }, [open]);

  if (!open) return null;

  async function submit() {
    const fullName = name.trim();
    const rateNum = Number(rate);
    const mykad = mykadNumber.trim();
    const ageNum = Number(age);
    const phone = phoneNumber.trim();
    const s = stateVal.trim();
    const c = city.trim();

    if (!fullName) return setError("Enter the guard's name.");
    // Number('') is 0, not NaN — check the raw string first so an untouched field doesn't
    // silently pass as a valid RM 0.00 rate.
    if (rate.trim() === '' || !Number.isFinite(rateNum) || rateNum < 0) return setError('Enter a valid rate.');
    if (!isValidMykad(mykad)) return setError('Enter a valid 12-digit MyKad number (e.g. 901231-14-5678).');
    if (age.trim() === '' || !Number.isFinite(ageNum) || ageNum <= 0) return setError('Enter a valid age.');
    if (!isValidPhone(phone)) return setError('Enter a valid phone number (e.g. 012-3456789).');
    if (!s) return setError('State is required.');
    if (!c) return setError('City is required.');

    setSaving(true);
    setError(null);
    try {
      await registerBufferGuard({
        name: fullName,
        rate: rateNum,
        mykadNumber: mykad,
        age: ageNum,
        phoneNumber: phone,
        state: s,
        city: c,
      });
      onRegistered(`Added ${fullName} to the Buffer Guards list.`);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add this buffer guard.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5 max-h-[90vh] overflow-y-auto">
        <h2 className="text-base font-semibold text-slate-900">Register buffer guard</h2>
        <p className="text-sm text-slate-500 mt-1">
          Adds someone to the Buffer Guards list up front, before they've covered a shift. Duty
          Roster's "Assign a temporary guard" form also adds them here automatically the first
          time they're actually used.
        </p>

        <div className="mt-4 space-y-3">
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">Name</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Zul (relief)" />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">Rate (RM)</label>
            <input
              type="number"
              min={0}
              step={0.01}
              className="input"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              placeholder="0.00"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">MyKad number</label>
            <input
              className="input"
              value={mykadNumber}
              onChange={(e) => setMykadNumber(formatMykadInput(e.target.value))}
              placeholder="901231-14-5678"
              maxLength={14}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">Age</label>
            <input type="number" min={16} max={80} className="input" value={age} onChange={(e) => setAge(e.target.value)} />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">Phone number</label>
            <input
              className="input"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(formatPhoneInput(e.target.value))}
              placeholder="e.g. 012-3456789"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1">State</label>
              <input className="input" value={stateVal} onChange={(e) => setStateVal(e.target.value)} placeholder="e.g. Selangor" />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1">City</label>
              <input className="input" value={city} onChange={(e) => setCity(e.target.value)} placeholder="e.g. Petaling Jaya" />
            </div>
          </div>
        </div>

        {error && <p className="text-sm text-rose-600 mt-3">{error}</p>}

        <div className="flex justify-end gap-2 mt-5">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm font-medium text-slate-600 hover:text-slate-800">
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={submit}
            className="px-4 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60 rounded-lg"
          >
            {saving ? 'Adding…' : 'Add buffer guard'}
          </button>
        </div>
      </div>
    </div>
  );
}
