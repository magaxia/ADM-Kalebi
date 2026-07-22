import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  connectAuthEmulator,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore,
  connectFirestoreEmulator,
  serverTimestamp,
  Timestamp,
  increment,
  arrayUnion,
  arrayRemove,
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  runTransaction,
  writeBatch,
  query,
  where,
  orderBy,
  limit,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAcVPgUHbL4N9U1-H68klmGKWQF-YGleyc",
  authDomain: "vastbitloud-2872a.firebaseapp.com",
  projectId: "vastbitloud-2872a",
  storageBucket: "vastbitloud-2872a.firebasestorage.app",
  messagingSenderId: "952931184412",
  appId: "1:952931184412:web:ee2a0e38826c30dd0cd4d9",
  measurementId: "G-KWVQ0CFHW2"
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
export const auth = getAuth(app);
export const db = getFirestore(app);

export const fieldValue = {
  serverTimestamp: () => serverTimestamp(),
  increment: (value) => increment(value),
  arrayUnion: (...elements) => arrayUnion(...elements),
  arrayRemove: (...elements) => arrayRemove(...elements)
};

export const timestamp = {
  fromDate: (value) => Timestamp.fromDate(value),
  fromMillis: (value) => Timestamp.fromMillis(value),
  now: () => Timestamp.now()
};

function createCompatDocumentRef(ref) {
  return {
    id: ref.id,
    path: ref.path,
    ref,
    get: () => getDoc(ref).then((snapshot) => ({
      exists: snapshot.exists(),
      id: snapshot.id,
      ref: snapshot.ref,
      data: () => snapshot.data()
    })),
    set: (data, options) => setDoc(ref, data, options),
    update: (data) => updateDoc(ref, data),
    delete: () => deleteDoc(ref)
  };
}

function createCompatCollectionRef(collectionRef, constraints = []) {
  const buildQuery = () => (constraints.length ? query(collectionRef, ...constraints) : collectionRef);

  return {
    where: (field, op, value) => createCompatCollectionRef(collectionRef, [...constraints, where(field, op, value)]),
    orderBy: (field, direction = 'asc') => createCompatCollectionRef(collectionRef, [...constraints, orderBy(field, direction)]),
    limit: (value) => createCompatCollectionRef(collectionRef, [...constraints, limit(value)]),
    doc: (id) => {
      const docRef = typeof id === 'undefined' ? doc(collectionRef) : doc(collectionRef, id);
      return createCompatDocumentRef(docRef);
    },
    add: (data) => addDoc(collectionRef, data),
    get: () => getDocs(buildQuery()).then((snapshot) => ({
      empty: snapshot.empty,
      size: snapshot.size,
      docs: snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        exists: docSnap.exists(),
        ref: docSnap.ref,
        data: () => docSnap.data()
      }))
    })),
    onSnapshot: (next, error) => onSnapshot(buildQuery(), (snapshot) => {
      next({
        empty: snapshot.empty,
        size: snapshot.size,
        docs: snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          exists: docSnap.exists(),
          ref: docSnap.ref,
          data: () => docSnap.data()
        }))
      });
    }, error)
  };
}

function createCompatBatch(batch) {
  return {
    set: (docRef, data, options) => {
      batch.set(docRef, data, options);
      return createCompatBatch(batch);
    },
    update: (docRef, data) => {
      batch.update(docRef, data);
      return createCompatBatch(batch);
    },
    delete: (docRef) => {
      batch.delete(docRef);
      return createCompatBatch(batch);
    },
    commit: () => batch.commit()
  };
}

const firestoreCompatApi = {
  collection: (path) => createCompatCollectionRef(collection(db, path)),
  doc: (path, id) => createCompatDocumentRef(doc(db, path, id)),
  runTransaction: (updateFn) => runTransaction(db, updateFn),
  batch: () => createCompatBatch(writeBatch(db)),
  FieldValue: fieldValue,
  Timestamp: timestamp
};

const authCompatApi = {
  get currentUser() {
    return auth.currentUser;
  },
  onAuthStateChanged: (callback) => onAuthStateChanged(auth, callback),
  signInWithEmailAndPassword: (email, password) => signInWithEmailAndPassword(auth, email, password),
  signOut: () => signOut(auth)
};

const firebaseCompatApi = {
  apps: [app],
  auth: () => authCompatApi,
  firestore: firestoreCompatApi,
  initializeApp: () => app
};

const firebaseModule = {
  app,
  auth,
  db,
  fieldValue,
  timestamp,
  firestoreCompat: firestoreCompatApi,
  firebaseCompatApi
};

if (typeof window !== 'undefined') {
  window.__VIP5_FIREBASE__ = firebaseModule;
  window.firebase = firebaseCompatApi;
  window.firebaseConfig = firebaseConfig;
}

const shouldUseEmulator = typeof window !== 'undefined' && (
  window.__VIP5_USE_FIREBASE_EMULATOR__ === true ||
  window.location.search.includes('emulator=true')
);
if (shouldUseEmulator) {
  try {
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
    connectAuthEmulator(auth, 'http://127.0.0.1:9099');
    console.log("[VIP5] Conectado ao Firebase Emulator local.");
  } catch (err) {
    console.warn("[VIP5] Falha ao conectar ao emulator local:", err);
  }
}

console.log("[VIP5] Firebase inicializado. Projeto:", firebaseConfig.projectId);
