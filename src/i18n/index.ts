import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import ms from "./locales/ms.json";

export type AppLanguage = "en" | "ms";

const STORAGE_KEY = "ipsb-language";

/** Per-browser fallback so the UI shows the right language on the very first paint — before
 *  AuthContext has had a chance to load the signed-in user's own saved `profile.language` from
 *  Firestore (see AuthContext.tsx) and override it. Also what a signed-out visitor on the Login
 *  page sees, since there's no profile to read from yet at that point. */
function getStoredLanguage(): AppLanguage {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "en" || stored === "ms") return stored;
  } catch {
    // Private browsing / blocked storage — fall back to the default below.
  }
  return "en";
}

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, ms: { translation: ms } },
  lng: getStoredLanguage(),
  fallbackLng: "en",
  interpolation: { escapeValue: false }, // React already escapes — avoid double-escaping.
  returnNull: false,
});

/** The one place that changes the active language. Always updates localStorage (so it survives
 *  a reload/sign-out even for a not-yet-signed-in visitor); syncing it to the signed-in user's
 *  own Firestore profile (so it follows them to another device) is the CALLER's job — see the
 *  language toggle in AppLayout.tsx, which does both together. */
export function setLanguage(lang: AppLanguage) {
  void i18n.changeLanguage(lang);
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // Best-effort only — the language still changes for this session either way.
  }
}

/**
 * Turns a data-model label (a pipeline Stage, e.g. "Prepare Proposal") into the camelCase key
 * under which its translation lives (`pipeline.stages.prepareProposal`). Firestore always stores
 * and compares the plain English label (see STAGES in types.ts) — this is display-only, so the
 * data model itself never has to change for a translation. Works for any "Capitalized Words"
 * label, so the same helper is reused wherever another such label needs a translated display form.
 */
export function labelToKey(label: string): string {
  return label.charAt(0).toLowerCase() + label.slice(1).replace(/ (.)/g, (_, c: string) => c.toUpperCase());
}

export default i18n;
