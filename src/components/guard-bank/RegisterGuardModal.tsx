import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
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
    if (!empId) return setError(t('guardBank.registerGuardModal.errorEmployeeIdRequired'));
    if (!fullName) return setError(t('guardBank.registerGuardModal.errorFullNameRequired'));
    if (!s) return setError(t('guardBank.registerGuardModal.errorStateRequired'));
    if (!c) return setError(t('guardBank.registerGuardModal.errorCityRequired'));
    if (age.trim() === '' || !Number.isFinite(ageNum) || ageNum <= 0) return setError(t('guardBank.registerGuardModal.errorValidAge'));
    if (category === 'nepal') {
      if (!passportNumber.trim()) return setError(t('guardBank.registerGuardModal.errorPassportRequired'));
      if (!permitExpiryDate) return setError(t('guardBank.registerGuardModal.errorPermitExpiryRequired'));
    } else {
      if (!isValidMykad(mykadNumber.trim())) return setError(t('guardBank.registerGuardModal.errorValidMykad'));
      if (!isValidPhone(phoneNumber.trim())) return setError(t('guardBank.registerGuardModal.errorValidPhone'));
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
      onRegistered(t('guardBank.registerGuardModal.toastRegistered', { name: fullName }));
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('guardBank.registerGuardModal.errorCouldNotRegister'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5 max-h-[90vh] overflow-y-auto">
        <h2 className="text-base font-semibold text-slate-900">{t('guardBank.registerGuardModal.title')}</h2>
        <p className="text-sm text-slate-500 mt-1">
          {t('guardBank.registerGuardModal.description')}
        </p>

        <div className="mt-4 space-y-3">
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">{t('guardBank.registerGuardModal.guardCategoryLabel')}</label>
            <select className="input" value={category} onChange={(e) => setCategory(e.target.value as 'local' | 'nepal')}>
              <option value="local">{t('guardBank.categoryLocal')}</option>
              <option value="nepal">{t('guardBank.categoryNepal')}</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">{t('guardBank.registerGuardModal.employeeIdLabel')}</label>
            <input className="input" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} placeholder={t('guardBank.registerGuardModal.employeeIdPlaceholder')} />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">
              {category === 'nepal' ? t('guardBank.registerGuardModal.fullNameLabel') : t('guardBank.registerGuardModal.fullNameMykadLabel')}
            </label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('guardBank.registerGuardModal.fullNamePlaceholder')} />
          </div>

          {category === 'nepal' ? (
            <>
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">{t('guardBank.registerGuardModal.passportNumberLabel')}</label>
                <input className="input" value={passportNumber} onChange={(e) => setPassportNumber(e.target.value)} />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">{t('guardBank.registerGuardModal.permitExpiryDateLabel')}</label>
                <input type="date" className="input" value={permitExpiryDate} onChange={(e) => setPermitExpiryDate(e.target.value)} />
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">{t('guardBank.registerGuardModal.mykadNumberLabel')}</label>
                <input
                  className="input"
                  value={mykadNumber}
                  onChange={(e) => setMykadNumber(formatMykadInput(e.target.value))}
                  placeholder="901231-14-5678"
                  maxLength={14}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">{t('guardBank.registerGuardModal.phoneNumberLabel')}</label>
                <input
                  className="input"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(formatPhoneInput(e.target.value))}
                  placeholder={t('guardBank.registerGuardModal.phoneNumberPlaceholder')}
                />
              </div>
            </>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1">{t('guardBank.registerGuardModal.stateLabel')}</label>
              <input className="input" value={stateVal} onChange={(e) => setStateVal(e.target.value)} placeholder={t('guardBank.registerGuardModal.statePlaceholder')} />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1">{t('guardBank.registerGuardModal.cityLabel')}</label>
              <input className="input" value={city} onChange={(e) => setCity(e.target.value)} placeholder={t('guardBank.registerGuardModal.cityPlaceholder')} />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">{t('guardBank.registerGuardModal.ageLabel')}</label>
            <input type="number" min={16} max={80} className="input" value={age} onChange={(e) => setAge(e.target.value)} />
          </div>
        </div>

        {error && <p className="text-sm text-rose-600 mt-3">{error}</p>}

        <div className="flex justify-end gap-2 mt-5">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm font-medium text-slate-600 hover:text-slate-800">
            {t('guardBank.cancel')}
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={submit}
            className="px-4 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60 rounded-lg"
          >
            {saving ? t('guardBank.registerGuardModal.registeringEllipsis') : t('guardBank.registerGuardModal.title')}
          </button>
        </div>
      </div>
    </div>
  );
}
