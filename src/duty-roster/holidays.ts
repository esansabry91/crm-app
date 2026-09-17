/**
 * Malaysia public holiday calendar (federal + per-state) — ported verbatim from
 * public/duty-roster/index.html lines ~1115-1270.
 *
 * Reference data for the "assign a state to auto-fill public holidays" feature. Malaysia's
 * holidays come in three layers:
 *   1. Federal holidays — observed nationwide, with a couple of known state exceptions
 *      (5 states don't observe New Year's Day; Sarawak doesn't observe Deepavali).
 *   2. "Regional" religious observances — technically federal-pattern holidays (Thaipusam,
 *      Nuzul Al-Quran, Israk & Mikraj, Awal Ramadan, Arafat Day, Good Friday) but only
 *      gazetted by a subset of states — the opposite of the federal exception list, so
 *      they're modelled as opt-in per state instead.
 *   3. Each state/federal territory's own unique observances (a ruler's birthday, an
 *      installation or heritage day, Sarawak's Gawai, Sabah's Kaamatan, etc.).
 * Compiled from publicholidays.com.my, officeholidays.com and (for a couple of recently
 * *changed* dates — Kedah's and Sabah's) NST/Malay Mail news coverage, current as of
 * September 2026. Lunar-calendar 2027 dates are the best available estimates pending final
 * government gazette confirmation. This table only covers what's been researched — assigning
 * a state fills in whichever years are listed here, and the Public holidays panel stays fully
 * editable, so any gap or correction can always be fixed by hand for a specific site.
 */
import type { SiteConfig } from "./types";

export const MALAYSIA_STATES = [
  "Johor", "Kedah", "Kelantan", "Melaka", "Negeri Sembilan", "Pahang", "Penang", "Perak", "Perlis",
  "Sabah", "Sarawak", "Selangor", "Terengganu", "Kuala Lumpur", "Labuan", "Putrajaya",
];

interface FederalHoliday {
  d: string;
  n: string;
  excl?: string[];
}

interface RegionalHoliday {
  d: string;
  states: string[];
}

interface StateOwnHoliday {
  d: string;
  n: string;
}

interface YearHolidayData {
  federal: FederalHoliday[];
  regional: Record<string, RegionalHoliday>;
  stateOwn: Record<string, StateOwnHoliday[]>;
}

export const MALAYSIA_HOLIDAYS_BY_YEAR: Record<number, YearHolidayData> = {
  2026: {
    federal: [
      { d: "2026-01-01", n: "New Year's Day", excl: ["Johor", "Kedah", "Kelantan", "Perlis", "Terengganu"] },
      { d: "2026-02-17", n: "Chinese New Year" },
      { d: "2026-02-18", n: "Chinese New Year Holiday" },
      { d: "2026-03-20", n: "Hari Raya Aidilfitri" },
      { d: "2026-03-21", n: "Hari Raya Aidilfitri Holiday" },
      { d: "2026-05-01", n: "Labour Day" },
      { d: "2026-05-27", n: "Hari Raya Haji" },
      { d: "2026-05-31", n: "Wesak Day" },
      { d: "2026-06-01", n: "Agong's Birthday" },
      { d: "2026-06-17", n: "Awal Muharram" },
      { d: "2026-08-25", n: "Prophet Muhammad's Birthday" },
      { d: "2026-08-31", n: "Merdeka Day" },
      { d: "2026-09-16", n: "Malaysia Day" },
      { d: "2026-11-08", n: "Deepavali", excl: ["Sarawak"] },
      { d: "2026-12-25", n: "Christmas Day" },
    ],
    regional: {
      "Thaipusam": { d: "2026-02-01", states: ["Johor", "Kuala Lumpur", "Putrajaya", "Negeri Sembilan", "Penang", "Perak", "Selangor"] },
      "Nuzul Al-Quran": { d: "2026-03-07", states: ["Kelantan", "Pahang", "Penang", "Perak", "Perlis", "Selangor", "Terengganu", "Kuala Lumpur", "Labuan", "Putrajaya"] },
      "Israk and Mikraj": { d: "2026-01-17", states: ["Kedah", "Perlis", "Terengganu"] },
      "Awal Ramadan": { d: "2026-02-19", states: ["Johor", "Kedah"] },
      "Arafat Day": { d: "2026-05-26", states: ["Kelantan", "Terengganu"] },
      "Good Friday": { d: "2026-04-03", states: ["Sabah", "Sarawak"] },
    },
    stateOwn: {
      "Johor": [{ d: "2026-03-23", n: "Sultan of Johor's Birthday" }, { d: "2026-07-21", n: "Hari Hol Almarhum Sultan Iskandar" }],
      "Kedah": [{ d: "2026-07-05", n: "Sultan of Kedah's Birthday" }],
      "Kelantan": [{ d: "2026-09-29", n: "Sultan of Kelantan's Birthday" }, { d: "2026-09-30", n: "Sultan of Kelantan's Birthday Holiday" }],
      "Melaka": [{ d: "2026-02-20", n: "Independence Declaration Day" }, { d: "2026-08-24", n: "Melaka Governor's Birthday" }],
      "Negeri Sembilan": [{ d: "2026-01-14", n: "YDPB Negeri Sembilan's Birthday" }],
      "Pahang": [{ d: "2026-05-22", n: "Hari Hol Pahang" }, { d: "2026-07-31", n: "Sultan of Pahang's Birthday" }],
      "Penang": [{ d: "2026-07-07", n: "Georgetown World Heritage City Day" }, { d: "2026-07-11", n: "Penang Governor's Birthday" }],
      "Perak": [{ d: "2026-11-06", n: "Sultan of Perak's Birthday" }],
      "Perlis": [{ d: "2026-05-17", n: "Raja of Perlis's Birthday" }],
      "Sabah": [{ d: "2026-03-30", n: "Sabah Governor's Birthday" }, { d: "2026-05-30", n: "Kaamatan (Harvest Festival)" }, { d: "2026-05-31", n: "Kaamatan (Harvest Festival) Holiday" }],
      "Sarawak": [{ d: "2026-06-01", n: "Hari Gawai (Gawai Dayak)" }, { d: "2026-06-02", n: "Hari Gawai (Gawai Dayak) Holiday" }, { d: "2026-07-22", n: "Sarawak Day" }, { d: "2026-10-10", n: "Sarawak Governor's Birthday" }],
      "Selangor": [{ d: "2026-12-11", n: "Sultan of Selangor's Birthday" }],
      "Terengganu": [{ d: "2026-03-04", n: "Installation of Sultan of Terengganu" }, { d: "2026-04-26", n: "Sultan of Terengganu's Birthday" }],
      "Kuala Lumpur": [{ d: "2026-02-01", n: "Federal Territory Day" }],
      "Labuan": [{ d: "2026-02-01", n: "Federal Territory Day" }, { d: "2026-05-30", n: "Kaamatan (Harvest Festival)" }, { d: "2026-05-31", n: "Kaamatan (Harvest Festival) Holiday" }],
      "Putrajaya": [{ d: "2026-02-01", n: "Federal Territory Day" }],
    },
  },
  2027: {
    federal: [
      { d: "2027-01-01", n: "New Year's Day", excl: ["Johor", "Kedah", "Kelantan", "Perlis", "Terengganu"] },
      { d: "2027-02-06", n: "Chinese New Year" },
      { d: "2027-02-07", n: "Chinese New Year Holiday" },
      { d: "2027-03-10", n: "Hari Raya Aidilfitri" },
      { d: "2027-03-11", n: "Hari Raya Aidilfitri Holiday" },
      { d: "2027-05-01", n: "Labour Day" },
      { d: "2027-05-17", n: "Hari Raya Haji" },
      { d: "2027-05-20", n: "Wesak Day" },
      { d: "2027-06-07", n: "Agong's Birthday" },
      { d: "2027-06-06", n: "Awal Muharram" },
      { d: "2027-08-15", n: "Prophet Muhammad's Birthday" },
      { d: "2027-08-31", n: "Merdeka Day" },
      { d: "2027-09-16", n: "Malaysia Day" },
      { d: "2027-10-28", n: "Deepavali", excl: ["Sarawak"] },
      { d: "2027-12-25", n: "Christmas Day" },
    ],
    regional: {
      "Thaipusam": { d: "2027-01-22", states: ["Johor", "Kuala Lumpur", "Putrajaya", "Negeri Sembilan", "Penang", "Perak", "Selangor"] },
      "Nuzul Al-Quran": { d: "2027-02-24", states: ["Kelantan", "Pahang", "Penang", "Perak", "Perlis", "Selangor", "Terengganu", "Kuala Lumpur", "Labuan", "Putrajaya"] },
      "Israk and Mikraj": { d: "2027-01-06", states: ["Kedah", "Perlis", "Terengganu"] },
      "Awal Ramadan": { d: "2027-02-08", states: ["Johor", "Kedah"] },
      "Arafat Day": { d: "2027-05-16", states: ["Kelantan", "Terengganu"] },
      "Good Friday": { d: "2027-03-26", states: ["Sabah", "Sarawak"] },
    },
    stateOwn: {
      "Johor": [{ d: "2027-03-23", n: "Sultan of Johor's Birthday" }, { d: "2027-07-21", n: "Hari Hol Almarhum Sultan Iskandar" }],
      "Kedah": [{ d: "2027-07-05", n: "Sultan of Kedah's Birthday" }],
      "Kelantan": [{ d: "2027-09-29", n: "Sultan of Kelantan's Birthday" }, { d: "2027-09-30", n: "Sultan of Kelantan's Birthday Holiday" }],
      "Melaka": [{ d: "2027-02-20", n: "Independence Declaration Day" }, { d: "2027-08-24", n: "Melaka Governor's Birthday" }],
      "Negeri Sembilan": [{ d: "2027-01-14", n: "YDPB Negeri Sembilan's Birthday" }],
      "Pahang": [{ d: "2027-05-22", n: "Hari Hol Pahang" }, { d: "2027-07-30", n: "Sultan of Pahang's Birthday" }],
      "Penang": [{ d: "2027-07-07", n: "Georgetown World Heritage City Day" }, { d: "2027-07-10", n: "Penang Governor's Birthday" }],
      "Perak": [{ d: "2027-11-05", n: "Sultan of Perak's Birthday" }],
      "Perlis": [{ d: "2027-05-17", n: "Raja of Perlis's Birthday" }],
      "Sabah": [{ d: "2027-03-30", n: "Sabah Governor's Birthday" }, { d: "2027-05-30", n: "Kaamatan (Harvest Festival)" }, { d: "2027-05-31", n: "Kaamatan (Harvest Festival) Holiday" }],
      "Sarawak": [{ d: "2027-06-01", n: "Hari Gawai (Gawai Dayak)" }, { d: "2027-06-02", n: "Hari Gawai (Gawai Dayak) Holiday" }, { d: "2027-07-22", n: "Sarawak Day" }, { d: "2027-10-09", n: "Sarawak Governor's Birthday" }],
      "Selangor": [{ d: "2027-12-11", n: "Sultan of Selangor's Birthday" }],
      "Terengganu": [{ d: "2027-03-04", n: "Installation of Sultan of Terengganu" }, { d: "2027-04-26", n: "Sultan of Terengganu's Birthday" }],
      "Kuala Lumpur": [{ d: "2027-02-01", n: "Federal Territory Day" }],
      "Labuan": [{ d: "2027-02-01", n: "Federal Territory Day" }, { d: "2027-05-30", n: "Kaamatan (Harvest Festival)" }, { d: "2027-05-31", n: "Kaamatan (Harvest Festival) Holiday" }],
      "Putrajaya": [{ d: "2027-02-01", n: "Federal Territory Day" }],
    },
  },
};

/** All {date, name} entries (across every year in the table above) that a given state's
 * calendar contributes — federal (minus that state's exclusions) + its opt-in regional
 * observances + its own uniques. De-duped by date (first name found wins) in case two layers
 * ever land on the same day. */
export function malaysiaHolidayEntriesForState(stateName: string | null): { d: string; n: string }[] {
  if (!stateName) return [];
  const seen = new Map<string, string>();
  const add = (d: string, n: string) => {
    if (!seen.has(d)) seen.set(d, n);
  };
  Object.keys(MALAYSIA_HOLIDAYS_BY_YEAR).forEach((yr) => {
    const data = MALAYSIA_HOLIDAYS_BY_YEAR[Number(yr)];
    data.federal.forEach((h) => {
      if (!h.excl || !h.excl.includes(stateName)) add(h.d, h.n);
    });
    Object.keys(data.regional).forEach((key) => {
      const r = data.regional[key];
      if (r.states.includes(stateName)) add(r.d, key);
    });
    (data.stateOwn[stateName] || []).forEach((h) => add(h.d, h.n));
  });
  return Array.from(seen.entries())
    .map(([d, n]) => ({ d, n }))
    .sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
}

export function configHolidays(cfg: SiteConfig): string[] {
  if (!cfg.publicHolidays) cfg.publicHolidays = [];
  return cfg.publicHolidays;
}

export function configStateHolidayDates(cfg: SiteConfig): string[] {
  if (!cfg.stateHolidayDates) cfg.stateHolidayDates = [];
  return cfg.stateHolidayDates;
}

/** date ("YYYY-MM-DD") -> holiday name, for dates in configHolidays(cfg). Populated
 * automatically for state-calendar dates (see applyStateHolidays); optional for hand-added ones
 * — a date with no entry here just shows a dash in the Public holidays table. */
export function configHolidayNames(cfg: SiteConfig): Record<string, string> {
  if (!cfg.holidayNames) cfg.holidayNames = {};
  return cfg.holidayNames;
}

/** Swaps a site's auto-filled holidays (dates AND names) over to a new state (or clears them if
 * stateName is falsy) without touching any date the user added by hand — see
 * stateHolidayDates on the config, tracked separately from the plain publicHolidays list for
 * exactly this reason. Mutates `cfg` in place, same as the original, and returns the count of
 * auto dates applied. */
export function applyStateHolidays(cfg: SiteConfig, stateName: string | null): number {
  const prevAuto = new Set(configStateHolidayDates(cfg));
  const names = configHolidayNames(cfg);
  const current = configHolidays(cfg).filter((d) => !prevAuto.has(d));
  const nextEntries = malaysiaHolidayEntriesForState(stateName || null);
  const nextAuto = nextEntries.map((e) => e.d);
  const merged = Array.from(new Set([...current, ...nextAuto])).sort();

  // Drop names for old auto dates that aren't sticking around (not re-added, not kept manually).
  prevAuto.forEach((d) => {
    if (!merged.includes(d)) delete names[d];
  });
  // Set/refresh names for the newly-applied auto dates.
  nextEntries.forEach((e) => {
    names[e.d] = e.n;
  });

  cfg.publicHolidays = merged;
  cfg.stateHolidayDates = nextAuto;
  cfg.state = stateName || null;
  return nextAuto.length;
}
