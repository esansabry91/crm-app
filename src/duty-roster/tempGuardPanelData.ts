/**
 * Adjustments tab — "Assign a temporary guard" panel. Ported from renderTempGuardPanel()
 * (lines 3972-4035), openTempGuardDetailsModal() (lines 3940-3971), and the #assignTempBtn
 * handler (line 5298).
 */
import type { SiteConfig, MonthState, TempGuardRecord, ConflictEntry } from "./types";
import { newId, nowIso, monthTempGuards } from "./rosterModel";
import { appendLog } from "./lockMachine";
import { shiftLabelForKey } from "./shiftStructure";
import { isValidMykad, isValidPhone } from "./guardValidation";

export interface TempSlotOption {
  key: string; // "date|shiftId|slot"
  label: string; // "date — shiftLabel, Slot N"
}

/** Populates #tempSlotSelect from result.conflicts (this month's unfilled slots). */
export function buildTempSlotOptions(conflicts: ConflictEntry[]): TempSlotOption[] {
  return conflicts.map((c) => ({
    key: `${c.date}|${c.shiftId}|${c.slot}`,
    label: `${c.date} — ${c.shiftLabel}, Slot ${c.slot + 1}`,
  }));
}

export interface TempGuardRow {
  tempId: string;
  date: string;
  shiftSlotLabel: string;
  name: string;
  rate: number;
}

/** Existing-temp-guards table — orphans (no override still references them) are silently
 * skipped, sorted by date ascending. */
export function buildTempGuardRows(config: Pick<SiteConfig, "site">, ms: MonthState): { rows: TempGuardRow[]; total: number } {
  const tg = monthTempGuards(ms);
  const rows: TempGuardRow[] = [];
  Object.keys(tg).forEach((tempId) => {
    const key = Object.keys(ms.overrides).find((k) => ms.overrides[k] === tempId);
    if (!key) return;
    const [date, shiftId, slot] = key.split("|");
    rows.push({
      tempId,
      date,
      shiftSlotLabel: `${shiftLabelForKey(config.site, date, shiftId)}, Slot ${Number(slot) + 1}`,
      name: tg[tempId].name,
      rate: Number(tg[tempId].rate) || 0,
    });
  });
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const total = rows.reduce((sum, r) => sum + r.rate, 0);
  return { rows, total };
}

export interface TempGuardIdentityFormValues {
  name: string;
  rateRaw: string;
  mykadNumber: string;
  ageRaw: string;
  phoneNumber: string;
  state: string;
  city: string;
}

export interface TempGuardFormValues extends TempGuardIdentityFormValues {
  slotKey: string;
}

/** The 7-field identity/rate validation shared verbatim by both callers that create a
 * TempGuardRecord: the standalone "Assign a temporary guard" panel (which additionally requires a
 * slot pick first, see validateTempGuardForm() below) and the temp-guard branch of "Assign an
 * additional guard" (additionalGuardData.ts), which validates its date range separately instead
 * of a slot. */
export function validateTempGuardIdentityFields(form: TempGuardIdentityFormValues): { error: string } | { record: TempGuardRecord } {
  const name = form.name.trim();
  if (!name) return { error: "Enter the temporary guard's name." };
  const rate = Number(form.rateRaw);
  if (form.rateRaw.trim() === "" || !Number.isFinite(rate) || rate < 0) return { error: "Enter a valid rate." };
  if (!isValidMykad(form.mykadNumber)) return { error: "Enter a valid 12-digit MyKad number (e.g. 901231-14-5678)." };
  const age = Number(form.ageRaw);
  if (form.ageRaw.trim() === "" || !Number.isFinite(age) || age <= 0) return { error: "Enter a valid age." };
  if (!isValidPhone(form.phoneNumber)) return { error: "Enter a valid phone number (e.g. 012-3456789)." };
  const state = form.state.trim();
  if (!state) return { error: "Enter the temporary guard's state." };
  const city = form.city.trim();
  if (!city) return { error: "Enter the temporary guard's city." };

  return {
    record: { name, rate, mykadNumber: form.mykadNumber, age, phoneNumber: form.phoneNumber, state, city, createdAt: nowIso() },
  };
}

/** #assignTempBtn validation, exact original order (first failure wins): the slot pick, THEN the
 * 7 identity/rate fields via validateTempGuardIdentityFields(). */
export function validateTempGuardForm(form: TempGuardFormValues): { error: string } | { record: TempGuardRecord } {
  if (!form.slotKey) return { error: "Pick an unfilled slot first." };
  return validateTempGuardIdentityFields(form);
}

export interface AssignTempGuardOutcome {
  ms: MonthState;
  toast: string;
  tempId: string;
  record: TempGuardRecord;
}

/** Applies a validated temp-guard assignment — call after validateTempGuardForm() succeeds.
 * The caller should follow up with syncBufferGuardOnAssign(record, siteMeta, isTestData), matching
 * the original's call right after persistMonth(). */
export function applyAssignTempGuard(
  config: Pick<SiteConfig, "site">,
  ms: MonthState,
  slotKey: string,
  record: TempGuardRecord
): AssignTempGuardOutcome {
  const tempId = newId("temp");
  const [date, shiftId, slot] = slotKey.split("|");
  const label = shiftLabelForKey(config.site, date, shiftId);
  const nextMs = appendLog(
    {
      ...ms,
      tempGuards: { ...ms.tempGuards, [tempId]: record },
      overrides: { ...ms.overrides, [slotKey]: tempId },
    },
    `Assigned temporary guard ${record.name} (RM ${record.rate.toFixed(2)}) to ${label}, Slot ${Number(slot) + 1} on ${date}.`
  );
  return { ms: nextMs, toast: `Assigned ${record.name} to cover ${date}.`, tempId, record };
}

/** Remove-temp-guard confirm message (shared wording with the support-guard panel's own Remove). */
export function removeTempOrSupportGuardConfirmMessage(name: string): string {
  return `Remove ${name} from this slot? It goes back to unfilled unless another guard covers it.`;
}

export interface RemoveTempGuardOutcome {
  ms: MonthState;
  toast: string;
}

/** Remove — only clears the override if it still points at this exact temp id (doesn't stomp
 * a later reassignment). */
export function applyRemoveTempGuard(ms: MonthState, tempId: string): RemoveTempGuardOutcome | null {
  const tg = monthTempGuards(ms);
  const record = tg[tempId];
  if (!record) return null;
  const key = Object.keys(ms.overrides).find((k) => ms.overrides[k] === tempId);
  const nextOverrides = { ...ms.overrides };
  if (key) delete nextOverrides[key];
  const nextTg = { ...tg };
  delete nextTg[tempId];
  const nextMs = appendLog({ ...ms, overrides: nextOverrides, tempGuards: nextTg }, `Removed temporary guard ${record.name}.`);
  return { ms: nextMs, toast: `Removed ${record.name}.` };
}

export interface TempGuardDetailRow {
  label: string;
  value: string;
}

/** openTempGuardDetailsModal() (lines 3940-3971) — read-only View. */
export function tempGuardDetailRows(record: TempGuardRecord): TempGuardDetailRow[] {
  return [
    { label: "Full name", value: record.name || "—" },
    { label: "MyKad number", value: record.mykadNumber || "Not set" },
    { label: "Age", value: record.age != null ? String(record.age) : "Not set" },
    { label: "Phone number", value: record.phoneNumber || "Not set" },
    { label: "State", value: record.state || "Not set" },
    { label: "City", value: record.city || "Not set" },
    { label: "Rate (RM)", value: (Number(record.rate) || 0).toFixed(2) },
  ];
}
