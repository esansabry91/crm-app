import { useEffect, useState } from 'react';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '../firebase';
import type { Branch, Brand } from '../types';

export function useBranches() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const q = query(collection(db, 'branches'), orderBy('name', 'asc'));
    const unsub = onSnapshot(q, (snap) => {
      setBranches(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Branch, 'id'>) })));
      setLoading(false);
    });
    return unsub;
  }, []);
  return { branches, loading };
}

export function useBrands() {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const q = query(collection(db, 'brands'), orderBy('name', 'asc'));
    const unsub = onSnapshot(q, (snap) => {
      setBrands(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Brand, 'id'>) })));
      setLoading(false);
    });
    return unsub;
  }, []);
  return { brands, loading };
}
