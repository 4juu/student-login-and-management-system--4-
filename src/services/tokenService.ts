// src/services/tokenService.ts
import { ref, set, get } from 'firebase/database';
import { database } from '../firebase/config';
import { nanoid } from 'nanoid';
import { RegistrationLink } from '../types/registration';
import { getActiveAcademicYear } from '../firebase/dataService';

const LINKS_PATH = 'registrationSystem/links';
const DEFAULT_EXPIRY_DAYS = 30;

/**
 * توليد رابط حضور واحد للمرحلة (مشترك لكل الطلاب)
 */
export const createAttendanceLink = async (
  adminUid: string,
  stageId: string,
  subjectName: string,
  expiryDays: number = DEFAULT_EXPIRY_DAYS,
  teacherId?: string
): Promise<{ token: string; url: string }> => {
  const token = nanoid(20);
  const now = Date.now();
  let academicYear = '';
  try { academicYear = await getActiveAcademicYear(); } catch {}

  const linkData: RegistrationLink = {
    token,
    adminUid,
    stageId,
    studentId: null,
    type: 'attendance',
    createdBy: adminUid,
    createdAt: new Date().toISOString(),
    expiresAt: now + expiryDays * 24 * 60 * 60 * 1000,
    used: false,
    academicYear: academicYear || undefined,
    subjectName,
    teacherId: teacherId || undefined,
  };

  await set(ref(database, `${LINKS_PATH}/${token}`), linkData);

  const url = `${window.location.origin}${window.location.pathname}?reg=${token}`;
  return { token, url };
};

/**
 * جلب بيانات الرابط بواسطة التوكن
 */
export const getRegistrationLink = async (token: string): Promise<RegistrationLink | null> => {
  try {
    const snap = await get(ref(database, `${LINKS_PATH}/${token}`));
    if (!snap.exists()) return null;
    return snap.val() as RegistrationLink;
  } catch (e) {
    console.error('❌ فشل جلب الرابط:', e);
    return null;
  }
};

/**
 * التحقق من صلاحية الرابط
 */
export const validateLink = (link: RegistrationLink | null): {
  valid: boolean;
  reason?: string;
} => {
  if (!link) return { valid: false, reason: 'الرابط غير موجود' };
  if (link.expiresAt < Date.now()) return { valid: false, reason: 'انتهت صلاحية الرابط' };
  if (link.used) return { valid: false, reason: 'تم استخدام هذا الرابط مسبقاً' };
  return { valid: true };
};
