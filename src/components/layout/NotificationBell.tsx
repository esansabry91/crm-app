/**
 * My Workspace meeting notifications (invite/updated/cancelled/declined) — ported from
 * gdsb-portal's own notification bell (apps/web/src/components/NotificationBell.tsx), rebuilt
 * against crm-app's Firestore-backed services/workspaceNotifications.ts instead of that
 * project's REST endpoint.
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { useAuth } from '../../contexts/AuthContext';
import { markAllWorkspaceNotificationsRead, markWorkspaceNotificationRead, subscribeMyWorkspaceNotifications } from '../../services/workspaceNotifications';
import type { WorkspaceNotification } from '../../types';

function timeAgo(ts: number): string {
  const mins = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export default function NotificationBell() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState<WorkspaceNotification[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!profile) return;
    return subscribeMyWorkspaceNotifications(profile.uid, setItems);
  }, [profile?.uid]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  if (!profile) return null;

  const unread = items.filter((n) => !n.readAt);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Notifications"
        className="relative p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-700"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unread.length > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-rose-600 text-white text-[10px] leading-4 text-center">
            {unread.length > 9 ? '9+' : unread.length}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 max-h-96 overflow-y-auto bg-white rounded-xl border border-slate-200 shadow-xl z-50">
          <div className="flex items-center justify-between px-3 py-2 border-b border-slate-100">
            <p className="text-sm font-semibold text-slate-800">Notifications</p>
            {unread.length > 0 && (
              <button
                type="button"
                onClick={() => void markAllWorkspaceNotificationsRead(unread.map((n) => n.id))}
                className="text-xs font-medium text-blue-600 hover:text-blue-700"
              >
                Mark all read
              </button>
            )}
          </div>
          {items.length === 0 ? (
            <p className="text-sm text-slate-400 px-3 py-4 text-center">Nothing yet.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {items.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => {
                    if (!n.readAt) void markWorkspaceNotificationRead(n.id);
                    setOpen(false);
                    navigate('/my-workspace');
                  }}
                  className={clsx('w-full text-left px-3 py-2.5 hover:bg-slate-50', !n.readAt && 'bg-blue-50/60')}
                >
                  <p className="text-sm font-medium text-slate-800">{n.title}</p>
                  {n.body && <p className="text-xs text-slate-500 mt-0.5">{n.body}</p>}
                  <p className="text-[11px] text-slate-400 mt-0.5">{timeAgo(n.createdAt)}</p>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
