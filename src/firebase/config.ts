import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getDatabase } from "firebase/database";
import { getStorage } from "firebase/storage";
import { getAnalytics } from "firebase/analytics";

const firebaseConfig = {
  apiKey: "AIzaSyCIrOxhpgn9xRF7tAJZqByvl_8sllSbMck",
  authDomain: "student-system-login-nust-muj.firebaseapp.com",
  databaseURL: "https://student-system-login-nust-muj-default-rtdb.firebaseio.com",
  projectId: "student-system-login-nust-muj",
  storageBucket: "student-system-login-nust-muj.firebasestorage.app",
  messagingSenderId: "698150905447",
  appId: "1:698150905447:web:89345791765760437256c2",
  measurementId: "G-NZNKFS0K7Q"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const database = getDatabase(app);
export const storage = getStorage(app);
export const analytics = getAnalytics(app);

export default app;
