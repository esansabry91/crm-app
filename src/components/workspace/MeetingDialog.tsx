/**
 * Create/edit/view a meeting — ported from gdsb-portal's apps/web/src/pages/workspace/
 * Meetings.tsx (MeetingForm/AttendeePicker/InvitedMeeting/MinutesDialog, folded into one dialog
 * here). Online/physical modes, quick-duration buttons, per-person private minutes, and the
 * organizer-edit vs. invited-attendee-view split are all carried over; the custom 3-column
 * TimePicker is simplified to a native `<input type="time" step="300">` (still 5-minute
 * increments, just without a bespoke dropdown) to keep this port buildable in one pass.
 */
import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { useAuth } from '../../contexts/AuthContext';
import {
  createWorkspaceMeeting,
  declineWorkspaceMeeting,
  deleteWorkspaceMeeting,
  saveOwnMeetingMinutes,
  subscribeOwnMeetingMinutes,
  updateWorkspaceMeeting,
  type WorkspaceMeetingFormInput,
} from '../../services/workspaceMeetings';
import { subscribeWorkspaceDirectory } from '../../services/workspaceDirectory';
import type { WorkspaceDirectoryEntry, WorkspaceMeeting, WorkspaceMeetingMode } from '../../types';
import { formatDateDisplay } from '../../utils/workspaceDates';

const DURATIONS = [
  { label: '30 min', minutes: 30 },
  { label: '1 hr', minutes: 60 },
  { label: '1.5 hr', minutes: 90 },
  { label: '2 hr', minutes: 120 },
];

function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}
function toTime(min: number): string {
  const clamped = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(clamped / 60)).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`;
}

export default function MeetingDialog({ date, meeting, onClose }: { date: string; meeting: WorkspaceMeeting | null; onClose: () => void }) {
  const { profile } = useAuth();
  const isOrganizer = !meeting || meeting.organizerUid === profile?.uid;
  const myAttendeeStatus = meeting && profile ? meeting.attendees[profile.uid]?.status : undefined;

  const [title, setTitle] = useState(meeting?.title ?? '');
  const [withWhom, setWithWhom] = useState(meeting?.withWhom ?? '');
  const [notes, setNotes] = useState(meeting?.notes ?? '');
  const [startTime, setStartTime] = useState(meeting?.startTime ?? '09:00');
  const [endTime, setEndTime] = useState(meeting?.endTime ?? '09:30');
  const [mode, setMode] = useState<WorkspaceMeetingMode>(meeting?.mode ?? null);
  const [link, setLink] = useState(meeting?.link ?? '');
  const [location, setLocation] = useState(meeting?.location ?? '');
  const [directory, setDirectory] = useState<WorkspaceDirectoryEntry[]>([]);
  const [search, setSearch] = useState('');
  const [attendeeDropdownOpen, setAttendeeDropdownOpen] = useState(false);
  const [selected, setSelected] = useState<Map<string, string>>(
    () => new Map(meeting ? Object.values(meeting.attendees).filter((a) => a.uid !== meeting.organizerUid).map((a) => [a.uid, a.name]) : [])
  );
  const [minutes, setMinutes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => subscribeWorkspaceDirectory(setDirectory), []);

  useEffect(() => {
    if (!meeting || !profile) return;
    return subscribeOwnMeetingMinutes(meeting.id, profile.uid, setMinutes);
  }, [meeting?.id, profile?.uid]);

  // Only suggests people not already added, and only once something's actually been typed — no
  // standing list of every colleague to scroll through (see addAttendee()'s own doc comment).
  const candidates = useMemo(
    () =>
      directory
        .filter((d) => d.active && d.uid !== profile?.uid && !selected.has(d.uid))
        .filter((d) => search.trim() && d.name.toLowerCase().includes(search.trim().toLowerCase()))
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, 8),
    [directory, search, profile?.uid, selected]
  );

  function applyDuration(minutesLength: number) {
    setEndTime(toTime(toMin(startTime) + minutesLength));
  }

  /** Picking a suggestion from the dropdown adds them as a chip and clears the search box, ready
   *  to type the next name — a type-ahead add, not a checklist to tick. */
  function addAttendee(entry: WorkspaceDirectoryEntry) {
    setSelected((prev) => new Map(prev).set(entry.uid, entry.name));
    setSearch('');
  }

  function removeAttendee(uid: string) {
    setSelected((prev) => {
      const next = new Map(prev);
      next.delete(uid);
      return next;
    });
  }

  async function handleSave() {
    if (!profile) return;
    setError(null);
    if (!title.trim()) {
      setError('Give the meeting a title.');
      return;
    }
    if (startTime && endTime && endTime < startTime) {
      setError('Ends before it starts.');
      return;
    }
    if (mode === 'online' && link.trim() && !/^https?:\/\/\S+$/i.test(link.trim())) {
      setError('Paste a full link starting with https://');
      return;
    }
    const input: WorkspaceMeetingFormInput = {
      date,
      startTime: startTime || null,
      endTime: endTime || null,
      title,
      withWhom,
      notes,
      mode,
      link,
      location,
      attendees: Array.from(selected, ([uid, name]) => ({ uid, name })),
    };
    setBusy(true);
    try {
      if (meeting) await updateWorkspaceMeeting(meeting, input);
      else await createWorkspaceMeeting(profile.uid, profile.name, input);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save this meeting.');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!meeting) return;
    setBusy(true);
    try {
      await deleteWorkspaceMeeting(meeting);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete this meeting.');
      setBusy(false);
    }
  }

  async function handleDecline() {
    if (!meeting || !profile) return;
    setBusy(true);
    try {
      await declineWorkspaceMeeting(meeting, profile.uid, profile.name);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not decline this meeting.');
      setBusy(false);
    }
  }

  async function handleMinutesBlur() {
    if (!meeting || !profile) return;
    await saveOwnMeetingMinutes(meeting.id, profile.uid, minutes);
  }

  if (!profile) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-6" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-lg max-h-full overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">
            {meeting ? (isOrganizer ? 'Edit meeting' : 'Meeting') : 'Schedule meeting'}
          </h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 text-sm">
            ✕
          </button>
        </div>
        <p className="text-xs text-slate-400 -mt-2">{formatDateDisplay(date)}</p>

        {isOrganizer ? (
          <>
            <div>
              <label className="text-xs font-medium text-slate-500">Title</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} className="input mt-1" placeholder="Meeting title" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-slate-500">Start</label>
                <input type="time" step={300} value={startTime} onChange={(e) => setStartTime(e.target.value)} className="input mt-1" />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-500">End</label>
                <input type="time" step={300} value={endTime} onChange={(e) => setEndTime(e.target.value)} className="input mt-1" />
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {DURATIONS.map((d) => (
                <button
                  key={d.minutes}
                  type="button"
                  onClick={() => applyDuration(d.minutes)}
                  className="px-2 py-1 text-xs rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50"
                >
                  {d.label}
                </button>
              ))}
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500">With whom</label>
              <input value={withWhom} onChange={(e) => setWithWhom(e.target.value)} className="input mt-1" placeholder="e.g. Branch Manager, HQ" />
            </div>
            <div className="flex gap-2">
              {(['online', 'physical'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(mode === m ? null : m)}
                  className={clsx('px-3 py-1.5 text-sm rounded-lg border', mode === m ? 'bg-blue-600 text-white border-blue-600' : 'border-slate-200 text-slate-600 hover:bg-slate-50')}
                >
                  {m === 'online' ? '🔗 Online' : '📍 Physical'}
                </button>
              ))}
            </div>
            {mode === 'online' && (
              <input value={link} onChange={(e) => setLink(e.target.value)} className="input" placeholder="https://meet.example.com/..." />
            )}
            {mode === 'physical' && (
              <input value={location} onChange={(e) => setLocation(e.target.value)} className="input" placeholder="Meeting room / address" />
            )}
            <div>
              <label className="text-xs font-medium text-slate-500">Notes</label>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="input mt-1 resize-none" />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500">Invite attendees</label>
              <div className="relative mt-1">
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onFocus={() => setAttendeeDropdownOpen(true)}
                  // Delayed so a dropdown row's onClick still fires — blur beats click otherwise.
                  onBlur={() => setTimeout(() => setAttendeeDropdownOpen(false), 120)}
                  className="input"
                  placeholder="Type a colleague's name…"
                />
                {attendeeDropdownOpen && search.trim() && (
                  <div className="absolute z-10 left-0 right-0 mt-1 max-h-48 overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-lg divide-y divide-slate-100">
                    {candidates.map((c) => (
                      <button
                        key={c.uid}
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => addAttendee(c)}
                        className="w-full flex items-center gap-2 px-2 py-1.5 text-sm text-left hover:bg-slate-50"
                      >
                        <span className="truncate">{c.name}</span>
                        <span className="text-xs text-slate-400 ml-auto shrink-0">{c.department}</span>
                      </button>
                    ))}
                    {candidates.length === 0 && <p className="text-xs text-slate-400 px-2 py-1.5">No matches.</p>}
                  </div>
                )}
              </div>
              {selected.size > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {Array.from(selected, ([uid, name]) => (
                    <span key={uid} className="inline-flex items-center gap-1 pl-2 pr-1 py-1 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-100 rounded-full">
                      {name}
                      <button
                        type="button"
                        onClick={() => removeAttendee(uid)}
                        aria-label={`Remove ${name}`}
                        className="text-blue-400 hover:text-blue-700 leading-none px-0.5"
                      >
                        ✕
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </>
        ) : (
          meeting && (
            <div className="space-y-2">
              <p className="text-sm font-semibold text-slate-900">{meeting.title}</p>
              <p className="text-sm text-slate-600">
                {meeting.startTime ? `${meeting.startTime}${meeting.endTime ? `–${meeting.endTime}` : ''}` : 'All day'}
                {meeting.mode === 'online' && ' · Online'}
                {meeting.mode === 'physical' && (meeting.location ? ` · ${meeting.location}` : ' · In person')}
              </p>
              <p className="text-xs text-slate-400">Organized by {meeting.organizerName}</p>
              {meeting.withWhom && <p className="text-sm text-slate-600">With: {meeting.withWhom}</p>}
              {meeting.mode === 'online' && meeting.link && (
                <a href={meeting.link} target="_blank" rel="noreferrer" className="text-sm text-blue-600 hover:underline break-all">
                  {meeting.link}
                </a>
              )}
              {meeting.notes && <p className="text-sm text-slate-600 whitespace-pre-wrap">{meeting.notes}</p>}
            </div>
          )
        )}

        {meeting && (
          <div>
            <label className="text-xs font-medium text-slate-500">My meeting minutes (private to you)</label>
            <textarea value={minutes} onChange={(e) => setMinutes(e.target.value)} onBlur={handleMinutesBlur} rows={3} className="input mt-1 resize-none" placeholder="Write up this meeting…" />
          </div>
        )}

        {error && <p className="text-sm text-rose-600">{error}</p>}

        <div className="flex items-center justify-between gap-2 pt-1">
          <div>
            {meeting && isOrganizer && (
              <button type="button" onClick={handleDelete} disabled={busy} className="text-sm font-medium text-rose-600 hover:text-rose-700 disabled:opacity-60">
                Delete meeting
              </button>
            )}
            {meeting && !isOrganizer && myAttendeeStatus === 'invited' && (
              <button type="button" onClick={handleDecline} disabled={busy} className="text-sm font-medium text-rose-600 hover:text-rose-700 disabled:opacity-60">
                Decline
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm font-medium text-slate-600 hover:text-slate-800">
              Close
            </button>
            {isOrganizer && (
              <button
                type="button"
                onClick={handleSave}
                disabled={busy}
                className="px-4 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60 rounded-lg"
              >
                {busy ? 'Saving…' : 'Save'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
