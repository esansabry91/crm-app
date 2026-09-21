import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useBranches, useBrands } from '../../hooks/useBranches';
import { addBrand, addBranch, removeBrand, removeBranch, updateBrand, updateBranch } from '../../services/branches';
import type { Branch, Brand } from '../../types';

function ListManager<T extends { id: string; name: string }>({
  title,
  helper,
  items,
  onAdd,
  onRemove,
  placeholder,
}: {
  title: string;
  helper: string;
  items: T[];
  onAdd: (name: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  placeholder: string;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!value.trim()) return;
    setBusy(true);
    try {
      await onAdd(value.trim());
      setValue('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
      <p className="text-xs text-slate-400 mt-0.5 mb-3">{helper}</p>

      <form onSubmit={submit} className="flex gap-2 mb-3">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          className="input flex-1"
        />
        <button
          type="submit"
          disabled={busy}
          className="px-3 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-60"
        >
          {t('admin.branchBrandManager.addButton')}
        </button>
      </form>

      <ul className="space-y-1.5">
        {items.map((item) => (
          <li
            key={item.id}
            className="flex items-center justify-between text-sm bg-slate-50 rounded-lg px-3 py-2"
          >
            <span className="text-slate-700">{item.name}</span>
            <button
              onClick={() => onRemove(item.id)}
              className="text-xs text-rose-500 hover:text-rose-700"
            >
              {t('admin.branchBrandManager.removeButton')}
            </button>
          </li>
        ))}
        {items.length === 0 && <li className="text-xs text-slate-400 py-2">{t('admin.branchBrandManager.noneYet')}</li>}
      </ul>
    </div>
  );
}

/** One field in the invoicing-details form below — driven off this list so adding a new field
 *  later is one entry here, not a repeated block of JSX. */
const INVOICE_FIELDS: { key: keyof Brand; labelKey: string; placeholderKey: string; multiline?: boolean }[] = [
  { key: 'shortCode', labelKey: 'admin.branchBrandManager.invoiceFields.shortCode.label', placeholderKey: 'admin.branchBrandManager.invoiceFields.shortCode.placeholder' },
  { key: 'legalName', labelKey: 'admin.branchBrandManager.invoiceFields.legalName.label', placeholderKey: 'admin.branchBrandManager.invoiceFields.legalName.placeholder' },
  { key: 'registrationNo', labelKey: 'admin.branchBrandManager.invoiceFields.registrationNo.label', placeholderKey: 'admin.branchBrandManager.invoiceFields.registrationNo.placeholder' },
  { key: 'address', labelKey: 'admin.branchBrandManager.invoiceFields.address.label', placeholderKey: 'admin.branchBrandManager.invoiceFields.address.placeholder', multiline: true },
  { key: 'tel', labelKey: 'admin.branchBrandManager.invoiceFields.tel.label', placeholderKey: 'admin.branchBrandManager.invoiceFields.tel.placeholder' },
  { key: 'fax', labelKey: 'admin.branchBrandManager.invoiceFields.fax.label', placeholderKey: 'admin.branchBrandManager.invoiceFields.fax.placeholder' },
  { key: 'serviceTaxNo', labelKey: 'admin.branchBrandManager.invoiceFields.serviceTaxNo.label', placeholderKey: 'admin.branchBrandManager.invoiceFields.serviceTaxNo.placeholder' },
  { key: 'tin', labelKey: 'admin.branchBrandManager.invoiceFields.tin.label', placeholderKey: 'admin.branchBrandManager.invoiceFields.tin.placeholder' },
  { key: 'bankName', labelKey: 'admin.branchBrandManager.invoiceFields.bankName.label', placeholderKey: 'admin.branchBrandManager.invoiceFields.bankName.placeholder' },
  { key: 'bankAccountName', labelKey: 'admin.branchBrandManager.invoiceFields.bankAccountName.label', placeholderKey: 'admin.branchBrandManager.invoiceFields.bankAccountName.placeholder' },
  { key: 'bankAccountNo', labelKey: 'admin.branchBrandManager.invoiceFields.bankAccountNo.label', placeholderKey: 'admin.branchBrandManager.invoiceFields.bankAccountNo.placeholder' },
  { key: 'bankAddress', labelKey: 'admin.branchBrandManager.invoiceFields.bankAddress.label', placeholderKey: 'admin.branchBrandManager.invoiceFields.bankAddress.placeholder', multiline: true },
];

/** Resizes an uploaded image client-side (so it stays small enough to live as a Firestore field
 *  alongside the rest of a Brand's invoicing details) and returns it as a PNG data: URI. Capped
 *  at 240px wide — plenty for a letterhead logo, and keeps the resulting string well under
 *  Firestore's 1MB document limit even for a busy source image. */
function resizeImageToDataUrl(file: File, t: TFunction, maxWidth = 240): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(t('admin.branchBrandManager.errorCouldNotReadFile')));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error(t('admin.branchBrandManager.errorCouldNotReadImage')));
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error(t('admin.branchBrandManager.errorCouldNotProcessImage')));
          return;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/png'));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Lets an admin fill in each Brand's letterhead/legal/bank details once — the invoicing profile
 * that the Branch Collection tab's invoice generator pulls from so it never has to be retyped
 * per invoice. Separate from the simple add/remove list above: this is an edit form for a brand
 * that already exists (create it up top first, then fill in its invoicing details here).
 */
function BrandInvoicingDetails({ brands }: { brands: Brand[] }) {
  const { t } = useTranslation();
  const [selectedId, setSelectedId] = useState('');
  const [form, setForm] = useState<Partial<Record<keyof Brand, string>>>({});
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [logoError, setLogoError] = useState('');
  const [logoBusy, setLogoBusy] = useState(false);

  const selected = brands.find((b) => b.id === selectedId) || null;

  useEffect(() => {
    if (!selected) {
      setForm({});
      return;
    }
    const next: Partial<Record<keyof Brand, string>> = {};
    for (const field of INVOICE_FIELDS) {
      next[field.key] = (selected[field.key] as string | undefined) || '';
    }
    next.logoDataUrl = selected.logoDataUrl || '';
    setForm(next);
    setSaved(false);
    setLogoError('');
    // Only re-seed when switching to a different brand — not on every brands[] update, so the
    // admin's in-progress edits aren't clobbered by their own save round-tripping through
    // Firestore's live subscription.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const handleSave = async () => {
    if (!selectedId) return;
    setBusy(true);
    setSaved(false);
    try {
      const patch: Partial<Record<keyof Brand, string>> = {};
      for (const f of INVOICE_FIELDS) {
        patch[f.key] = (form[f.key] || '').trim();
      }
      patch.logoDataUrl = form.logoDataUrl || '';
      await updateBrand(selectedId, patch);
      setSaved(true);
    } finally {
      setBusy(false);
    }
  };

  const handleLogoFile = async (file: File | null) => {
    if (!file) return;
    setLogoError('');
    setLogoBusy(true);
    try {
      const dataUrl = await resizeImageToDataUrl(file, t);
      setForm((prev) => ({ ...prev, logoDataUrl: dataUrl }));
    } catch (err) {
      setLogoError(err instanceof Error ? err.message : t('admin.branchBrandManager.errorCouldNotProcessImage'));
    } finally {
      setLogoBusy(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <h3 className="text-sm font-semibold text-slate-800">{t('admin.branchBrandManager.invoicingDetailsTitle')}</h3>
      <p className="text-xs text-slate-400 mt-0.5 mb-3">
        {t('admin.branchBrandManager.invoicingDetailsDescription')}
      </p>

      <select
        value={selectedId}
        onChange={(e) => setSelectedId(e.target.value)}
        className="input mb-4"
      >
        <option value="">{t('admin.branchBrandManager.selectBrandToEdit')}</option>
        {brands.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>

      {selected && (
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">{t('admin.branchBrandManager.logoLabel')}</label>
            <p className="text-xs text-slate-400 mb-2">
              {t('admin.branchBrandManager.logoDescription')}
            </p>
            <div className="flex items-center gap-3">
              {form.logoDataUrl && (
                <img
                  src={form.logoDataUrl}
                  alt={t('admin.branchBrandManager.logoPreviewAlt')}
                  className="border border-slate-200 rounded bg-white"
                  style={{ maxHeight: '48px', maxWidth: '160px', objectFit: 'contain' }}
                />
              )}
              <label className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg border border-slate-200 cursor-pointer">
                {logoBusy
                  ? t('admin.branchBrandManager.processingEllipsis')
                  : form.logoDataUrl
                    ? t('admin.branchBrandManager.replaceLogo')
                    : t('admin.branchBrandManager.uploadLogo')}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  disabled={logoBusy}
                  onChange={(e) => {
                    void handleLogoFile(e.target.files?.[0] || null);
                    e.target.value = '';
                  }}
                />
              </label>
              {form.logoDataUrl && (
                <button
                  onClick={() => setForm((prev) => ({ ...prev, logoDataUrl: '' }))}
                  className="text-xs text-rose-500 hover:text-rose-700"
                >
                  {t('admin.branchBrandManager.removeButton')}
                </button>
              )}
            </div>
            {logoError && <p className="text-xs text-rose-600 mt-1">{logoError}</p>}
          </div>

          {INVOICE_FIELDS.map((field) => (
            <div key={field.key}>
              <label className="block text-xs font-medium text-slate-500 mb-1">{t(field.labelKey)}</label>
              {field.multiline ? (
                <textarea
                  value={form[field.key] || ''}
                  onChange={(e) => setForm((prev) => ({ ...prev, [field.key]: e.target.value }))}
                  placeholder={t(field.placeholderKey)}
                  rows={2}
                  className="input w-full"
                />
              ) : (
                <input
                  value={form[field.key] || ''}
                  onChange={(e) => setForm((prev) => ({ ...prev, [field.key]: e.target.value }))}
                  placeholder={t(field.placeholderKey)}
                  className="input w-full"
                />
              )}
            </div>
          ))}

          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={handleSave}
              disabled={busy}
              className="px-3.5 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60 rounded-lg"
            >
              {busy ? t('admin.branchBrandManager.savingEllipsis') : t('admin.branchBrandManager.saveInvoicingDetails')}
            </button>
            {saved && <span className="text-xs text-emerald-600">{t('admin.branchBrandManager.savedLabel')}</span>}
          </div>
        </div>
      )}

      {!selected && brands.length === 0 && (
        <p className="text-xs text-slate-400">{t('admin.branchBrandManager.addBrandFirstInvoicing')}</p>
      )}
    </div>
  );
}

/**
 * Lets an admin set who signs invoices issued for each Branch's sites — see Branch's doc
 * comment in types.ts for why this lives per-Branch rather than per-Brand (the same person can
 * sign under different titles for different brands; a Branch is the issuing office/department).
 * Mirrors BrandInvoicingDetails' pattern one level down: pick a branch, edit its two fields,
 * save.
 */
function BranchSignatoryDetails({ branches }: { branches: Branch[] }) {
  const { t } = useTranslation();
  const [selectedId, setSelectedId] = useState('');
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [shortCode, setShortCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const selected = branches.find((b) => b.id === selectedId) || null;

  useEffect(() => {
    setName(selected?.signatoryName || '');
    setTitle(selected?.signatoryTitle || '');
    setShortCode(selected?.shortCode || '');
    setSaved(false);
    // Only re-seed when switching branches — same reasoning as BrandInvoicingDetails above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const handleSave = async () => {
    if (!selectedId) return;
    setBusy(true);
    setSaved(false);
    try {
      await updateBranch(selectedId, {
        signatoryName: name.trim(),
        signatoryTitle: title.trim(),
        shortCode: shortCode.trim(),
      });
      setSaved(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <h3 className="text-sm font-semibold text-slate-800">{t('admin.branchBrandManager.signatoryTitle')}</h3>
      <p className="text-xs text-slate-400 mt-0.5 mb-3">
        {t('admin.branchBrandManager.signatoryDescription')}
      </p>

      <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)} className="input mb-4">
        <option value="">{t('admin.branchBrandManager.selectBranchToEdit')}</option>
        {branches.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>

      {selected && (
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">{t('admin.branchBrandManager.invoiceFields.shortCode.label')}</label>
            <input value={shortCode} onChange={(e) => setShortCode(e.target.value)} placeholder={t('admin.branchBrandManager.shortCodePlaceholderBranch')} className="input w-full" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">{t('admin.branchBrandManager.signatoryNameLabel')}</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('admin.branchBrandManager.signatoryNamePlaceholder')} className="input w-full" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">{t('admin.branchBrandManager.signatoryTitleLabel')}</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('admin.branchBrandManager.signatoryTitlePlaceholder')} className="input w-full" />
          </div>
          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={handleSave}
              disabled={busy}
              className="px-3.5 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60 rounded-lg"
            >
              {busy ? t('admin.branchBrandManager.savingEllipsis') : t('admin.branchBrandManager.saveSignatory')}
            </button>
            {saved && <span className="text-xs text-emerald-600">{t('admin.branchBrandManager.savedLabel')}</span>}
          </div>
        </div>
      )}

      {!selected && branches.length === 0 && (
        <p className="text-xs text-slate-400">{t('admin.branchBrandManager.addBranchFirstSignatory')}</p>
      )}
    </div>
  );
}

export default function BranchBrandManager() {
  const { t } = useTranslation();
  const { branches } = useBranches();
  const { brands } = useBrands();

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ListManager<Branch>
          title={t('admin.branchBrandManager.branchesTitle')}
          helper={t('admin.branchBrandManager.branchesHelper')}
          items={branches}
          onAdd={addBranch}
          onRemove={removeBranch}
          placeholder={t('admin.branchBrandManager.branchPlaceholder')}
        />
        <ListManager<Brand>
          title={t('admin.branchBrandManager.brandsTitle')}
          helper={t('admin.branchBrandManager.brandsHelper')}
          items={brands}
          onAdd={addBrand}
          onRemove={removeBrand}
          placeholder={t('admin.branchBrandManager.brandPlaceholder')}
        />
      </div>

      <BrandInvoicingDetails brands={brands} />
      <BranchSignatoryDetails branches={branches} />
    </div>
  );
}
