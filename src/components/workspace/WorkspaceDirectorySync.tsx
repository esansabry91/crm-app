/**
 * Keeps this signed-in user's /workspaceDirectory entry current for the ENTIRE session, not just
 * while they happen to have My Workspace open — MyWorkspacePage.tsx used to run this sync itself,
 * which meant a user who never opened that tab never became searchable/invitable as a Meeting
 * attendee for anyone else (the Meeting attendee picker in MeetingDialog.tsx reads straight off
 * /workspaceDirectory, not /users — see that service's own doc comment for why). Mounted once in
 * App.tsx, same "survive navigation" reasoning as NewTenderWatcher/TenderAssignedWatcher/
 * DailyPriorityPrompt. Renders nothing.
 */
import { useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { syncOwnWorkspaceDirectoryEntry } from '../../services/workspaceDirectory';

export default function WorkspaceDirectorySync() {
  const { profile } = useAuth();

  useEffect(() => {
    if (profile) void syncOwnWorkspaceDirectoryEntry(profile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.uid, profile?.name, profile?.department, profile?.active]);

  return null;
}
