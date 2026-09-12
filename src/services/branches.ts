import { addDoc, collection, deleteDoc, doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import type { Branch, Brand } from '../types';

export async function addBranch(name: string) {
  await addDoc(collection(db, 'branches'), { name: name.trim(), createdAt: Date.now() });
}

export async function removeBranch(id: string) {
  await deleteDoc(doc(db, 'branches', id));
}

export async function addBrand(name: string) {
  await addDoc(collection(db, 'brands'), { name: name.trim(), createdAt: Date.now() });
}

export async function removeBrand(id: string) {
  await deleteDoc(doc(db, 'brands', id));
}

/** Updates a Brand's invoicing/legal details — see Brand's doc comment in types.ts. Patch-only
 *  (Firestore updateDoc merges just the given fields), so saving the invoicing form never
 *  touches `name`/`createdAt` unless explicitly included. */
export async function updateBrand(id: string, patch: Partial<Omit<Brand, 'id' | 'createdAt'>>) {
  await updateDoc(doc(db, 'brands', id), patch);
}

/** Updates a Branch's signatory details — see Branch's doc comment in types.ts. Patch-only, same
 *  reasoning as updateBrand above. */
export async function updateBranch(id: string, patch: Partial<Omit<Branch, 'id' | 'createdAt'>>) {
  await updateDoc(doc(db, 'branches', id), patch);
}
