/**
 * Tender-linked guard-rate resolution — ported verbatim from public/duty-roster/index.html
 * lines ~6345-6377 (guardRate/supportGuardRate). The rate config itself is read live off the
 * site's linked tender (Active Project) via a Firestore subscription — never snapshotted onto a
 * guard — so editing a rate in Project Details is reflected here immediately. Porting note: the
 * original read `state.currentTenderRate`; here it's an explicit parameter, supplied by whatever
 * hook holds that live subscription (the React equivalent of subscribeTenderRate()).
 */
import type { Guard, TenderRateConfig } from "./types";

export function guardRate(rateConfig: TenderRateConfig | null, guard: Pick<Guard, "position">): number | null {
  if (!rateConfig) return null;
  if (rateConfig.guardRateMode === "multiple") {
    if (!guard.position) return null;
    const match = (rateConfig.guardRatePositions || []).find((p) => p.name === guard.position);
    return match ? Number(match.rate) || 0 : null;
  }
  if (rateConfig.guardRateMode === "same") {
    return rateConfig.guardRate != null ? Number(rateConfig.guardRate) || 0 : null;
  }
  return null;
}

/** A borrowed-in support guard has no `position` of their own on this site's tender, so they
 * can't be matched against `guardRatePositions` the way guardRate() matches a permanent guard.
 * Their man-hours still belong on this site's invoice, so they always bill at a rate: the flat
 * rate in 'same' mode (identical to everyone else here), or — in 'multiple' mode — the
 * lowest-priced listed position (the plain "normal guard" rate, as opposed to a Leader/
 * Supervisor premium). Returns null — shown as "Not set" — only when there's no rate config, or
 * a 'multiple'-mode config with no positions priced yet. */
export function supportGuardRate(rateConfig: TenderRateConfig | null): number | null {
  if (!rateConfig) return null;
  if (rateConfig.guardRateMode === "same") {
    return rateConfig.guardRate != null ? Number(rateConfig.guardRate) || 0 : null;
  }
  if (rateConfig.guardRateMode === "multiple") {
    const rates = (rateConfig.guardRatePositions || [])
      .map((p) => Number(p.rate))
      .filter((r) => Number.isFinite(r));
    if (!rates.length) return null;
    return Math.min(...rates);
  }
  return null;
}
