// Colleges + stages persistence (debounced remote save + localStorage cache)

import { ref, set, get } from "firebase/database";
import { database } from "./config";
import { Stage, College } from "../types/student";
import { getActiveAcademicYear } from "./academicYear";
import { getCollegesPath, getStagesPath } from "./paths";
import { LS, saveLocal, loadLocal, isDangerousEmpty, stripUndefined } from "./localCache";
import { debouncedSave } from "./saveQueue";

export const saveColleges = async (
  adminUid: string,
  colleges: College[],
  forceDelete: boolean = false
): Promise<void> => {
  if (!forceDelete) {
    if (isDangerousEmpty(colleges)) {
      console.warn('🛑 منع حفظ كليات فارغة');
      return;
    }
  }

  saveLocal(LS.colleges(adminUid), colleges);

  const year = await getActiveAcademicYear();
  const saveKey = `colleges_${adminUid}`;

  debouncedSave(saveKey, async () => {
    await set(ref(database, getCollegesPath(year, adminUid)), colleges.map(c => stripUndefined(c as any)));
  });
};

export const loadColleges = async (adminUid: string): Promise<College[]> => {
  const local = loadLocal<College[]>(LS.colleges(adminUid), []);
  try {
    const year = await getActiveAcademicYear();
    const snap = await get(ref(database, getCollegesPath(year, adminUid)));
    if (snap.exists()) {
      const data = snap.val();
      const arr: College[] = Array.isArray(data) ? data : Object.values(data);
      if (arr.length > 0 || local.length === 0) {
        saveLocal(LS.colleges(adminUid), arr);
      }
      return arr;
    }
    return local;
  } catch {
    return local;
  }
};

export const saveStages = async (
  adminUid: string,
  stages: Stage[],
  forceDelete: boolean = false
): Promise<void> => {
  if (!forceDelete) {
    if (isDangerousEmpty(stages)) {
      console.warn('🛑 منع حفظ مراحل فارغة');
      return;
    }
  }

  saveLocal(LS.stages(adminUid), stages);

  const year = await getActiveAcademicYear();
  const saveKey = `stages_${adminUid}`;

  debouncedSave(saveKey, async () => {
    await set(ref(database, getStagesPath(year, adminUid)), stages.map(s => stripUndefined(s as any)));
  });
};

export const loadStages = async (adminUid: string): Promise<Stage[]> => {
  const local = loadLocal<Stage[]>(LS.stages(adminUid), []);
  try {
    const year = await getActiveAcademicYear();
    const snap = await get(ref(database, getStagesPath(year, adminUid)));
    if (snap.exists()) {
      const data = snap.val();
      const arr: Stage[] = Array.isArray(data) ? data : Object.values(data);
      if (arr.length > 0 || local.length === 0) {
        saveLocal(LS.stages(adminUid), arr);
      }
      return arr;
    }
    return local;
  } catch {
    return local;
  }
};
