import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where, type Query } from 'firebase/firestore';
import { db } from '../firebase';
import type { BufferGuard, Guard, UserProfile } from '../types';
import type { SitePickerOption } from '../services/guards';
import { sitesListPlan } from '../utils/firestoreAccess';

/**
 * Subscribes to the whole `guards` collection, unfiltered — Guard Bank splits it into its 4
 * sub-tabs (pool/deployed/dismissed) and computes its stat tiles client-side. Matches this
 * codebase's established pattern of skipping composite indexes in favor of a plain collection
 * listener plus client-side filtering (see useBranches/useBrands) — Guard Bank's total guard
 * count is firm-wide, not large enough to need server-side pagination.
 */
export function useGuards() {
  const [guards, setGuards] = useState<Guard[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'guards'),
      (snap) => {
        setGuards(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Guard, 'id'>) })));
        setLoading(false);
      },
      (err) => {
        console.error('useGuards subscription error', err);
        setLoading(false);
      }
    );
    return unsub;
  }, []);
  return { guards, loading };
}

export function useBufferGuards() {
  const [bufferGuards, setBufferGuards] = useState<BufferGuard[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'bufferGuards'),
      (snap) => {
        setBufferGuards(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<BufferGuard, 'id'>) })));
        setLoading(false);
      },
      (err) => {
        console.error('useBufferGuards subscription error', err);
        setLoading(false);
      }
    );
    return unsub;
  }, []);
  return { bufferGuards, loading };
}

/**
 * A lightweight, read-only feed of sites for the "Assign to site" picker — the same `sites`
 * collection Duty Roster itself uses, picking out just the id/name/branch fields the picker
 * needs and skipping archived sites.
 *
 * Firestore can't partially filter an unconstrained collection query and silently drop the docs
 * a caller isn't allowed to see — it just rejects the whole query — so a non-privileged viewer
 * needs two separate listeners (their own branch, and unassigned sites) merged client-side,
 * matching useSiteList.ts and sitesListPlan(). The previous unfiltered `collection(db, 'sites')`
 * listener worked for admin/HQ (unconditional read) and came back permission-denied for every
 * Branch Manager / Operation Staff account, emptying Guard Bank's "Assign to site" picker.
 */
export function useSitesForPicker(profile: UserProfile | null) {
  const [sites, setSites] = useState<SitePickerOption[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const plan = sitesListPlan(profile);
    if (plan.mode === 'none') {
      setSites([]);
      setLoading(false);
      return;
    }

    const base = collection(db, 'sites');
    const queries: Query[] =
      plan.mode === 'all'
        ? [query(base)]
        : [query(base, where('branch', '==', plan.department)), query(base, where('branch', '==', null))];

    const buckets: SitePickerOption[][] = queries.map(() => []);
    const recompute = () => {
      const seen = new Set<string>();
      const merged: SitePickerOption[] = [];
      buckets.forEach((list) =>
        list.forEach((s) => {
          if (seen.has(s.id)) return;
          seen.add(s.id);
          merged.push(s);
        })
      );
      merged.sort((a, b) => a.name.localeCompare(b.name));
      setSites(merged);
      setLoading(false);
    };

    const unsubs = queries.map((q, i) =>
      onSnapshot(
        q,
        (snap) => {
          buckets[i] = snap.docs
            .map((d) => {
              const data = d.data() as {
                name?: string;
                branch?: string | null;
                tenderId?: string | null;
                archived?: boolean;
              };
              return {
                id: d.id,
                name: data.name || 'Untitled site',
                branch: data.branch ?? null,
                tenderId: data.tenderId ?? null,
                archived: !!data.archived,
              };
            })
            .filter((s) => !s.archived)
            .map(({ id, name, branch, tenderId }) => ({ id, name, branch, tenderId }));
          recompute();
        },
        (err) => {
          console.error('useSitesForPicker subscription error', err);
          buckets[i] = [];
          recompute();
        }
      )
    );
    return () => unsubs.forEach((unsub) => unsub());
  }, [profile?.uid, profile?.role, profile?.department]);
  return { sites, loading };
}
