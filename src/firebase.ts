import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { config } from "./config";

// With FIRESTORE_EMULATOR_HOST set, the SDK talks to the emulator and needs no credentials.
if (getApps().length === 0) {
  initializeApp(
    config.FIRESTORE_EMULATOR_HOST
      ? { projectId: config.FIREBASE_PROJECT_ID }
      : { projectId: config.FIREBASE_PROJECT_ID, credential: applicationDefault() }
  );
}

export const db = getFirestore();
