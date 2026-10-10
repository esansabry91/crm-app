/**
 * My Workspace — Today Tasks + Weekly Planner (incl. meeting schedule), ported from gdsb-portal's
 * own My Workspace feature (its workspacePlannerOnly() subset specifically — see the doc comment
 * above WorkspaceTask in types.ts). Reachable by every role, exactly like Employee Feedback: each
 * person only ever sees their own tasks and the meetings they organize or are invited to.
 */
import { useState } from 'react';
import clsx from 'clsx';
import { useAuth } from '../contexts/AuthContext';
import TodayTasks from '../components/workspace/TodayTasks';
import Planner from '../components/workspace/Planner';

type Tab = 'today' | 'week';

export default function MyWorkspacePage() {
  const { profile } = useAuth();
  const [tab, setTab] = useState<Tab>('today');

  // The /workspaceDirectory sync itself now lives in WorkspaceDirectorySync.tsx (mounted once in
  // App.tsx for the whole session) so every signed-in user becomes an invitable Meeting attendee
  // right away, not only once they happen to open this page.

  if (!profile) return null;

  return (
    <div className="h-full overflow-y-auto">
      <header className="px-6 py-5 border-b border-slate-200 bg-white sticky top-0 z-10">
        <h1 className="text-lg font-semibold text-slate-900">My Workspace</h1>
        <p className="text-sm text-slate-500 mt-1">Today's tasks, your weekly planner, and meetings — yours alone.</p>
        <div className="flex items-center gap-6 mt-4 border-b border-slate-200">
          {(['today', 'week'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={clsx(
                'pb-3 -mb-px text-sm font-medium border-b-2 transition',
                tab === t ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-700'
              )}
            >
              {t === 'today' ? 'Today Tasks' : 'Weekly Planner'}
            </button>
          ))}
        </div>
      </header>

      <div className="p-6 max-w-7xl mx-auto">{tab === 'today' ? <TodayTasks /> : <Planner />}</div>
    </div>
  );
}
