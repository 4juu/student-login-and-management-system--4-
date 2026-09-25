// src/services/tokenService.ts
import { ref, set, get, update, query, orderByChild, equalTo } from 'firebase/database';
import { database } from '../firebase/config';
import { nanoid } from 'nanoid';
import { RegistrationLink } from '../types/registration';
import { getActiveAcademicYear } from '../firebase/dataService';
import { stripUndefined } from '../lib/sanitize';

// ============================================================
// 🔑 إدارة روابط التسجيل الذاتي
// ============================================================

const LINKS_PATH = 'registrationSystem/links';
const DEFAULT_EXPIRY_DAYS = 30;

/**
 * ⏱️ مزامنة فرق الوقت مع سيرفر Firebase — حتى تكون الصلاحية حقيقية
 * ولا يمكن التحايل عليها بتغيير ساعة الجهاز.
 */
let serverTimeOffset = 0;

export const syncServerTimeOffset = async (): Promise<void> => {
  try {
    const snap = await get(ref(database, '.info/serverTimeOffset'));
    const val = snap.val();
    if (typeof val === 'number') serverTimeOffset = val;
  } catch { /* تجاهل — نرجع لوقت الجهاز كحل احتياطي */ }
};

/** الوقت الحالي حسب سيرفر Firebase */
export const getServerNow = (): number => Date.now() + serverTimeOffset;

/**
 * 🔒 تحقق من أيام الصلاحية: رقم غير صالح (NaN/سالب/أكبر من سنة) → الافتراضي
 * (يمنع expiresAt = NaN الذي يجعل الرابط لا ينتهي أبداً)
 */
const safeExpiryDays = (days: number): number =>
  Number.isFinite(days) && days > 0 ? Math.min(Math.floor(days), 365) : DEFAULT_EXPIRY_DAYS;

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
  await syncServerTimeOffset();
  const now = getServerNow();
  const days = safeExpiryDays(expiryDays);
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
    expiresAt: now + days * 24 * 60 * 60 * 1000,
    used: false,
    academicYear: academicYear || undefined,
  };
  
  await set(ref(database, `${LINKS_PATH}/${token}`), stripUndefined(linkData));
  
  const url = `${window.location.origin}/register.html?reg=${token}`;
  return { token, url };
};

/**
 * 🆕 توليد روابط جماعية لقائمة طلاب — هوية كل طالب مضمّنة داخل رابطه
 */
export const createBulkRegistrationLinks = async (
  adminUid: string,
  stageId: string,
  students: Array<{ id: string; name?: string | undefined; code?: string | undefined; qrCodeId?: string | undefined }>,
  expiryDays: number = DEFAULT_EXPIRY_DAYS,
  linkType: 'single' | 'namecheck' = 'single'
): Promise<Array<{ studentId: string; token: string; url: string }>> => {
  const results: Array<{ studentId: string; token: string; url: string }> = [];
  await syncServerTimeOffset();
  const now = getServerNow();
  const expiresAt = now + safeExpiryDays(expiryDays) * 24 * 60 * 60 * 1000;
  let academicYear = '';
  try { academicYear = await getActiveAcademicYear(); } catch {}
  const ay = academicYear || undefined;

  const updates: { [key: string]: RegistrationLink } = {};

  for (const st of students) {
    const token = nanoid(20);
    const linkData: RegistrationLink = {
      token,
      adminUid,
      stageId,
      studentId: st.id,
      type: linkType,  // 'single' (رفع هوية) أو 'namecheck' (كتابة الاسم)
      createdBy: adminUid,
      createdAt: new Date().toISOString(),
      expiresAt,
      used: false,
      academicYear: ay,

      studentName: st.name || undefined,
      studentCode: st.code || undefined,
      qrCodeId: st.qrCodeId || undefined,
    };

    updates[`${LINKS_PATH}/${token}`] = stripUndefined(linkData);
    results.push({
      studentId: st.id,
      token,
      url: `${window.location.origin}/register.html?reg=${token}`,
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
  await syncServerTimeOffset();
  const now = getServerNow();
  const days = safeExpiryDays(expiryDays);
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
    expiresAt: now + days * 24 * 60 * 60 * 1000,
    used: false,
    academicYear: academicYear || undefined,
    subjectName,
    teacherId: teacherId || undefined,
  };
  
  await set(ref(database, `${LINKS_PATH}/${token}`), stripUndefined(linkData));
  
  const url = `${window.location.origin}/attendance.html?att=${token}`;
  return { token, url };
};
export const getRegistrationLink = async (token: string): Promise<RegistrationLink | null> => {
  try {
    await syncServerTimeOffset();
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
 * 📋 جلب كل الروابط لأدمن معين — استعلام محدود بدل سرد كل الروابط (P6)
 */
export const getAdminLinks = async (adminUid: string): Promise<RegistrationLink[]> => {
  try {
    const snap = await get(query(ref(database, LINKS_PATH), orderByChild('adminUid'), equalTo(adminUid)));
    if (!snap.exists()) return [];

    const adminLinks: RegistrationLink[] = [];
    Object.values(snap.val()).forEach((link: any) => {
      if (link) adminLinks.push(link);
    });

    return adminLinks.sort((a, b) => b.expiresAt - a.expiresAt);
  } catch (e) {
    console.error('❌ فشل جلب روابط الأدمن:', e);
    return [];
  }
};

/**
 * 🧹 حذف الروابط المنتهية الصلاحية — استعلام محدود بروابط الأدمن فقط
 */
export const cleanExpiredLinks = async (adminUid: string): Promise<number> => {
  try {
    const snap = await get(query(ref(database, LINKS_PATH), orderByChild('adminUid'), equalTo(adminUid)));
    if (!snap.exists()) return 0;

    await syncServerTimeOffset();
    const now = getServerNow();
    const allLinks = snap.val();
    const updates: { [key: string]: null } = {};
    let count = 0;

    Object.entries(allLinks).forEach(([token, link]: [string, any]) => {
      if (link && Number.isFinite(link.expiresAt) && link.expiresAt < now) {
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
 * ملاحظة: لا نرفض الرابط إذا كان «مستخدماً» — روابط الطلاب الفردية تبقى مفتوحة
 * لنفس الطالب (بعد موافقة الأدمن أو أثناء التسجيل) بحيث يستطيع العودة لأول خطوة
 * التحقق دائماً، ولا يُحوَّل لصفحة تسجيل الدخول أبداً.
 */
export const validateLink = (link: RegistrationLink | null): {
  valid: boolean;
  reason?: string;
} => {
  if (!link) return { valid: false, reason: 'الرابط غير موجود' };
  if (!Number.isFinite(link.expiresAt)) return { valid: false, reason: 'الرابط غير صالح' };
  // ✅ حسب وقت سيرفر Firebase لا ساعة الجهاز (serverTimeOffset يُزامَن عند دخول الصفحة)
  if (link.expiresAt < getServerNow()) return { valid: false, reason: 'انتهت صلاحية الرابط' };
  return { valid: true };
};

// ============================================================
// 🔍 روابط اختبار البصمة
// ============================================================

export interface TestLinkData {
  token: string;
  adminUid: string;
  stageId: string;
  createdAt: string;
  expiresAt: number;
}

export const DEFAULT_TEST_LINK_MS = 7 * 24 * 60 * 60 * 1000;

/** تنسيق المدة المتبقية بشكل مقروء */
export const formatRemainingMs = (ms: number): string => {
  if (!Number.isFinite(ms) || ms <= 0) return 'منتهي';
  const totalMin = Math.floor(ms / 60000);
  if (totalMin < 60) return `${Math.max(1, totalMin)} دقيقة`;
  const hours = Math.floor(totalMin / 60);
  if (hours < 24) {
    const min = totalMin % 60;
    return min > 0 ? `${hours} ساعة و${min} دقيقة` : `${hours} ساعة`;
  }
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours > 0 ? `${days} يوم و${remHours} ساعة` : `${days} يوم`;
};

/** إنشاء رابط اختبار بصمة لمرحلة واحدة — يُخزّن كـ RegistrationLink بtype: 'test' */
export const createTestLink = async (
  adminUid: string,
  stageId: string,
  expiryMs: number = DEFAULT_TEST_LINK_MS,
): Promise<{ token: string; url: string; expiresAt: number }> => {
  const token = nanoid(20);
  await syncServerTimeOffset();
  const now = getServerNow();
  const safeExpiry = Number.isFinite(expiryMs) && expiryMs > 0 ? expiryMs : DEFAULT_TEST_LINK_MS;
  const expiresAt = now + safeExpiry;
  let academicYear = '';
  try { academicYear = await getActiveAcademicYear(); } catch {}

  const linkData: RegistrationLink = {
    token,
    adminUid,
    stageId,
    type: 'test',
    createdBy: adminUid,
    createdAt: new Date().toISOString(),
    expiresAt,
    used: false,
    academicYear: academicYear || undefined,
  };
  await set(ref(database, `${LINKS_PATH}/${token}`), stripUndefined(linkData));
  const url = `${window.location.origin}/face-test.html?test=${token}`;
  return { token, url, expiresAt };
};

/** قراءة بيانات رابط الاختبار */
export const getTestLink = async (token: string): Promise<TestLinkData | null> => {
  try {
    await syncServerTimeOffset();
    const snap = await get(ref(database, `${LINKS_PATH}/${token}`));
    if (!snap.exists()) return null;
    const data = snap.val() as RegistrationLink;
    if (data.type !== 'test') return null;
    return { token: data.token, adminUid: data.adminUid, stageId: data.stageId, createdAt: data.createdAt, expiresAt: data.expiresAt };
  } catch {
    return null;
  }
};

/** التحقق من صلاحية رابط الاختبار — حسب وقت سيرفر Firebase لا وقت الجهاز */
export const validateTestLink = (link: TestLinkData | null): { valid: boolean; reason?: string } => {
  if (!link) return { valid: false, reason: 'الرابط غير موجود' };
  if (!Number.isFinite(link.expiresAt)) return { valid: false, reason: 'الرابط غير صالح' };
  if (link.expiresAt <= getServerNow()) return { valid: false, reason: 'انتهت صلاحية الرابط' };
  return { valid: true };
};