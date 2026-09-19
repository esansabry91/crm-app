import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
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

    if (!fullName) return setError(t('guardBank.registerBufferGuardModal.errorNameRequired'));
    // Number('') is 0, not NaN — check the raw string first so an untouched field doesn't
    // silently pass as a valid RM 0.00 rate.
    if (rate.trim() === '' || !Number.isFinite(rateNum) || rateNum < 0) return setError(t('guardBank.registerBufferGuardModal.errorValidRate'));
    if (!isValidMykad(mykad)) return setError(t('guardBank.registerGuardModal.errorValidMykad'));
    if (age.trim() === '' || !Number.isFinite(ageNum) || ageNum <= 0) return setError(t('guardBank.registerGuardModal.errorValidAge'));
    if (!isValidPhone(phone)) return setError(t('guardBank.registerGuardModal.errorValidPhone'));
    if (!s) return setError(t('guardBank.registerGuardModal.errorStateRequired'));
    if (!c) return setError(t('guardBank.registerGuardModal.errorCityRequired'));

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
      onRegistered(t('guardBank.registerBufferGuardModal.toastAdded', { name: fullName }));
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('guardBank.registerBufferGuardModal.errorCouldNotAdd'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5 max-h-[90vh] overflow-y-auto">
        <h2 className="text-base font-semibold text-slate-900">{t('guardBank.registerBufferGuardModal.title')}</h2>
        <p className="text-sm text-slate-500 mt-1">
          {t('guardBank.registerBufferGuardModal.description')}
        </p>

        <div className="mt-4 space-y-3">
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">{t('guardBank.registerGuardModal.fullNameLabel')}</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('guardBank.registerBufferGuardModal.namePlaceholder')} />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">{t('guardBank.registerBufferGuardModal.rateLabel')}</label>
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
            <label className="text-xs font-medium text-slate-600 block mb-1">{t('guardBank.registerGuardModal.ageLabel')}</label>
            <input type="number" min={16} max={80} className="input" value={age} onChange={(e) => setAge(e.target.value)} />
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
            {saving ? t('guardBank.registerBufferGuardModal.addingEllipsis') : t('guardBank.registerBufferGuardModal.addButton')}
          </button>
        </div>
      </div>
    </div>
  );
}
