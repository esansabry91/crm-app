import { useEffect, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import type { BufferGuard, Guard } from '../types';
import type { SitePickerOption } from '../services/guards';

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
 * A lightweight, read-only feed of sites for the "Assign to site" picker — subscribes to the
 * same `sites` collection Duty Roster itself uses (firestore.rules already branch-scopes reads
 * there, so this naturally only shows sites the signed-in user can reach), picking out just the
 * id/name/branch fields the picker needs and skipping archived sites.
 */
export function useSitesForPicker() {
  const [sites, setSites] = useState<SitePickerOption[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'sites'),
      (snap) => {
        const list = snap.docs
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
          .sort((a, b) => a.name.localeCompare(b.name));
        setSites(list.map(({ id, name, branch, tenderId }) => ({ id, name, branch, tenderId })));
        setLoading(false);
      },
      (err) => {
        console.error('useSitesForPicker subscription error', err);
        setLoading(false);
      }
    );
    return unsub;
  }, []);
  return { sites, loading };
}
