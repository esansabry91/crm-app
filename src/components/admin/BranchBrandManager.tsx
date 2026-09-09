import { useState, type FormEvent } from 'react';
import { useBranches, useBrands } from '../../hooks/useBranches';
import { addBrand, addBranch, removeBrand, removeBranch } from '../../services/branches';
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

export default function BranchBrandManager() {
  const { branches } = useBranches();
  const { brands } = useBrands();

  return (
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
  );
}
