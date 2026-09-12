import { useEffect, useState, type FormEvent } from 'react';
import { useBranches, useBrands } from '../../hooks/useBranches';
import { addBrand, addBranch, removeBrand, removeBranch, updateBrand } from '../../services/branches';
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
          Add
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
              Remove
            </button>
          </li>
        ))}
        {items.length === 0 && <li className="text-xs text-slate-400 py-2">None yet.</li>}
      </ul>
    </div>
  );
}

/** One field in the invoicing-details form below — driven off this list so adding a new field
 *  later is one entry here, not a repeated block of JSX. */
const INVOICE_FIELDS: { key: keyof Brand; label: string; placeholder: string; multiline?: boolean }[] = [
  { key: 'legalName', label: 'Registered company name', placeholder: 'e.g. PROZAS SECURITY (M) SDN BHD — used on the invoice header; falls back to the brand name above if left blank' },
  { key: 'registrationNo', label: 'Company registration no.', placeholder: 'e.g. 200701036994 (795023-X)' },
  { key: 'address', label: 'Address', placeholder: 'Full company address, as it should appear on the invoice', multiline: true },
  { key: 'tel', label: 'Tel', placeholder: 'e.g. 03-7733 2614' },
  { key: 'fax', label: 'Fax', placeholder: 'e.g. 03-4149 3222' },
  { key: 'serviceTaxNo', label: 'Service tax no.', placeholder: 'e.g. W10-1808-31038270' },
  { key: 'tin', label: 'Company TIN', placeholder: 'e.g. C23021658070' },
  { key: 'bankName', label: 'Bank name', placeholder: 'e.g. MAYBANK BERHAD' },
  { key: 'bankAccountName', label: 'Bank account name', placeholder: 'Usually the same as the registered company name' },
  { key: 'bankAccountNo', label: 'Bank account no.', placeholder: 'e.g. 5142 7160 3610' },
  { key: 'bankAddress', label: 'Bank branch address', placeholder: 'Address of the bank branch', multiline: true },
  { key: 'signatoryName', label: 'Authorised signatory name', placeholder: 'e.g. MASITA ARBI' },
  { key: 'signatoryTitle', label: 'Signatory title', placeholder: 'e.g. Branch Manager' },
];

/**
 * Lets an admin fill in each Brand's letterhead/legal/bank details once — the invoicing profile
 * that the Branch Collection tab's invoice generator pulls from so it never has to be retyped
 * per invoice. Separate from the simple add/remove list above: this is an edit form for a brand
 * that already exists (create it up top first, then fill in its invoicing details here).
 */
function BrandInvoicingDetails({ brands }: { brands: Brand[] }) {
  const [selectedId, setSelectedId] = useState('');
  const [form, setForm] = useState<Partial<Record<keyof Brand, string>>>({});
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const selected = brands.find((b) => b.id === selectedId) || null;

  useEffect(() => {
    if (!selected) {
      setForm({});
      return;
    }
    const next: Partial<Record<keyof Brand, string>> = {};
    for (const f of INVOICE_FIELDS) {
      next[f.key] = (selected[f.key] as string | undefined) || '';
    }
    setForm(next);
    setSaved(false);
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
      await updateBrand(selectedId, patch);
      setSaved(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <h3 className="text-sm font-semibold text-slate-800">Brand invoicing details</h3>
      <p className="text-xs text-slate-400 mt-0.5 mb-3">
        The letterhead, registration numbers and bank account each brand invoices under — filled
        in once here, reused automatically by the Branch Collection tab.
      </p>

      <select
        value={selectedId}
        onChange={(e) => setSelectedId(e.target.value)}
        className="input mb-4"
      >
        <option value="">Select a brand to edit…</option>
        {brands.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>

      {selected && (
        <div className="space-y-3">
          {INVOICE_FIELDS.map((f) => (
            <div key={f.key}>
              <label className="block text-xs font-medium text-slate-500 mb-1">{f.label}</label>
              {f.multiline ? (
                <textarea
                  value={form[f.key] || ''}
                  onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: e.target.value }))}
                  placeholder={f.placeholder}
                  rows={2}
                  className="input w-full"
                />
              ) : (
                <input
                  value={form[f.key] || ''}
                  onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: e.target.value }))}
                  placeholder={f.placeholder}
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
              {busy ? 'Saving…' : 'Save invoicing details'}
            </button>
            {saved && <span className="text-xs text-emerald-600">Saved.</span>}
          </div>
        </div>
      )}

      {!selected && brands.length === 0 && (
        <p className="text-xs text-slate-400">Add a brand above first, then come back here to fill in its details.</p>
      )}
    </div>
  );
}

export default function BranchBrandManager() {
  const { branches } = useBranches();
  const { brands } = useBrands();

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ListManager<Branch>
          title="Branches"
          helper="Editable department list — each staff member is assigned to one branch, or HQ."
          items={branches}
          onAdd={addBranch}
          onRemove={removeBranch}
          placeholder="e.g. Penang Branch"
        />
        <ListManager<Brand>
          title="Brands"
          helper="Every tender is assigned to one of your brands, for brand-level performance."
          items={brands}
          onAdd={addBrand}
          onRemove={removeBrand}
          placeholder="e.g. Brand name"
        />
      </div>

      <BrandInvoicingDetails brands={brands} />
    </div>
  );
}
