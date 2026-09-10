import { useEffect, useRef, useState } from 'react';
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import type { Tender } from '../../types';

interface ToastItem {
  id: string;
  clientName: string;
  department: string;
  ownerName: string;
}

const AUTO_DISMISS_MS = 10000;

/**
 * Admin-only: pops up a dismissible in-app banner the instant a new tender is registered,
 * anywhere in the CRM (not just while on the Pipeline page) - live via a Firestore listener.
 *
 * Mounted once in App.tsx, alongside <Routes> rather than inside AppLayout, because AppLayout is
 * re-instantiated by every <Route> element and would otherwise remount (and reset) this watcher
 * on every page navigation.
 *
 * Non-admins (branchManager, dutyStaff, payroll) never subscribe at all - this is a pure "admin
 * sees every new tender the moment it's created" notification, matching Firestore's own admin
 * read rule on the tenders collection (see firestore.rules).
 */
export default function NewTenderWatcher() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  // Anything created before this watermark is "old" - it's what keeps the very first snapshot
  // (which reports every matching existing doc as an 'added' change) from flooding the admin
  // with toasts for tenders that already existed when they signed in / the tab loaded.
  const startedAtRef = useRef(Date.now());

  useEffect(() => {
    if (!profile || profile.role !== 'admin') return;
    startedAtRef.current = Date.now();

    const q = query(collection(db, 'tenders'), orderBy('createdAt', 'desc'), limit(20));
    const unsub = onSnapshot(
      q,
      (snap) => {
        snap.docChanges().forEach((change) => {
          if (change.type !== 'added') return;
          const data = change.doc.data() as Omit<Tender, 'id'>;
          if (!data.createdAt || data.createdAt < startedAtRef.current) return;
          setToasts((prev) =>
            prev.some((t) => t.id === change.doc.id)
              ? prev
              : [
                  ...prev,
                  {
                    id: change.doc.id,
                    clientName: data.clientName,
                    department: data.department,
                    ownerName: data.ownerName,
                  },
                ]
          );
        });
      },
      (err) => {
        console.error('NewTenderWatcher subscription error', err);
      }
    );
    return unsub;
  }, [profile?.uid, profile?.role]);

  const dismiss = (id: string) => setToasts((prev) => prev.filter((t) => t.id !== id));

  useEffect(() => {
    if (!toasts.length) return;
    const timers = toasts.map((t) => setTimeout(() => dismiss(t.id), AUTO_DISMISS_MS));
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toasts.length]);

  if (!toasts.length) return null;

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 w-80">
      {toasts.map((t) => (
        <div key={t.id} className="bg-white border border-slate-200 shadow-lg rounded-xl p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-900">New tender registered</p>
              <p className="text-sm text-slate-600 mt-0.5 truncate">
                {t.clientName} · {t.department}
              </p>
              <p className="text-xs text-slate-400 mt-0.5">by {t.ownerName}</p>
            </div>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss"
              className="text-slate-400 hover:text-slate-600 text-sm leading-none shrink-0"
            >
              ✕
            </button>
          </div>
          <button
            type="button"
            onClick={() => {
              navigate('/pipeline');
              dismiss(t.id);
            }}
            className="mt-3 text-xs font-medium text-blue-600 hover:text-blue-700"
          >
            View in Pipeline →
          </button>
        </div>
      ))}
    </div>
  );
}
