// ─────────────────────────────────────────────────────────────
// التحقق من هوية الطالب من **السيرفر مباشرة** قبل أي كتابة حسّاسة
// (تسجيل حضور · فتح تقرير طالب).
//
// لماذا؟
// الكاميرا قد تكون حمّلت قائمة الطلاب قبل دقائق. لو حذف الأدمن طالباً أو غيّر اسمه
// أو رفع بصمته في هذه الأثناء، فالكتابة القديمة تُنتج سجل حضور باسم/بصمة قديمة.
// هنا نُعيد القراءة من القاعدة ونقارن (الرقم + الاسم الكامل) قبل الاعتماد على النتيجة.
// ─────────────────────────────────────────────────────────────
import { ref, get } from 'firebase/database';
import { database } from '../../firebase/config';
import { getActiveAcademicYear } from '../../firebase/dataService';
import { hasValidDescriptor } from './descriptors';
import { normalizeName } from './gallery';

export interface IdentityRecord {
  id: string;
  name: string;
  code?: string;
  group?: string;
  faceDescriptor?: unknown;
  [key: string]: unknown;
}

export type IdentityRejectReason =
  | 'read-error'        // تعذّر الوصول للقاعدة — لا نكتب على أساس بيانات قديمة
  | 'not-found'         // السجل لم يعد موجوداً (حُذف)
  | 'ambiguous-name'    // الرقم مكرّر والاسم لا يطابق أياً منه ⇒ لا نخمّن
  | 'name-mismatch'     // الرقم مكرّر ويطابق أكثر من سجل بنفس الاسم ⇒ استحالة تمييز
  | 'no-descriptor';    // البصمة رُفعت/حُذفت ⇒ لا سجل حضور على أساسها

export interface IdentityResult {
  ok: boolean;
  /** السجل الحيّ المعتمد (اسمه هو الاسم الرسمي الحالي) — `null` عند الرفض */
  record: IdentityRecord | null;
  reason?: IdentityRejectReason;
}

interface CacheEntry {
  at: number;
  records: IdentityRecord[];
}

const CACHE_TTL_MS = 30_000;
const cache = new Map<string, CacheEntry>();

/** معرّف صاحب البيانات (مطابق لصيغة useAuth.getAdminUid) — لتحديد مسار المرحلة الصحيح */
export const resolveDataAdminUid = (
  user: { role?: string | undefined; uid: string; adminId?: string | undefined } | null | undefined,
): string => {
  if (!user) return '';
  return user.role === 'admin' ? user.uid : (user.adminId || user.uid);
};

/**
 * أسباب الرفض التي **تمنع** الكتابة (هوية غير مؤكدة).
 * أما `read-error` (انقطاع شبكة) فلا يمنع الحضور — نُبقي السلوك السابق مع تحذير في الطرفية.
 */
const BLOCKING_REASONS: ReadonlySet<IdentityRejectReason> = new Set<IdentityRejectReason>([
  'not-found',
  'ambiguous-name',
  'name-mismatch',
  'no-descriptor',
]);

export const isIdentityBlock = (reason: IdentityRejectReason | undefined): boolean =>
  !!reason && BLOCKING_REASONS.has(reason);

/** رسالة عربية موجزة لسبب الرفض (تظهر في سجل الماسح) */
export const identityBlockMessage = (reason: IdentityRejectReason | undefined): string => {
  switch (reason) {
    case 'not-found': return 'لا يمكن التسجيل: لم يعد الطالب موجوداً في النظام';
    case 'ambiguous-name': return 'لا يمكن التسجيل: الرقم مكرر في المرحلة ولا يطابق الاسم أياً منهما';
    case 'name-mismatch': return 'لا يمكن التسجيل: رقم مكرر بنفس الاسم في المرحلة — لا يمكن تمييز الطالب';
    case 'no-descriptor': return 'لا يمكن التسجيل: البصمة غير موجودة في النظام';
    default: return 'تعذّر التحقق من بيانات الطالب';
  }
};

/** مسح الكاش (بعد تعديل جماعي على المرحلة مثل الاستيراد أو الحذف) */
export const clearIdentityCache = (adminUid?: string, stageId?: string): void => {
  if (!adminUid || !stageId) { cache.clear(); return; }
  for (const key of [...cache.keys()]) {
    if (key.startsWith(`${adminUid}|${stageId}|`)) cache.delete(key);
  }
};

const stagePath = (year: string, adminUid: string, stageId: string, leaf: string) =>
  `academicYears/${year}/userData/${adminUid}/stageData/${stageId}/${leaf}`;

/** قائمة طلاب المرحلة الطازجة (مع كاش قصير حتى لا تتضاعف القراء في طابور الحضور) */
const fetchStageRecords = async (
  year: string,
  adminUid: string,
  stageId: string,
  ttlMs: number,
): Promise<IdentityRecord[] | null> => {
  const key = `${adminUid}|${stageId}|${year}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.records;

  const snap = await get(ref(database, stagePath(year, adminUid, stageId, 'students')));
  if (!snap.exists()) return [];
  const data = snap.val();
  const arr: unknown[] = Array.isArray(data) ? data : Object.values(data as Record<string, unknown>);
  const records = arr.filter(
    (s): s is IdentityRecord => !!s && typeof s === 'object' && typeof (s as IdentityRecord).id === 'string',
  );
  cache.set(key, { at: Date.now(), records });
  return records;
};

/**
 * تحقّق من هوية الطالب قبل الاعتماد عليها:
 * يقرأ سجلات المرحلة من السيرفر (مع كاش ٣٠ ثانية)، ثم:
 *  - رقم فريد  ⇒ يُرجع السجل الحيّ (الاسم الرسمي الحالي).
 *  - رقم مكرّر ⇒ يجب أن يطابق **الاسم الكامل** واحداً فقط، وإلا يُرفض.
 * كما يتأكد أن البصمة ما زالت موجودة (إلا كان الغرض قراءة اسم فقط).
 */
export const verifyStudentIdentity = async (opts: {
  adminUid: string;
  stageId: string;
  id: string;
  name: string;
  /** اشتراط وجود بصمة صالحة (افتراضياً: نعم) — البصمة في عقدة descriptors/ المنفصلة */
  requireDescriptor?: boolean;
  ttlMs?: number;
}): Promise<IdentityResult> => {
  const { adminUid, stageId, id, name, requireDescriptor = true, ttlMs = CACHE_TTL_MS } = opts;
  if (!id) return { ok: false, record: null, reason: 'not-found' };

  let records: IdentityRecord[] | null;
  let year: string;
  try {
    year = await getActiveAcademicYear();
    records = year ? await fetchStageRecords(year, adminUid, stageId, ttlMs) : null;
  } catch (e) {
    console.warn('[identity] تعذّر قراءة سجلات المرحلة:', e);
    return { ok: false, record: null, reason: 'read-error' };
  }
  if (!year) return { ok: false, record: null, reason: 'read-error' };
  if (records === null) return { ok: false, record: null, reason: 'read-error' };

  const sameId = records.filter(r => r.id === id);
  if (sameId.length === 0) return { ok: false, record: null, reason: 'not-found' };

  let record: IdentityRecord;
  if (sameId.length === 1) {
    record = sameId[0]!;
  } else {
    const target = normalizeName(name);
    const matched = target ? sameId.filter(r => normalizeName(r.name) === target) : [];
    if (matched.length === 0) return { ok: false, record: null, reason: 'ambiguous-name' };
    if (matched.length > 1) return { ok: false, record: null, reason: 'name-mismatch' };
    record = matched[0]!;
  }

  if (requireDescriptor) {
    // ⚠️ البصمة في عقدة منفصلة (descriptors/{id}) لا داخل سجل الطالب
    let descriptor: unknown;
    try {
      const dSnap = await get(ref(database, stagePath(year, adminUid, stageId, `descriptors/${id}`)));
      descriptor = dSnap.exists() ? dSnap.val() : undefined;
    } catch (e) {
      console.warn('[identity] تعذّر قراءة البصمة:', e);
      return { ok: false, record, reason: 'read-error' };
    }
    if (!hasValidDescriptor(descriptor)) {
      return { ok: false, record, reason: 'no-descriptor' };
    }
    record = { ...record, faceDescriptor: descriptor };
  }

  return { ok: true, record };
};
