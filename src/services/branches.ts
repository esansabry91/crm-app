import { addDoc, collection, deleteDoc, doc } from 'firebase/firestore';
import { db } from '../firebase';

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
