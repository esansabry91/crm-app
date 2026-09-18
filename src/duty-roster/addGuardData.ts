/**
 * "Add guard" and "View guard" modals (Guards & Shifts tab) — ported from
 * openAddGuardModal()/renderAddGuardCategoryFields() (lines 1846-1978) and
 * openGuardDetailsModal() (lines 1998-2036).
 */
import type { TFunction } from "i18next";
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
export function validateAddGuardForm(form: AddGuardFormValues, posNames: string[], t: TFunction): { error: string } | { guard: Guard } {
  const employeeId = form.employeeId.trim();
  const name = form.name.trim();
  const state = form.state.trim();
  const city = form.city.trim();

  if (!employeeId) return { error: t("dutyRoster.addGuard.errorEmployeeIdRequired") };
  if (!name) return { error: t("dutyRoster.addGuard.errorFullNameRequired") };
  if (!state) return { error: t("dutyRoster.addGuard.errorStateRequired") };
  if (!city) return { error: t("dutyRoster.addGuard.errorCityRequired") };
  if (posNames.length && !form.position) return { error: t("dutyRoster.addGuard.errorPickPosition") };

  const age = Number(form.ageRaw);
  if (form.ageRaw.trim() === "" || !Number.isFinite(age) || age <= 0) return { error: t("dutyRoster.addGuard.errorInvalidAge") };

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
    if (!passportNumber) return { error: t("dutyRoster.addGuard.errorPassportRequired") };
    const permitExpiryDate = form.permitExpiryDate.trim();
    if (!permitExpiryDate) return { error: t("dutyRoster.addGuard.errorPermitExpiryRequired") };
    return { guard: { ...base, passportNumber, permitExpiryDate } };
  }

  if (!isValidMykad(form.mykadNumber)) return { error: t("dutyRoster.addGuard.errorInvalidMykad") };
  if (!isValidPhone(form.phoneNumber)) return { error: t("dutyRoster.addGuard.errorInvalidPhone") };
  return { guard: { ...base, mykadNumber: form.mykadNumber, phoneNumber: form.phoneNumber } };
}

/** "Added guard ${name}${employeeId ? \` (ID ${employeeId})\` : ""}." — the change-log line
 * (distinct from the toast, which is always just "Added ${name}."). Deliberately left in
 * English, not translated: this text is written once into the roster's permanent Log Panel
 * history (see LogPanel.tsx/appendLog()) and stays as-written from then on, like every other
 * log-line generator across src/duty-roster/ — translating it would mean old entries and new
 * ones show in whatever language happened to be active when each was written, and re-reading
 * history in a mix of languages is worse than reading it in one. Scoped out of this app's BM
 * translation effort for that reason; only this module's interactive UI (labels, buttons,
 * validation errors, dialogs) is translated. */
export function addGuardLogText(guard: Guard): string {
  return `Added guard ${guard.name}${guard.employeeId ? ` (ID ${guard.employeeId})` : ""}.`;
}

export interface GuardDetailRow {
  label: string;
  value: string;
}

/** openGuardDetailsModal()'s row list (lines 1998-2036). Rate is resolved LIVE off the linked
 * tender's current rate config — never a value stored on the guard. */
export function guardDetailRows(guard: Guard, rateConfig: TenderRateConfig | null, t: TFunction): GuardDetailRow[] {
  const notSet = t("dutyRoster.guardDetails.notSet");
  const rows: GuardDetailRow[] = [
    { label: t("dutyRoster.guardDetails.employeeId"), value: guard.employeeId || "—" },
    { label: t("dutyRoster.guardDetails.fullName"), value: guard.name },
    {
      label: t("dutyRoster.guardDetails.category"),
      value: guard.category === "nepal" ? t("dutyRoster.guardDetails.nepal") : guard.category === "local" ? t("dutyRoster.guardDetails.local") : notSet,
    },
  ];
  if (guard.category === "nepal") {
    rows.push(
      { label: t("dutyRoster.guardDetails.passportNumber"), value: guard.passportNumber || notSet },
      { label: t("dutyRoster.guardDetails.permitExpiryDate"), value: guard.permitExpiryDate || notSet }
    );
  } else {
    rows.push(
      { label: t("dutyRoster.guardDetails.mykadNumber"), value: guard.mykadNumber || notSet },
      { label: t("dutyRoster.guardDetails.phoneNumber"), value: guard.phoneNumber || notSet }
    );
  }
  rows.push(
    { label: t("projectDetails.state"), value: guard.state || notSet },
    { label: t("projectDetails.city"), value: guard.city || notSet }
  );
  if (guard.position) rows.push({ label: t("dutyRoster.guardDetails.position"), value: guard.position });
  const rate = guardRate(rateConfig, guard);
  rows.push({ label: t("dutyRoster.guardDetails.rateRmManhour"), value: rate != null ? rate.toFixed(2) : notSet });
  rows.push({ label: t("dutyRoster.guardDetails.age"), value: guard.age != null ? String(guard.age) : notSet });
  rows.push({ label: t("dutyRoster.guardDetails.status"), value: guard.active === false ? t("dutyRoster.guardDetails.inactive") : t("dutyRoster.guardDetails.active") });
  return rows;
}

/** openDismissGuardModal()'s fixed reason list, in order (first = default). */
export const DISMISS_REASONS = ["Terminated", "Resigned", "Runaway"] as const;
