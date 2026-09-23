// Academic year management (Sept–Aug) + system title metadata

import { ref, set, get } from "firebase/database";
import { database } from "./config";

export const getCurrentAcademicYear = (): string => {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1; // 1-12

  // إذا كنا في سبتمبر أو بعده، السنة الأكاديمية = السنة الحالية_السنة القادمة
  // إذا كنا قبل سبتمبر، السنة الأكاديمية = السنة الماضية_السنة الحالية
  if (month >= 9) {
    return `${year}_${year + 1}`;
  } else {
    return `${year - 1}_${year}`;
  }
};

let _cachedAcademicYear: string | null = null;

export const getActiveAcademicYear = async (): Promise<string> => {
  if (_cachedAcademicYear) return _cachedAcademicYear;

  try {
    const snap = await get(ref(database, 'system/metadata/currentAcademicYear'));
    if (snap.exists()) {
      _cachedAcademicYear = snap.val();
      return _cachedAcademicYear!;
    }
  } catch {}

  // إذا ما موجودة، احفظ السنة الحالية
  const current = getCurrentAcademicYear();
  try {
    await set(ref(database, 'system/metadata/currentAcademicYear'), current);
  } catch {}

  _cachedAcademicYear = current;
  return current;
};

export const setActiveAcademicYear = async (year: string): Promise<void> => {
  _cachedAcademicYear = year;
  await set(ref(database, 'system/metadata/currentAcademicYear'), year);
};

const SYSTEM_TITLE_DEFAULT = 'نظام إدارة الحضور الجامعي';

export const loadSystemTitle = async (): Promise<string> => {
  try {
    const snap = await get(ref(database, 'system/metadata/systemTitle'));
    if (snap.exists()) {
      const title = String(snap.val()).trim();
      if (title) return title;
    }
  } catch {}
  return SYSTEM_TITLE_DEFAULT;
};

export const saveSystemTitle = async (title: string): Promise<void> => {
  await set(ref(database, 'system/metadata/systemTitle'), title.trim());
};

/**
 * حساب السنة الأكاديمية القادمة
 * مثال: "2024_2025" → "2025_2026"
 */
export const getNextAcademicYear = (currentYear: string): string => {
  const parts = currentYear.split('_');
  const start = Number(parts[0] ?? 0);
  const end = Number(parts[1] ?? 0);
  return `${start + 1}_${end + 1}`;
};

/**
 * التحقق من صيغة السنة الأكاديمية اليدوية
 * مثال صحيح: "2025_2026"
 */
export const isValidAcademicYearFormat = (year: string): boolean => {
  const match = /^(\d{4})_(\d{4})$/.exec(year.trim());
  if (!match) return false;
  const start = Number(match[1]);
  const end = Number(match[2]);
  return end === start + 1;
};

/** عرض كل السنوات الأكاديمية الموجودة */
export const listAllAcademicYears = async (): Promise<string[]> => {
  try {
    const snap = await get(ref(database, 'academicYears'));
    if (!snap.exists()) return [];
    return Object.keys(snap.val()).sort().reverse();
  } catch {
    return [];
  }
};
