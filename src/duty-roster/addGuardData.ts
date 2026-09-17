/**
 * "Add guard" and "View guard" modals (Guards & Shifts tab) — ported from
 * openAddGuardModal()/renderAddGuardCategoryFields() (lines 1846-1978) and
 * openGuardDetailsModal() (lines 1998-2036).
 */
import type { Guard, TenderRateConfig } from "./types";
import { newId } from "./rosterModel";
import { isValidMykad, isValidPhone } from "./guardValidation";
import { guardRate } from "./rateResolution";

export type GuardCategory = "local" | "nepal";

export interface AddGuardFormValues {
  category: GuardCategory;
  employeeId: string;
  name: string;
  state: string;
  city: string;
  /** Only meaningful/required when a position list is offered (posNames.length > 0). */
  position: string;
  ageRaw: string;
  // "nepal" category
  passportNumber: string;
  permitExpiryDate: string;
  // non-"nepal" categories (already dash-formatted via guardValidation's formatMykadInput/
  // formatPhoneInput as the user types)
  mykadNumber: string;
  phoneNumber: string;
}

/** Validates the Add Guard form in the EXACT original order — first failure wins. `posNames`
 * is `ratePositionNames(rateConfig)`; pass the same list the modal used to decide whether to
 * render the Position field at all (so validation and rendering never disagree). */
export function validateAddGuardForm(form: AddGuardFormValues, posNames: string[]): { error: string } | { guard: Guard } {
  const employeeId = form.employeeId.trim();
  const name = form.name.trim();
  const state = form.state.trim();
  const city = form.city.trim();

  if (!employeeId) return { error: "Employee ID is required." };
  if (!name) return { error: "Full name is required." };
  if (!state) return { error: "State is required." };
  if (!city) return { error: "City is required." };
  if (posNames.length && !form.position) return { error: "Pick a position." };

  const age = Number(form.ageRaw);
  if (form.ageRaw.trim() === "" || !Number.isFinite(age) || age <= 0) return { error: "Enter a valid age." };

  const base: Guard = {
    id: newId("g"),
    name,
    employeeId,
    active: true,
    inactiveFrom: null,
    category: form.category,
    age,
    state,
    city,
  };
  if (form.position) base.position = form.position;

  if (form.category === "nepal") {
    const passportNumber = form.passportNumber.trim();
    if (!passportNumber) return { error: "Passport number is required." };
    const permitExpiryDate = form.permitExpiryDate.trim();
    if (!permitExpiryDate) return { error: "Permit expiry date is required." };
    return { guard: { ...base, passportNumber, permitExpiryDate } };
  }

  if (!isValidMykad(form.mykadNumber)) return { error: "Enter a valid 12-digit MyKad number (e.g. 901231-14-5678)." };
  if (!isValidPhone(form.phoneNumber)) return { error: "Enter a valid phone number (e.g. 012-3456789)." };
  return { guard: { ...base, mykadNumber: form.mykadNumber, phoneNumber: form.phoneNumber } };
}

/** "Added guard ${name}${employeeId ? \` (ID ${employeeId})\` : ""}." — the change-log line
 * (distinct from the toast, which is always just "Added ${name}."). */
export function addGuardLogText(guard: Guard): string {
  return `Added guard ${guard.name}${guard.employeeId ? ` (ID ${guard.employeeId})` : ""}.`;
}

export interface GuardDetailRow {
  label: string;
  value: string;
}

/** openGuardDetailsModal()'s row list (lines 1998-2036). Rate is resolved LIVE off the linked
 * tender's current rate config — never a value stored on the guard. */
export function guardDetailRows(guard: Guard, rateConfig: TenderRateConfig | null): GuardDetailRow[] {
  const rows: GuardDetailRow[] = [
    { label: "Employee ID", value: guard.employeeId || "—" },
    { label: "Full name", value: guard.name },
    { label: "Category", value: guard.category === "nepal" ? "Nepal" : guard.category === "local" ? "Local" : "Not set" },
  ];
  if (guard.category === "nepal") {
    rows.push(
      { label: "Passport number", value: guard.passportNumber || "Not set" },
      { label: "Permit expiry date", value: guard.permitExpiryDate || "Not set" }
    );
  } else {
    rows.push(
      { label: "MyKad number", value: guard.mykadNumber || "Not set" },
      { label: "Phone number", value: guard.phoneNumber || "Not set" }
    );
  }
  rows.push({ label: "State", value: guard.state || "Not set" }, { label: "City", value: guard.city || "Not set" });
  if (guard.position) rows.push({ label: "Position", value: guard.position });
  const rate = guardRate(rateConfig, guard);
  rows.push({ label: "Rate (RM/manhour)", value: rate != null ? rate.toFixed(2) : "Not set" });
  rows.push({ label: "Age", value: guard.age != null ? String(guard.age) : "Not set" });
  rows.push({ label: "Status", value: guard.active === false ? "Inactive" : "Active" });
  return rows;
}

/** openDismissGuardModal()'s fixed reason list, in order (first = default). */
export const DISMISS_REASONS = ["Terminated", "Resigned", "Runaway"] as const;
