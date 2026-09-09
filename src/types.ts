// Core domain types shared across the app.

export type Role = 'admin' | 'staff';

/** The 7 fixed pipeline stages, in kanban column order. */
export const STAGES = [
  'New Lead',
  'Qualified Lead',
  'Prepare Proposal',
  'Submitted',
  'Negotiation',
  'Won',
  'Lost',
] as const;

export type Stage = (typeof STAGES)[number];

/** Stages that still count as "open" / active pipeline (not yet a final outcome). */
export const OPEN_STAGES: Stage[] = [
  'New Lead',
  'Qualified Lead',
  'Prepare Proposal',
  'Submitted',
  'Negotiation',
];

export const CLOSED_STAGES: Stage[] = ['Won', 'Lost'];

export interface UserProfile {
  uid: string;
  name: string;
  email: string;
  role: Role;
  /** Branch name this staff member belongs to, or "HQ". Admins may be HQ-wide. */
  department: string;
  active: boolean;
  createdAt: number;
}

export interface Branch {
  id: string;
  name: string;
  createdAt: number;
}

export interface Brand {
  id: string;
  name: string;
  createdAt: number;
}

export interface Tender {
  id: string;
  clientName: string;
  brandId: string;
  brandName: string; // denormalized for display without extra lookups
  department: string; // branch name, or "HQ"
  contractStart: string; // ISO date (yyyy-mm-dd)
  contractEnd: string; // ISO date (yyyy-mm-dd)
  tenderValue: number; // in RM
  stage: Stage;
  ownerUid: string;
  ownerName: string; // denormalized
  notes?: string;
  /** ISO date (yyyy-mm-dd) the tender was actually won/lost — only meaningful when stage is Won or Lost. */
  closedDate?: string;
  /**
   * The branch actually running the awarded contract — only meaningful once stage is Won.
   * Defaults to `department` (the branch that submitted/owns the tender) the moment it's won,
   * but an admin can reassign it afterwards from the Active Projects page — e.g. HQ wins a
   * tender but a specific branch ends up delivering it. Kept separate from `department` so
   * sales-attribution charts (credit for winning the deal) aren't affected by later
   * operational reassignment (who's now running it).
   */
  activeBranch?: string;
  /**
   * Operational detail fields for an Active Project — only meaningful once stage is Won.
   * Editable by the tender's admin/owner AND by anyone else who can see it in Active Projects
   * (branch-mates in the same `activeBranch`, plus HQ) — see the widened update rule in
   * firestore.rules, which allows exactly these four fields (not the rest of the tender) to be
   * changed by non-owners.
   */
  location?: string; // worksite / site address
  contactPerson?: string; // on-site or client contact (free text: name, phone, email, etc.)
  guardsDeployed?: number; // number of security guards currently deployed
  tenderDocNumber?: string; // official tender submission document number/ID
  createdAt: number;
  updatedAt: number;
}

/** One entry in a tender's audit trail, used to reconstruct the pipeline-value trend over time. */
export interface TenderHistoryEntry {
  id: string;
  tenderId: string;
  timestamp: number;
  type: 'created' | 'stage_change' | 'value_change' | 'updated' | 'deleted';
  stage: Stage;
  value: number;
  changedByUid: string;
  changedByName: string;
  fromStage?: Stage;
  ownerUid: string;
}
