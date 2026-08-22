// src/services/tokenService.ts
import { ref, set, get, update } from 'firebase/database';
import { database } from '../firebase/config';
import { nanoid } from 'nanoid';
import { RegistrationLink } from '../types/registration';
import { getActiveAcademicYear } from '../firebase/dataService';

// ============================================================
// 🔑 إدارة روابط التسجيل الذاتي
// ============================================================

const LINKS_PATH = 'registrationSystem/links';
const DEFAULT_EXPIRY_DAYS = 30;

/**
 * 🆕 توليد رابط تسجيل لطالب واحد
 */
export const createSingleRegistrationLink = async (
  adminUid: string,
  stageId: string,
  studentId: string,
  expiryDays: number = DEFAULT_EXPIRY_DAYS
): Promise<{ token: string; url: string }> => {
  const token = nanoid(20);
  const now = Date.now();
  let academicYear = '';
  try { academicYear = await getActiveAcademicYear(); } catch {}
  
  const linkData: RegistrationLink = {
    token,
    adminUid,
    stageId,
    studentId,
    type: 'single',
    createdBy: adminUid,
    createdAt: new Date().toISOString(),
    expiresAt: now + expiryDays * 24 * 60 * 60 * 1000,
    used: false,
    academicYear: academicYear || undefined,
  };
  
  await set(ref(database, `${LINKS_PATH}/${token}`), linkData);
  
  const url = `${window.location.origin}${window.location.pathname}?reg=${token}`;
  return { token, url };
};

/**
 * 🆕 توليد روابط جماعية لقائمة طلاب
 */
export const createBulkRegistrationLinks = async (
  adminUid: string,
  stageId: string,
  studentIds: string[],
  expiryDays: number = DEFAULT_EXPIRY_DAYS
): Promise<Array<{ studentId: string; token: string; url: string }>> => {
  const results: Array<{ studentId: string; token: string; url: string }> = [];
  const now = Date.now();
  const expiresAt = now + expiryDays * 24 * 60 * 60 * 1000;
  let academicYear = '';
  try { academicYear = await getActiveAcademicYear(); } catch {}
  const ay = academicYear || undefined;
  
  const updates: { [key: string]: RegistrationLink } = {};
  
  for (const studentId of studentIds) {
    const token = nanoid(20);
    const linkData: RegistrationLink = {
      token,
      adminUid,
      stageId,
      studentId,
      type: 'single',  // كل واحد رابطه خاص
      createdBy: adminUid,
      createdAt: new Date().toISOString(),
      expiresAt,
      used: false,
      academicYear: ay,
    };
    
    updates[`${LINKS_PATH}/${token}`] = linkData;
    results.push({
      studentId,
      token,
      url: `${window.location.origin}${window.location.pathname}?reg=${token}`,
    });
  }
  
  // حفظ دفعة واحدة
  await update(ref(database), updates);
  
  return results;
};

/**
 * 🆕 توليد رابط حضور واحد للمرحلة (مشترك لكل الطلاب)
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
    studentId: null,  // لا طالب محدد - مشترك
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
 * 🔍 جلب بيانات الرابط بواسطة التوكن
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
 * ✅ تعليم الرابط كمستخدم
 */
export const markLinkAsUsed = async (
  token: string,
  studentId: string
): Promise<void> => {
  try {
    await update(ref(database, `${LINKS_PATH}/${token}`), {
      used: true,
      usedAt: new Date().toISOString(),
      usedByStudentId: studentId,
    });
  } catch (e) {
    console.warn('⚠️ فشل تعليم الرابط:', e);
  }
};

/**
 * 🔄 إعادة تفعيل رابط (في حالة الطالب يريد يعيد التسجيل)
 */
export const reactivateLink = async (token: string): Promise<void> => {
  try {
    await update(ref(database, `${LINKS_PATH}/${token}`), {
      used: false,
      usedAt: null,
      usedByStudentId: null,
    });
  } catch (e) {
    console.warn('⚠️ فشل إعادة تفعيل الرابط:', e);
  }
};

/**
 * 🗑️ حذف رابط
 */
export const deleteRegistrationLink = async (token: string): Promise<void> => {
  try {
    await set(ref(database, `${LINKS_PATH}/${token}`), null);
  } catch (e) {
    console.warn('⚠️ فشل حذف الرابط:', e);
  }
};

/**
 * 📋 جلب كل الروابط لأدمن معين
 */
export const getAdminLinks = async (adminUid: string): Promise<RegistrationLink[]> => {
  try {
    const snap = await get(ref(database, LINKS_PATH));
    if (!snap.exists()) return [];
    
    const allLinks = snap.val();
    const adminLinks: RegistrationLink[] = [];
    
    Object.values(allLinks).forEach((link: any) => {
      if (link.adminUid === adminUid) {
        adminLinks.push(link);
      }
    });
    
    return adminLinks.sort((a, b) => b.expiresAt - a.expiresAt);
  } catch (e) {
    console.error('❌ فشل جلب روابط الأدمن:', e);
    return [];
  }
};

/**
 * 🧹 حذف الروابط المنتهية الصلاحية
 */
export const cleanExpiredLinks = async (adminUid: string): Promise<number> => {
  try {
    const snap = await get(ref(database, LINKS_PATH));
    if (!snap.exists()) return 0;
    
    const now = Date.now();
    const allLinks = snap.val();
    const updates: { [key: string]: null } = {};
    let count = 0;
    
    Object.entries(allLinks).forEach(([token, link]: [string, any]) => {
      if (link.adminUid === adminUid && link.expiresAt < now) {
        updates[`${LINKS_PATH}/${token}`] = null;
        count++;
      }
    });
    
    if (count > 0) {
      await update(ref(database), updates);
    }
    
    return count;
  } catch (e) {
    console.error('❌ فشل تنظيف الروابط:', e);
    return 0;
  }
};

/**
 * ✅ التحقق من صلاحية الرابط
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