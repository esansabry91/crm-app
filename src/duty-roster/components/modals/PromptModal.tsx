import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * Generic single-text-input modal — React equivalent of openPromptModal() (index.html lines
 * 1713-1739). Used by "Rename this site" (Task #21 scope) and kept here as a shared primitive.
 * Submitting an empty (trimmed) value silently closes with no onConfirm call, matching the
 * original.
 */
export interface PromptModalProps {
  open: boolean;
  title: string;
  message?: string;
  initialValue?: string;
  okLabel?: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

export default function PromptModal({ open, title, message, initialValue, okLabel, onConfirm, onCancel }: PromptModalProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState(initialValue || "");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setValue(initialValue || "");
      // Auto-focus + select, matching the original's own auto-focus behavior.
      requestAnimationFrame(() => inputRef.current?.select());
    }
  }, [open, initialValue]);

  if (!open) return null;

  function submit() {
    const trimmed = value.trim();
    if (!trimmed) {
      onCancel();
      return;
    }
    onConfirm(trimmed);
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onCancel}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        {message && <p className="text-sm text-slate-600 mt-1.5">{message}</p>}
        <input
          ref={inputRef}
          type="text"
          className="input mt-3"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            if (e.key === "Escape") onCancel();
          }}
        />
        <div className="flex justify-end gap-2 mt-5">
          <button type="button" onClick={onCancel} className="px-3 py-1.5 text-sm font-medium text-slate-600 hover:text-slate-800">
            {t('dutyRoster.common.cancel')}
          </button>
          <button type="button" onClick={submit} className="px-4 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg">
            {okLabel || t('dutyRoster.common.ok')}
          </button>
        </div>
      </div>
    </div>
  );
}
