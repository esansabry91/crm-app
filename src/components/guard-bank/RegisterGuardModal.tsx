import { useEffect, useState } from 'react';
import { registerGuard } from '../../services/guards';
import { formatMykadInput, formatPhoneInput, isValidMykad, isValidPhone } from '../../utils/format';

/**
 * Guard Pool's own "+ Register" entry point — mirrors the fields Duty Roster's "Add guard"
 * modal collects (see openAddGuardModal() in public/duty-roster/index.html) minus `position`,
 * which only makes sense once a guard is actually deployed to a rate-configured site. Creates
 * the guard straight into the pool with no site; see AssignGuardModal for the deploy step.
 */
export default function RegisterGuardModal({
  open,
  onClose,
  onRegistered,
}: {
  open: boolean;
  onClose: () => void;
  onRegistered: (message: string) => void;
}) {
  const [category, setCategory] = useState<'local' | 'nepal'>('local');
  const [employeeId, setEmployeeId] = useState('');
  const [name, setName] = useState('');
  const [stateVal, setStateVal] = useState('');
  const [city, setCity] = useState('');
  const [age, setAge] = useState('');
  const [passportNumber, setPassportNumber] = useState('');
  const [permitExpiryDate, setPermitExpiryDate] = useState('');
  const [mykadNumber, setMykadNumber] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setCategory('local');
    setEmployeeId('');
    setName('');
    setStateVal('');
    setCity('');
    setAge('');
    setPassportNumber('');
    setPermitExpiryDate('');
    setMykadNumber('');
    setPhoneNumber('');
    setError(null);
  }, [open]);

  if (!open) return null;

  async function submit() {
    const empId = employeeId.trim();
    const fullName = name.trim();
    const s = stateVal.trim();
    const c = city.trim();
    const ageNum = Number(age);
    if (!empId) return setError('Employee ID is required.');
    if (!fullName) return setError('Full name is required.');
    if (!s) return setError('State is required.');
    if (!c) return setError('City is required.');
    if (age.trim() === '' || !Number.isFinite(ageNum) || ageNum <= 0) return setError('Enter a valid age.');
    if (category === 'nepal') {
      if (!passportNumber.trim()) return setError('Passport number is required.');
      if (!permitExpiryDate) return setError('Permit expiry date is required.');
    } else {
      if (!isValidMykad(mykadNumber.trim())) return setError('Enter a valid 12-digit MyKad number (e.g. 901231-14-5678).');
      if (!isValidPhone(phoneNumber.trim())) return setError('Enter a valid phone number (e.g. 012-3456789).');
    }

    setSaving(true);
    setError(null);
    try {
      await registerGuard({
        name: fullName,
        employeeId: empId,
        category,
        age: ageNum,
        state: s,
        city: c,
        ...(category === 'nepal'
          ? { passportNumber: passportNumber.trim(), permitExpiryDate }
          : { mykadNumber: mykadNumber.trim(), phoneNumber: phoneNumber.trim() }),
      });
      onRegistered(`Registered ${fullName} into the Guard Pool.`);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not register this guard.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5 max-h-[90vh] overflow-y-auto">
        <h2 className="text-base font-semibold text-slate-900">Register guard</h2>
        <p className="text-sm text-slate-500 mt-1">
          Adds a new guard to the Guard Pool, unassigned to any site. Assign them to a client site
          afterwards from the Guard Pool tab.
        </p>

        <div className="mt-4 space-y-3">
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">Guard category</label>
            <select className="input" value={category} onChange={(e) => setCategory(e.target.value as 'local' | 'nepal')}>
              <option value="local">Local</option>
              <option value="nepal">Nepal</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">Employee ID</label>
            <input className="input" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} placeholder="e.g. EMP-1023" />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">
              {category === 'nepal' ? 'Full name' : 'Full name (as per MyKad)'}
            </label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ahmad Faiz" />
          </div>

          {category === 'nepal' ? (
            <>
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">Passport number</label>
                <input className="input" value={passportNumber} onChange={(e) => setPassportNumber(e.target.value)} />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">Permit expiry date</label>
                <input type="date" className="input" value={permitExpiryDate} onChange={(e) => setPermitExpiryDate(e.target.value)} />
              </div>
            </>
          ) : (
            <>
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
                <label className="text-xs font-medium text-slate-600 block mb-1">Phone number</label>
                <input
                  className="input"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(formatPhoneInput(e.target.value))}
                  placeholder="e.g. 012-3456789"
                />
              </div>
            </>
          )}

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
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">Age</label>
            <input type="number" min={16} max={80} className="input" value={age} onChange={(e) => setAge(e.target.value)} />
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
            {saving ? 'Registering…' : 'Register guard'}
          </button>
        </div>
      </div>
    </div>
  );
}
