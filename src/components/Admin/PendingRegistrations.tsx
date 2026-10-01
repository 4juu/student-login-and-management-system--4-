import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { ref, update, set, get } from 'firebase/database';
import { database } from '../../firebase/config';
import { Student } from '../../types/student';
import { PendingRegistration } from '../../types/registration';
import { getActiveAcademicYear } from '../../firebase/dataService';
import { markLinkAsUsed } from '../../services/tokenService';
import { LoadingState } from '../loading/LoadingState';
import { MorphingSquare } from '../MorphingSquare';
import {
  parseAllSamples,
  checkForTampering,
  migrateToV5,
  descriptorDistance,
  MATCH_STRICT,
} from '../../services/faceAI/descriptors';
import { Camera, Check, CheckCheck, CircleCheck, CircleX, ClipboardList, Mail, QrCode, Save, Smile, Trash2, TriangleAlert } from 'lucide-react';
import { useConfirm } from '../../hooks/useConfirm';
import { useNavStore } from '../../store/navStore';
import { toast } from '@/hooks/use-toast';

interface PendingRegistrationsProps {
  adminUid: string;
  dataAdminUid?: string | undefined;
  onClose: () => void;
}

type FilterStatus = 'all' | 'pending' | 'approved' | 'rejected';

/** حالة نافذة الحفظ المسدودة — لا تختفي إلا بعد استقرار الكتابات في قاعدة البيانات */
interface SavingState {
  title: string;
  detail: string;
  current?: number;
  total?: number;
  attempt?: number;
}

/** فشل دائم (فشل تحقق منطقي/بصمة تالفة) — لا جدوى من إعادة المحاولة */
class PermanentError extends Error {}

/** مهلة لكل محاولة — بدونها تكتب Firebase تعلّق للأبد عند انقطاع الاتصال (وتنحبس نافذة الحفظ) */
const ATTEMPT_TIMEOUT_MS = 20000;

const withTimeout = (work: Promise<void>): Promise<void> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('انتهت مهلة الاتصال بقاعدة البيانات (20 ثانية) — تحقق من الإنترنت')),
      ATTEMPT_TIMEOUT_MS,
    );
    work.then(
      () => { clearTimeout(timer); resolve(); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });

/** إعادة محاولة تلقائية للعمليات القابلة للفشل (شبكة/قاعدة) — الفشل الدائم يُرمي فوراً */
const withRetry = async (
  fn: () => Promise<void>,
  attempts = 3,
  onAttempt?: (next: number) => void,
): Promise<void> => {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await withTimeout(fn());
      return;
    } catch (e) {
      if (e instanceof PermanentError || attempt === attempts) throw e;
      onAttempt?.(attempt + 1);
      await new Promise(resolve => setTimeout(resolve, 500 * attempt));
    }
  }
};

export const PendingRegistrations: React.FC<PendingRegistrationsProps> = ({
  adminUid,
  dataAdminUid,
  onClose,
}) => {
  // استماع واحد فقط في useNavigation — النافذة تقرأ من المتجر (لا اشتراك مكرر على نفس المسار)
  const [requests] = [useNavStore((s) => s.pendingRequests)];
  const [filter, setFilter] = useState<FilterStatus>('pending');
  const [processing, setProcessing] = useState<ReadonlySet<string>>(() => new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [purging, setPurging] = useState(false);
  const { confirm: confirmAction, ConfirmDialog: ConfirmDialogEl } = useConfirm();
  const loading = false;
  const [saving, setSaving] = useState<SavingState | null>(null);
  // حارس متزامن: يمنع بدء عملية موافقة ثانية قبل انتهاء الحالية حتى لو وقع النقر في نفس اللحظة
  const busyRef = useRef(false);

  /** حالة كل طلب مستقلة — لا يضيع مؤشر «جاري...» لطلب كان يُكتب بعدما يبدأ طلب آخر */
  const startProcessing = (id: string) => setProcessing(prev => { const next = new Set(prev); next.add(id); return next; });
  const stopProcessing = (id: string) => setProcessing(prev => { const next = new Set(prev); next.delete(id); return next; });
  const clearProcessing = () => setProcessing(new Set());

  // أثناء الحفظ: تحذير المتصفح قبل إغلاق التبويب/إعادة تحميل الصفحة
  useEffect(() => {
    if (!saving) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [saving]);

  /** إغلاق النافذة فقط بعد اكتمال الحفظ */
  const safeClose = () => {
    if (saving) return;
    onClose();
  };

  useBodyScrollLock(true);

  const filteredRequests = useMemo(() => {
    return requests.filter(r => {
      if (filter !== 'all' && r.status !== filter) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          r.nameInSystem.toLowerCase().includes(q) ||
          r.studentCode.toLowerCase().includes(q) ||
          (r.nationalId && r.nationalId.toLowerCase().includes(q))
        );
      }

      return true;
    });
  }, [requests, filter, searchQuery]);

  /** كتابة الموافقة والبصمة كاملة — العمليات كلها idempotent فيُعاد تشغيلها بأمان عند إعادة المحاولة */
  const approveRequest = async (
    req: PendingRegistration,
    onProgress?: (msg: string) => void,
  ): Promise<void> => {
    const year = await getActiveAcademicYear();
    const storageUid = dataAdminUid || adminUid;
    if (!req.studentId) {
      throw new PermanentError('بيانات الطالب ناقصة (studentId)');
    }

    const basePath = `academicYears/${year}/userData/${storageUid}/stageData/${req.stageId}/students`;
    const descriptorsPath = `academicYears/${year}/userData/${storageUid}/stageData/${req.stageId}/descriptors`;

    onProgress?.('قراءة بيانات الطالب...');
    // ── 1) Find the student's key first (array index or object key)
    const [snap, descSnap] = await Promise.all([
      get(ref(database, basePath)),
      get(ref(database, descriptorsPath)),
    ]);
    if (!snap.exists()) {
      throw new PermanentError('لم نجد بيانات الطلاب');
    }

    const data = snap.val();
    const descriptors = descSnap.exists() ? (descSnap.val() as Record<string, unknown>) : null;
    let studentKey: string | number | null = null;
    let studentData: Student | null = null;

    if (Array.isArray(data)) {
      const idx = data.findIndex(s => s && s.id === req.studentId);
      if (idx !== -1) {
        studentKey = idx;
        studentData = data[idx];
      }
    } else if (data && typeof data === 'object') {
      for (const [key, val] of Object.entries(data)) {
        if (val && typeof val === 'object' && (val as Student).id === req.studentId) {
          studentKey = key;
          studentData = val as Student;
          break;
        }
      }
    }

    if (studentKey === null || !studentData) {
      throw new PermanentError(`لم نجد الطالب بالمعرف: ${req.studentId}`);
    }

    // ── 2) Validate + migrate the face descriptor (if provided)
    // نوحّد أي صيغة بصمة إلى v5 نظيفة — نقبل البصمة الجديدة مهما كانت صيغتها المخزّنة
    let finalDescriptor = req.faceDescriptor;

    if (req.faceDescriptor) {
      const migrated = migrateToV5(req.faceDescriptor);
      if (!migrated) {
        throw new PermanentError('البصمة المرفقة فارغة أو تالفة. اطلب من الطالب إعادة التسجيل.');
      }

      // ✅ فحص التعارض على **كل** عيّنات البصمة (لا أول عينة فقط — عينة الزاوية الضعيفة قد تُطابق غيرها)
      const newSamples = parseAllSamples(migrated);
      if (newSamples.length === 0) {
        throw new PermanentError('البصمة المرفقة فارغة أو تالفة. اطلب من الطالب إعادة التسجيل.');
      }
      const allStudents: Student[] = (Array.isArray(data) ? data : Object.values(data)).map(s => {
        const d = descriptors?.[s.id];
        return d !== undefined && d !== null ? { ...s, faceDescriptor: d } : s;
      });
      for (const sample of newSamples) {
        const tamper = checkForTampering(sample, allStudents, req.studentId);
        if (tamper.tampered) {
          throw new PermanentError(`لا يمكن الموافقة: هذه البصمة مطابقة لبصمة الطالب\n${tamper.matchedWith}\n\nيرجى التحقق من صالة الطلب.`);
        }
      }
      finalDescriptor = migrated;
    }

    // ── 3) Update ONLY this student using update() — avoids rewriting whole array
    // faceDescriptor يُكتب في العقدة المنفصلة descriptors/ (بلا مساس بمصفوفة students)
    onProgress?.('حفظ بصمة الوجه...');
    const studentRef = ref(database, `${basePath}/${studentKey}`);
    // ⚠️ لا نكتب تاريخ «تسجيل البصمة» ولا نمسح رمز QR إلا عند وجود بصمة/قيمة فعلية
    const studentPatch: Record<string, unknown> = {};
    if (typeof req.qrCodeId === 'string' && req.qrCodeId.trim() !== '') {
      studentPatch.qrCodeId = req.qrCodeId;
    }
    if (finalDescriptor !== undefined) {
      studentPatch.faceRegisteredAt = new Date().toISOString();
    }
    if (Object.keys(studentPatch).length > 0) {
      await update(studentRef, studentPatch);
    }
    if (finalDescriptor !== undefined) {
      await set(ref(database, `${descriptorsPath}/${req.studentId}`), finalDescriptor);
    }

    // ── 4) Update pending request status + إزالة قيد فهرس البصمة المعلقة
    onProgress?.('تحديث حالة الطلب...');
    await update(ref(database), {
      [`registrationSystem/pending/${adminUid}/${req.id}`]: {
        status: 'approved',
        reviewedAt: new Date().toISOString(),
        reviewedBy: adminUid,
      },
      ...(req.stageId
        ? { [`registrationSystem/pendingFaceIndex/${adminUid}/${req.stageId}/${req.id}`]: null }
        : {}),
    });

    // ── 5) تعليم الرابط المخصص لطالب واحد «مستخدماً» بعد الموافقة فقط
    if (req.linkType === 'single' && req.linkToken) {
      await markLinkAsUsed(req.linkToken, req.studentId).catch(() => {});
    }
  };

  /**
   * ✅ حارس قبل الموافقة:
   *  - يمنع الموافقة إذا كان للطالب **طلب آخر قيد المراجعة** (يكتب الأخير بصمت).
   *  - التحذيرات (عدم تطابق الوجه مع البصمة القديمة / فشل الفحص / استبدال بصمة)
   *    تتحوّل إلى سؤال صريح «موافقة استثنائية» — القرار للأدمن.
   */
  const guardBeforeApprove = async (req: PendingRegistration): Promise<boolean> => {
    const counts = perStudentCount.get(req.studentId);
    if (counts && counts.pending > 1) {
      toast({
        variant: 'destructive',
        title: 'يوجد طلب آخر قيد المراجعة لنفس الطالب',
        description: `${req.nameInSystem}: وافق على طلب واحد فقط لهذا الطالب — الموافقة على الاثنين تجعل آخرهما يكتب بصمت.`,
      });
      return false;
    }

    // ⚠️ اكتشاف تعارض البصمة مع الطلبات المعلقة الأخرى (طلاب مختلفون)
    if (req.faceDescriptor && req.faceDescriptor !== undefined) {
      const currentSamples = parseAllSamples(req.faceDescriptor);
      if (currentSamples.length > 0) {
        for (const otherReq of requests) {
          if (otherReq.id === req.id || otherReq.status !== 'pending') continue;
          const otherDescriptor = otherReq.faceDescriptor;
          if (otherDescriptor && typeof otherDescriptor === 'object') {
            const otherSamples = parseAllSamples(otherDescriptor);
            if (otherSamples.length === 0) continue;
            // تحقق من تشابه كل عينات
            for (const sample of currentSamples) {
              for (const otherSample of otherSamples) {
                const distance = descriptorDistance(sample, otherSample);
                if (distance < MATCH_STRICT) {
                  toast({
                    variant: 'destructive',
                    title: 'تعارض في البصمات — تم رفض الموافقة',
                    description: `البصمة ${req.nameInSystem} قريبة جداً (${distance.toFixed(3)}) من ${otherReq.nameInSystem} — إما رفض هذا أو انتظر`,
                  });
                  return false;
                }
              }
            }
          }
        }
      }
    }

    const notes: string[] = [];
    if (req.selfMismatch) notes.push('الوجه الجديد لا يطابق بصمة الطالب المسجّلة سابقاً');
    if (req.checksFailed) notes.push('فحص تكرار البصمة لم يكتمل قبل الإرسال');
    if (req.hasExistingFace) notes.push('سيتم استبدال بصمة موجودة');
    if (notes.length === 0) return true;

    return confirmAction({
      title: 'تأكيد موافقة استثنائية',
      message: `${req.nameInSystem}: ${notes.join(' · ')}. هل توافق رغم ذلك؟`,
      confirmLabel: 'موافقة استثنائية',
    });
  };

  const handleApprove = async (req: PendingRegistration) => {
    if (busyRef.current) return;
    if (!(await guardBeforeApprove(req))) return;
    busyRef.current = true;
    startProcessing(req.id);
    setSaving({ title: 'جاري حفظ بصمة الطالب', detail: `${req.nameInSystem} — لا تغلق النافذة قبل اكتمال الحفظ` });

    try {
      await withRetry(
        () => approveRequest(req, msg => setSaving(prev => (prev ? { ...prev, detail: `${req.nameInSystem} — ${msg}` } : prev))),
        3,
        next => setSaving(prev => (prev ? { ...prev, detail: `تعذّر الوصول لقاعدة البيانات — إعادة المحاولة (${next} من 3)`, attempt: next } : prev)),
      );
      toast({ title: 'تم حفظ البصمة بنجاح ✅', description: `${req.nameInSystem} — سُجلت الموافقة والبصمة في قاعدة البيانات.` });
    } catch (e) {
      console.error('❌ خطأ في الموافقة:', e);
      toast({ variant: 'destructive', title: 'فشلت عملية الحفظ بعد إعادة المحاولة', description: e instanceof Error ? e.message : 'خطأ غير معروف' });
    } finally {
      setSaving(null);
      stopProcessing(req.id);
      busyRef.current = false;
    }
  };

  /** الموافقة على كل الطلبات «قيد المراجعة» دفعة واحدة مع شريط تقدّم وإعادة محاولة تلقائية */
  const handleApproveAll = async () => {
    if (busyRef.current) return;
    const pendingList = requests.filter(r => r.status === 'pending');
    if (pendingList.length === 0) return;

    const ok = await confirmAction({
      title: 'الموافقة على كل البصمات',
      message: `سيتم حفظ بصمات ${pendingList.length} طالباً دفعة واحدة، ولا تُغلق النافذة حتى تكتمل العملية. متابعة؟`,
      confirmLabel: 'موافقة الكل',
    });
    if (!ok) return;

    busyRef.current = true;
    const total = pendingList.length;
    const failures: { name: string; msg: string }[] = [];
    setSaving({ title: 'جاري حفظ كل البصمات', detail: 'البدء...', current: 0, total });

    try {
      for (const [i, req] of pendingList.entries()) {
        startProcessing(req.id);
        setSaving({ title: 'جاري حفظ كل البصمات', detail: `${req.nameInSystem}`, current: i + 1, total });
        // ✅ الموافقة الجماعية تتخطى الطلبات التي تحتاج قراراً منفرداً (مكرّرة أو بها تحذيرات)
        const counts = perStudentCount.get(req.studentId);
        if (counts && counts.pending > 1) {
          failures.push({ name: req.nameInSystem, msg: 'يوجد طلب آخر لنفس الطالب — راجع الطلبات يدوياً' });
          continue;
        }
        if (req.selfMismatch || req.checksFailed) {
          const why = req.selfMismatch ? 'الوجه لا يطابق بصمته المسجّلة' : 'فحص التكرار لم يكتمل';
          failures.push({ name: req.nameInSystem, msg: `${why} — يحتاج موافقة فردية` });
          continue;
        }
        try {
          await withRetry(
            () => approveRequest(req, msg => setSaving(prev => (prev ? { ...prev, detail: `${req.nameInSystem} — ${msg}` } : prev))),
            3,
            next => setSaving(prev => (prev ? { ...prev, detail: `${req.nameInSystem} — إعادة المحاولة (${next} من 3)` } : prev)),
          );
        } catch (e) {
          failures.push({ name: req.nameInSystem, msg: e instanceof Error ? e.message : 'خطأ غير معروف' });
        }
      }
    } finally {
      clearProcessing();
      setSaving(null);
      busyRef.current = false;
    }

    const saved = total - failures.length;
    if (failures.length === 0) {
      toast({ title: `تم حفظ ${saved} بصمة ✅`, description: 'كل الطلبات المعلقة محفوظة في قاعدة البيانات.' });
    } else {
      toast({
        variant: 'destructive',
        title: `تم حفظ ${saved} — وفشل ${failures.length} بعد إعادة المحاولة`,
        description: failures.slice(0, 5).map(f => `${f.name}: ${f.msg}`).join('\n') + (failures.length > 5 ? `\n+${failures.length - 5} طلبات أخرى` : ''),
      });
    }
  };

  const handleReject = async (req: PendingRegistration, reason: string) => {
    startProcessing(req.id);

    try {
      await withTimeout(update(ref(database), {
        [`registrationSystem/pending/${adminUid}/${req.id}`]: {
          status: 'rejected',
          rejectionReason: reason || 'بدون سبب محدد',
          reviewedAt: new Date().toISOString(),
          reviewedBy: adminUid,
        },
        ...(req.stageId
          ? { [`registrationSystem/pendingFaceIndex/${adminUid}/${req.stageId}/${req.id}`]: null }
          : {}),
      }));

      setRejectingId(null);
      setRejectReason('');
    } catch (e: any) {
      console.error(e);
      toast({ variant: 'destructive', title: 'فشلت العملية' });
    } finally {
      stopProcessing(req.id);
    }
  };

  const handleDelete = async (req: PendingRegistration) => {
    try {
      await update(ref(database), {
        [`registrationSystem/pending/${adminUid}/${req.id}`]: null,
        ...(req.stageId
          ? { [`registrationSystem/pendingFaceIndex/${adminUid}/${req.stageId}/${req.id}`]: null }
          : {}),
      });
    } catch (e) {
      console.error(e);
      toast({ variant: 'destructive', title: 'فشل الحذف' });
    }
  };

  // حذف كل الطلبات التي بصمتها تالفة/فارغة (أُنشئت قبل تفعيل التحقق الصارم) — لا يمكن الموافقة عليها أبداً
  const handlePurgeCorrupt = async () => {
    const corrupt = requests.filter(r => r.faceDescriptor && migrateToV5(r.faceDescriptor) === null);
    if (corrupt.length === 0) {
      toast({ title: 'لا توجد طلبات تالفة — كل البصمات سليمة ✅' });
      return;
    }
    const ok = await confirmAction({
      title: 'حذف الطلبات التالفة',
      message: `سيتم حذف ${corrupt.length} طلباً تالفاً نهائياً. على الطلاب المتأثرين إعادة التسجيل من رابطهم. متابعة؟`,
      confirmLabel: 'حذف',
    });
    if (!ok) return;

    setPurging(true);
    try {
      const updates: { [key: string]: null } = {};
      for (const r of corrupt) {
        updates[`registrationSystem/pending/${adminUid}/${r.id}`] = null;
        if (r.stageId) {
          updates[`registrationSystem/pendingFaceIndex/${adminUid}/${r.stageId}/${r.id}`] = null;
        }
      }
      await update(ref(database), updates);
      toast({ title: `تم حذف ${corrupt.length} طلباً تالفاً.` });
    } catch (e) {
      console.error(e);
      toast({ variant: 'destructive', title: 'فشل حذف الطلبات التالفة' });
    } finally {
      setPurging(false);
    }
  };

  const stats = useMemo(() => ({
    total: requests.length,
    pending: requests.filter(r => r.status === 'pending').length,
    approved: requests.filter(r => r.status === 'approved').length,
    rejected: requests.filter(r => r.status === 'rejected').length,
  }), [requests]);

  /**
   * ⚠️ عدّاد الطلبات لكل طالب (منها قيد المراجعة) — يمنع الموافقة على أكثر من طلب
   * لنفس الطالب (الذي يكتب أخيراً هو الفائز بصمت).
   */
  const perStudentCount = useMemo(() => {
    const map = new Map<string, { total: number; pending: number }>();
    for (const r of requests) {
      if (!r.studentId) continue;
      const cur = map.get(r.studentId) ?? { total: 0, pending: 0 };
      cur.total += 1;
      if (r.status === 'pending') cur.pending += 1;
      map.set(r.studentId, cur);
    }
    return map;
  }, [requests]);

  return (
    <div className="fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center p-4 animate-fadeIn" dir="rtl">
{ConfirmDialogEl}

      {/* نافذة حفظ مسدودة — لا زر إغلاق ولا خلفية تنضغط، تختفي فقط بعد استقرار الكتابات */}
      {saving && (
        <div
          className="fixed inset-0 z-[10001] bg-black/85 backdrop-blur-sm flex items-center justify-center p-4 animate-fadeIn"
          role="alertdialog"
          aria-modal="true"
          aria-live="assertive"
        >
          <div className="bg-slate-900 border border-white/15 rounded-2xl shadow-2xl w-full max-w-sm p-7 text-center">
            <MorphingSquare size="lg" />
            <h3 className="text-lg font-extrabold text-white mt-4">{saving.title}</h3>
            <p className="text-sm text-slate-300 mt-2 leading-relaxed break-words">{saving.detail}</p>

            {typeof saving.attempt === 'number' && (
              <p className="text-xs font-bold text-amber-300 mt-3">
                <TriangleAlert className="w-3.5 h-3.5 inline ml-1" />
                محاولة {saving.attempt} من 3 — سيتم إعادة المحاولة تلقائياً
              </p>
            )}

            {typeof saving.total === 'number' && saving.total > 0 ? (
              <div className="mt-5">
                <div
                  className="h-2.5 w-full rounded-full bg-white/10 overflow-hidden"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={saving.total}
                  aria-valuenow={saving.current ?? 0}
                >
                  <div
                    className="h-full rounded-full bg-emerald-500 transition-all duration-500"
                    style={{ width: `${Math.min(100, Math.round(((saving.current ?? 0) / saving.total) * 100))}%` }}
                  />
                </div>
                <p className="text-xs text-slate-400 mt-2 font-bold">
                  {saving.current} / {saving.total} طالب
                </p>
              </div>
            ) : (
              <p className="text-[11px] text-slate-500 mt-5">
                لن تُغلق هذه النافذة قبل اكتمال الحفظ في قاعدة البيانات
              </p>
            )}
          </div>
        </div>
      )}

<div className="bg-slate-900 border border-white/10 text-white rounded-2xl shadow-2xl max-w-5xl w-full max-h-[95vh] flex flex-col animate-modalUp">

        <div className="p-5 border-b border-white/10 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <ClipboardList className="w-6 h-6 text-indigo-400" /> طلبات التسجيل الذاتي
              {stats.pending > 0 && (
                <span className="bg-red-500 text-white text-sm px-2.5 py-0.5 rounded-full animate-pulse">
                  {stats.pending}
                </span>
              )}
            </h2>
            <p className="text-sm text-slate-400">مراجعة طلبات الطلاب الذاتية</p>
          </div>
          <div className="flex items-center gap-2">
            {stats.pending > 0 && (
              <button
                onClick={handleApproveAll}
                disabled={!!saving || purging}
                title="الموافقة على كل الطلبات قيد المراجعة وحفظ بصماتها دفعة واحدة"
                className="flex items-center gap-1.5 bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-emerald-300 px-3 py-2 rounded-lg font-bold text-sm transition disabled:opacity-50"
              >
                <CheckCheck className="w-4 h-4" />
                موافقة الكل
              </button>
            )}
            <button
              onClick={handlePurgeCorrupt}
              disabled={purging}
              title="حذف الطلبات التي بصمتها تالفة ولا يمكن الموافقة عليها"
              className="flex items-center gap-1.5 bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-amber-300 px-3 py-2 rounded-lg font-bold text-sm transition disabled:opacity-50"
            >
              {purging ? <MorphingSquare size="xs" /> : <Trash2 className="w-4 h-4" />}
              حذف التالفة
            </button>
            <button
              onClick={safeClose}
              disabled={!!saving}
              title={saving ? 'جاري الحفظ — لا يمكن الإغلاق الآن' : 'إغلاق'}
              className="bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg font-bold transition"
            >
              ✕ إغلاق
            </button>
          </div>
        </div>

        <div className="px-5 py-3 border-b border-white/10 bg-white/5">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <button
              onClick={() => setFilter('all')}
              className={`p-2 rounded-lg text-center transition ${
                filter === 'all' ? 'bg-blue-500/15 border-2 border-blue-500/50' : 'bg-white/5 border border-white/10'
              }`}
            >
              <div className="text-lg font-bold text-white">{stats.total}</div>
              <div className="text-[10px] text-slate-400">الإجمالي</div>
            </button>
            <button
              onClick={() => setFilter('pending')}
              className={`p-2 rounded-lg text-center transition ${
                filter === 'pending' ? 'bg-amber-500/15 border-2 border-amber-500/50' : 'bg-white/5 border border-white/10'
              }`}
            >
              <div className="text-lg font-bold text-amber-300">{stats.pending}</div>
              <div className="text-[10px] text-amber-400">قيد المراجعة</div>
            </button>
            <button
              onClick={() => setFilter('approved')}
              className={`p-2 rounded-lg text-center transition ${
                filter === 'approved' ? 'bg-emerald-500/15 border-2 border-emerald-500/50' : 'bg-white/5 border border-white/10'
              }`}
            >
              <div className="text-lg font-bold text-emerald-300">{stats.approved}</div>
              <div className="text-[10px] text-emerald-400">موافق عليها</div>
            </button>
            <button
              onClick={() => setFilter('rejected')}
              className={`p-2 rounded-lg text-center transition ${
                filter === 'rejected' ? 'bg-red-500/15 border-2 border-red-500/50' : 'bg-white/5 border border-white/10'
              }`}
            >
              <div className="text-lg font-bold text-red-300">{stats.rejected}</div>
              <div className="text-[10px] text-red-400">مرفوضة</div>
            </button>
          </div>
        </div>

        <div className="px-5 py-3 border-b border-white/10">
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="بحث بالاسم أو الكود أو رقم الهوية..."
            className="w-full px-3 py-2 border border-slate-600 bg-slate-800 text-white placeholder:text-slate-500 rounded-lg text-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30"
          />
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {loading ? (
            <div className="p-4">
              <LoadingState size="sm" className="py-6" />
            </div>
          ) : filteredRequests.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <div className="mx-auto w-14 h-14 rounded-full bg-slate-500/10 border border-slate-500/30 flex items-center justify-center mb-4"><Mail className="w-7 h-7 text-slate-400" /></div>
              <p className="font-medium">
                {filter === 'pending' ? 'لا توجد طلبات قيد المراجعة' : 'لا توجد طلبات'}
              </p>
            </div>
          ) : (
            filteredRequests.map(req => {
              const isProcessing = processing.has(req.id);
              const isPending = req.status === 'pending';
              const isApproved = req.status === 'approved';
              const isRejected = req.status === 'rejected';
              const isRejecting = rejectingId === req.id;
              const siblingCount = perStudentCount.get(req.studentId)?.total ?? 0;

              return (
                <div
                  key={req.id}
                  className={`border-2 rounded-xl p-4 transition ${
                    isPending ? 'border-amber-500/40 bg-amber-500/10' :
                    isApproved ? 'border-emerald-500/40 bg-emerald-500/10' :
                    'border-red-500/40 bg-red-500/10'
                  }`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-bold px-2 py-1 rounded-full flex items-center gap-1 ${
                        isPending ? 'bg-amber-500/20 text-amber-300' :
                        isApproved ? 'bg-emerald-500/20 text-emerald-300' :
                        'bg-red-500/20 text-red-300'
                      }`}>
                        {isPending ? <><MorphingSquare size="xs" /> قيد المراجعة</> :
                         isApproved ? <><CircleCheck className="w-3 h-3" /> تمت الموافقة</> :
                         <><CircleX className="w-3 h-3" /> مرفوض</>}
                      </span>
                      <span className="text-xs text-slate-400">
                        {new Date(req.createdAt).toLocaleString('ar-EG')}
                      </span>
                    </div>

                    <div className={`text-xs font-bold px-3 py-1 rounded-full ${
                      req.qrVerified ? 'bg-emerald-500 text-white' : 'bg-amber-500 text-white'
                    }`}>
                      {req.qrVerified ? '✅ QR متحقق' : '⚠️ بدون QR'}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                    <div className="bg-slate-800 rounded-lg p-3 border border-blue-500/30">
                      <p className="text-xs text-blue-400 font-bold mb-1 flex items-center gap-1"><Save className="w-3.5 h-3.5" /> من النظام:</p>
                      <p className="font-bold text-blue-200 text-sm">{req.nameInSystem}</p>
                      <p className="text-[10px] text-blue-400 mt-0.5">الرمز: {req.studentCode}</p>
                    </div>
                    <div className="bg-slate-800 rounded-lg p-3 border border-purple-500/30">
                      <p className="text-xs text-purple-400 font-bold mb-1 flex items-center gap-1"><Camera className="w-3.5 h-3.5" /> من البطاقة:</p>
                      <p className="font-bold text-purple-200 text-sm">{req.nameFromCard || '—'}</p>
                      {req.nationalId && (
                        <p className="text-[10px] text-purple-400 mt-0.5">هوية: {req.nationalId}</p>
                      )}
                      {req.qrCodeId && (
                        <p className="text-[10px] text-purple-400 mt-0.5">QR: {req.qrCodeId.slice(0, 20)}...</p>
                      )}
                    </div>
                  </div>

                  <div className="flex gap-2 flex-wrap mb-3">
                    <span className={`text-[10px] border rounded-full px-2 py-1 flex items-center gap-1 ${
                      req.qrVerified
                        ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                        : 'bg-slate-800 border-slate-600'
                    }`}>
                      <QrCode className="w-3 h-3" /> {req.qrVerified ? 'QR متحقق' : 'QR غير متحقق'}
                    </span>
                    <span className={`text-[10px] border rounded-full px-2 py-1 flex items-center gap-1 ${
                      req.nameMatched
                        ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                        : 'bg-slate-800 border-slate-600'
                    }`}>
                      <ClipboardList className="w-3 h-3" /> {req.nameMatched ? 'الاسم متطابق' : 'الاسم غير متطابق'}
                    </span>
                    <span className={`text-[10px] border rounded-full px-2 py-1 flex items-center gap-1 ${
                      migrateToV5(req.faceDescriptor) !== null
                        ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                        : req.faceDescriptor
                        ? 'bg-amber-500/15 border-amber-500/30 text-amber-300'
                        : 'bg-slate-800 border-slate-600'
                    }`}>
                      <Smile className="w-3 h-3" /> {
                        migrateToV5(req.faceDescriptor) !== null ? 'بصمة وجه مسجلة'
                          : req.faceDescriptor ? 'بصمة قديمة — تحتاج إعادة تسجيل'
                          : 'بدون بصمة'
                      }
                    </span>
                    {req.hasExistingQr && (
                      <span className="text-[10px] bg-amber-500/15 border border-amber-500/30 text-amber-300 rounded-full px-2 py-1 flex items-center gap-1">
                        <TriangleAlert className="w-3 h-3" /> سيتم استبدال QR قديم
                      </span>
                    )}
                    {req.hasExistingFace && (
                      <span className="text-[10px] bg-amber-500/15 border border-amber-500/30 text-amber-300 rounded-full px-2 py-1 flex items-center gap-1">
                        <TriangleAlert className="w-3 h-3" /> سيتم استبدال بصمة قديمة
                      </span>
                    )}
                    {req.selfMismatch && (
                      <span className="text-[10px] bg-red-500/15 border border-red-500/40 text-red-300 rounded-full px-2 py-1 flex items-center gap-1">
                        <TriangleAlert className="w-3 h-3" /> الوجه لا يطابق بصمته المسجّلة
                      </span>
                    )}
                    {req.checksFailed && (
                      <span className="text-[10px] bg-amber-500/15 border border-amber-500/30 text-amber-300 rounded-full px-2 py-1 flex items-center gap-1">
                        <TriangleAlert className="w-3 h-3" /> فحص التكرار لم يكتمل
                      </span>
                    )}
                    {siblingCount > 1 && (
                      <span className="text-[10px] bg-sky-500/15 border border-sky-500/30 text-sky-300 rounded-full px-2 py-1 flex items-center gap-1">
                        <TriangleAlert className="w-3 h-3" /> {siblingCount} طلبات لنفس الطالب
                      </span>
                    )}
                  </div>

                  {req.selfMismatch && (
                    <div className="mb-3 p-2 bg-red-500/10 border border-red-500/30 rounded text-xs text-red-300">
                      <strong>تنبيه:</strong> الوجه الجديد لا يشبه بصمة الطالب المسجّلة سابقاً — قد يكون الطلب من طالب آخر، أو تم استبدال الرقم. راجع الطلب قبل الموافقة.
                    </div>
                  )}
                  {req.checksFailed && (
                    <div className="mb-3 p-2 bg-amber-500/10 border border-amber-500/30 rounded text-xs text-amber-300">
                      <strong>تنبيه:</strong> لم يكتمل فحص تكرار البصمة قبل الإرسال (تعذّرت قراءة طلاب المرحلة).
                    </div>
                  )}

                  {isRejected && req.rejectionReason && (
                    <div className="mb-3 p-2 bg-red-500/10 border border-red-500/30 rounded text-xs text-red-300">
                      <strong>سبب الرفض:</strong> {req.rejectionReason}
                    </div>
                  )}

                  {isRejecting && (
                    <div className="mb-3 p-3 bg-slate-800 border-2 border-red-500/40 rounded-lg">
                      <textarea
                        value={rejectReason}
                        onChange={e => setRejectReason(e.target.value)}
                        placeholder="سبب الرفض (اختياري)..."
                        rows={2}
                        className="w-full px-2 py-1 border border-slate-600 bg-slate-800 text-white placeholder:text-slate-500 rounded text-sm focus:border-red-500 focus:ring-2 focus:ring-red-500/30"
                      />
                      <div className="grid grid-cols-2 gap-2 mt-2">
                        <button
                          onClick={() => {
                            setRejectingId(null);
                            setRejectReason('');
                          }}
                          className="py-1.5 bg-white/10 hover:bg-white/20 text-slate-300 text-xs font-bold rounded"
                        >
                          إلغاء
                        </button>
                        <button
                          onClick={() => handleReject(req, rejectReason)}
                          disabled={isProcessing}
                          className="py-1.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-xs font-bold rounded flex items-center justify-center gap-1"
                        >
                          {isProcessing ? <MorphingSquare size="xs" /> : <><Check className="w-3.5 h-3.5" /> تأكيد الرفض</>}
                        </button>
                      </div>
                    </div>
                  )}

                  {!isRejecting && (
                    <div className="flex gap-2">
                      {isPending && (
                        <>
                          <button
                            onClick={() => handleApprove(req)}
                            disabled={isProcessing}
                            className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-bold rounded-lg active:scale-95 flex items-center justify-center gap-1.5"
                          >
                            {isProcessing ? <><MorphingSquare size="sm" /> جاري...</> : <><CircleCheck className="w-4 h-4" /> موافقة</>}
                          </button>
                          <button
                            onClick={() => {
                              setRejectingId(req.id);
                              setRejectReason('');
                            }}
                            disabled={isProcessing}
                            className="flex-1 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-bold rounded-lg active:scale-95 flex items-center justify-center gap-1.5"
                          >
                            <CircleX className="w-4 h-4" /> رفض
                          </button>
                        </>
                      )}

                      {(isApproved || isRejected) && (
                        <button
                          onClick={() => handleDelete(req)}
                          className="flex-1 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm font-bold rounded-lg flex items-center justify-center gap-1.5"
                        >
                          <Trash2 className="w-4 h-4" /> حذف من السجل
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

export default PendingRegistrations;
