import { useEffect, useRef, useState } from 'react';
import { collection, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import type { Tender } from '../../types';

interface ToastItem {
  id: string;
  clientName: string;
  brandName: string;
  stage: string;
}

const AUTO_DISMISS_MS = 10000;

/**
 * Branch Manager-only: pops up a dismissible in-app banner the instant a tender lands in their
 * own pipeline - either because HQ Admin just registered a brand-new lead directly under them,
 * or (the more common case) Admin registered it centrally and then reassigned the Tender Owner
 * to this branch manager to nurture it through the stages. See TenderFormModal.tsx: only Admin
 * can change a tender's Owner, and Department always follows the Owner, so "assigned to me" here
 * always means a specific person at this branch - never just a department label with no owner.
 *
 * Deliberately scoped to branchManager only - dutyStaff/payroll never touch Pipeline at all (see
 * the nav guard in AppLayout.tsx and the hideFromStaff route guard), and admin already gets its
 * own "new tender registered" banner from NewTenderWatcher, so admin doesn't also get this one
 * for tenders it assigns to itself (that would just be a redundant duplicate notification).
 *
 * Mounted once in App.tsx, alongside <Routes> (not inside AppLayout, which remounts on every
 * route change and would otherwise reset this watcher on every page navigation) - same pattern
 * as NewTenderWatcher.
 */
export default function TenderAssignedWatcher() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  // Firestore always reports every currently-matching doc as an 'added' change on the very first
  // snapshot of a listener - so without this, a branch manager would get toasted for every
  // tender already sitting in their pipeline the moment they open the CRM. Skipping the whole
  // first snapshot (rather than using a time watermark, like NewTenderWatcher does) is what's
  // needed here specifically because a *reassigned* tender can have been created long ago -
  // its createdAt is no signal at all for "is this new to me."
  const isFirstSnapshotRef = useRef(true);

  useEffect(() => {
    if (!profile || profile.role !== 'branchManager') return;
    isFirstSnapshotRef.current = true;

    const q = query(
      collection(db, 'tenders'),
      where('ownerUid', '==', profile.uid),
      orderBy('updatedAt', 'desc'),
      limit(20)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const wasFirst = isFirstSnapshotRef.current;
        isFirstSnapshotRef.current = false;
        if (wasFirst) return;
        snap.docChanges().forEach((change) => {
          if (change.type !== 'added') return;
          const data = change.doc.data() as Omit<Tender, 'id'>;
          setToasts((prev) =>
            prev.some((t) => t.id === change.doc.id)
              ? prev
              : [
                  ...prev,
                  {
                    id: change.doc.id,
                    clientName: data.clientName,
                    brandName: data.brandName,
                    stage: data.stage,
                  },
                ]
          );
        });
      },
      (err) => {
        console.error('TenderAssignedWatcher subscription error', err);
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
              <p className="text-sm font-semibold text-slate-900">New tender in your pipeline</p>
              <p className="text-sm text-slate-600 mt-0.5 truncate">
                {t.clientName} · {t.brandName}
              </p>
              <p className="text-xs text-slate-400 mt-0.5">Stage: {t.stage}</p>
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
