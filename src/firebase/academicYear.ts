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

/** فهرس السنوات الصغير — قراءة/كتابة رخيصة بدل سرد جذر academicYears الضخم (المحجوب بالقواعد أصلاً) */
const YEARS_INDEX_PATH = 'system/metadata/academicYearsList';

/**
 * تسجيل سنة في الفهرس الصغير (أفضل جهد — الفشل صامت لأن الكتابة للأدمن فقط)
 */
const registerAcademicYear = async (year: string): Promise<void> => {
  if (!year) return;
  try {
    await set(ref(database, `${YEARS_INDEX_PATH}/${year}`), true);
  } catch {}
};

export const getActiveAcademicYear = async (): Promise<string> => {
  if (_cachedAcademicYear) return _cachedAcademicYear;

  try {
    const snap = await get(ref(database, 'system/metadata/currentAcademicYear'));
    if (snap.exists()) {
      _cachedAcademicYear = snap.val();
      void registerAcademicYear(_cachedAcademicYear!);
      return _cachedAcademicYear!;
    }
  } catch {}

  // إذا ما موجودة، احفظ السنة الحالية
  const current = getCurrentAcademicYear();
  void registerAcademicYear(current);
  try {
    await set(ref(database, 'system/metadata/currentAcademicYear'), current);
  } catch {}

  _cachedAcademicYear = current;
  return current;
};

export const setActiveAcademicYear = async (year: string): Promise<void> => {
  _cachedAcademicYear = year;
  await set(ref(database, 'system/metadata/currentAcademicYear'), year);
  await registerAcademicYear(year);
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

/**
 * عرض كل السنوات الأكاديمية الموجودة
 * ✅ يقرأ الفهرس الصغير (system/metadata/academicYearsList) — جولة واحدة صغيرة
 *    بدل جذر academicYears الذي لا يوجد له .read في القواعد (يُرجع [] دائماً)
 *    ويضيف السنة النشطة دائماً حتى تظهر قبل أول تصفير
 */
export const listAllAcademicYears = async (): Promise<string[]> => {
  const years = new Set<string>();

  try {
    const snap = await get(ref(database, YEARS_INDEX_PATH));
    if (snap.exists()) {
      Object.entries(snap.val() as Record<string, unknown>).forEach(([year, present]) => {
        if (present) years.add(year);
      });
    }
  } catch {}

  try {
    years.add(await getActiveAcademicYear());
  } catch {}

  return [...years].sort().reverse();
};
