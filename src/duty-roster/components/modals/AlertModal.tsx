import { useTranslation } from "react-i18next";

/**
 * Generic single-button alert — React equivalent of openAlertModal() (index.html lines
 * 1823-1844). Only one caller in this port's scope so far: the FULLH "remove last post" guard
 * ("Can't remove" / "Each shift category needs at least one guard post—add a replacement
 * before removing the last one.").
 */
export interface AlertModalProps {
  open: boolean;
  title: string;
  message: string;
  onClose: () => void;
}

export default function AlertModal({ open, title, message, onClose }: AlertModalProps) {
  const { t } = useTranslation();
  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        <p className="text-sm text-slate-600 mt-2">{message}</p>
        <div className="flex justify-end mt-5">
          <button type="button" onClick={onClose} className="px-4 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg">
            {t('dutyRoster.common.ok')}
          </button>
        </div>
      </div>
    </div>
  );
}
