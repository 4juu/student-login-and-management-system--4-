import React, { useState, useEffect, lazy, Suspense, useCallback } from 'react';
import { ref, set } from 'firebase/database';
import { database, dbURL } from '../../firebase/config';
import { AttendanceRecord, Student } from '../../types/student';
import { RegistrationLink, IDExtractionResult } from '../../types/registration';
import { getRegistrationLink, validateLink } from '../../services/tokenService';
import { findNameInOCRText } from '../../services/nameMatching';
import { IDCardUpload } from './IDCardUpload';
import { RegistrationSuccess } from './RegistrationSuccess';
import { getActiveAcademicYear, loadAttendanceRecords, loadSessions } from '../../firebase/dataService';
import { decompressRecord } from '../../firebase/dataServiceCompressed';
import { SkeletonCard } from '../Skeleton';
import { migrateToV5, type FaceGalleryDescriptor } from '../../services/faceAI/descriptors';
import { useFaceAI } from '../../hooks/useFaceAI';
import { EngineOverlay } from '../face/EngineOverlay';
import { AlertTriangle, XCircle, CalendarDays, CheckCircle, Users, BookOpen, ArrowLeft, ScanFace, IdCard } from 'lucide-react';

const LazySelfCapture = lazy(() =>
  import('../face/SelfCaptureStep').then(m => ({ default: m.SelfCaptureStep }))
);

type Step =
  | 'loading'
  | 'invalid-link'
  | 'upload-id'
  | 'name-mismatch'
  | 'confirm'
  | 'capture-face'
  | 'submitting'
  | 'success'
  | 'error'
  | 'attendance-report';

interface SelfEnrollPageProps {
  token: string;
  onExit: () => void;
}

const dbFetch = async <T,>(path: string, signal?: AbortSignal): Promise<T | null> => {
  const url = `${dbURL}/${path}.json`;
  const res = await fetch(url, { signal });
  if (!res.ok) return null;
  return res.json() as Promise<T | null>;
};

/** قراءة طلاب مرحلة واحدة فقط عبر المسار العام students (يعمل بدون تسجيل دخول) */
export const loadStageStudentsPublic = async (
  adminUid: string,
  year: string,
  stageId: string,
): Promise<Student[]> => {
  const base = `academicYears/${year}/userData/${adminUid}/stageData/${stageId}/students`;
  const data = await dbFetch<any>(base);
  if (!data) return [];
  const arr: any[] = Array.isArray(data) ? data : Object.values(data);
  return arr.filter(s => s && s.id && s.name) as Student[];
};

const buildStudentFromLink = (lnk: RegistrationLink): Student => ({
  id: lnk.studentId || '',
  name: lnk.studentName || '',
  code: lnk.studentCode || '',
  qrCodeId: lnk.qrCodeId,
} as Student);

const normalizeDate = (dateStr: string): string => {
  if (!dateStr) return '';
  const arabicNums = '٠١٢٣٤٥٦٧٨٩';
  const engNums = '0123456789';
  let n = dateStr.replace(/[٠-٩]/g, d => engNums[arabicNums.indexOf(d)]).replace(/[\u200E\u200F]/g, '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(n)) return n;
  const m = n.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return n;
};

export const SelfEnrollPage: React.FC<SelfEnrollPageProps> = ({ token, onExit }) => {
  // محرك البصمة يشتغل أول شيء — لا تظهر أي خطوة تفاعلية قبل جهوزيته
  const { ready: engineReady, progress, error: engineError, retry: engineRetry } = useFaceAI();

  const [step, setStep] = useState<Step>('loading');
  const [link, setLink] = useState<RegistrationLink | null>(null);
  const [expected, setExpected] = useState<Student | null>(null);
  const [stageStudents, setStageStudents] = useState<Student[]>([]);
  const [idData, setIdData] = useState<IDExtractionResult | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[]>([]);
  const [sessionNameMap, setSessionNameMap] = useState<Record<string, string>>({});
  const [retryStep, setRetryStep] = useState<Step>('upload-id');

  const goTo = useCallback((s: Step) => setStep(prev => prev === s ? prev : s), []);

  const loadStageRecordsForStudent = async (
    lnk: RegistrationLink, studentId: string, signal?: AbortSignal,
  ): Promise<{ records: AttendanceRecord[]; sessionNameMap: Record<string, string> }> => {
    let year = lnk.academicYear || '';
    if (!year) { try { year = await getActiveAcademicYear(); } catch { year = ''; } }
    if (!year) return { records: [], sessionNameMap: {} };

    const teacherId = lnk.teacherId || lnk.adminUid;
    const [teacherRecords, teacherSessions] = await Promise.all([
      loadAttendanceRecords(lnk.adminUid, lnk.stageId, teacherId),
      loadSessions(lnk.adminUid, lnk.stageId, teacherId),
    ]);

    const sNameMap: Record<string, string> = {};
    for (const s of teacherSessions) { if (s?.id && s.name) sNameMap[s.id] = s.name; }
    let records = teacherRecords.filter(r => r?.studentId === studentId);

    if (records.length === 0) {
      // مسار مباشر عام لسجلات كل المدرسين في المرحلة — نعرض سجلات الطالب المطابق فقط
      const base = `academicYears/${year}/userData/${lnk.adminUid}/stageData/${lnk.stageId}`;
      const teachersData = await dbFetch<any>(`${base}/teacherRecords`, signal);
      if (teachersData) {
        const teachers: any[] = Array.isArray(teachersData) ? teachersData : Object.values(teachersData);
        const all: AttendanceRecord[] = [];
        for (const t of teachers) {
          if (!t || typeof t !== 'object') continue;
          const arr: any[] = t.recordsCompressed ? (Array.isArray(t.recordsCompressed) ? t.recordsCompressed : Object.values(t.recordsCompressed)) : [];
          for (const c of arr) {
            if (!c || typeof c !== 'object') continue;
            if (c.id) { all.push(c as AttendanceRecord); continue; }
            try { const rec = decompressRecord(c); if (rec?.id) all.push(rec); } catch {}
          }
          if (t.records) {
            const raw: any[] = Array.isArray(t.records) ? t.records : Object.values(t.records);
            all.push(...raw.filter(r => r && typeof r === 'object' && r.id));
          }
        }
        records = all.filter(r => r.studentId === studentId);
      }
    }
    return { records, sessionNameMap: sNameMap };
  };

  useEffect(() => {
    let mounted = true;
    const TIMEOUT = 20000;
    const globalTimeout = setTimeout(() => {
      if (!mounted) return;
      setErrorMsg('تعذر الاتصال بقاعدة البيانات');
      goTo('invalid-link');
    }, TIMEOUT);

    (async () => {
      try {
        const linkData = await getRegistrationLink(token);
        if (!mounted) return;
        const validation = validateLink(linkData);
        if (!validation.valid) { setErrorMsg(validation.reason || 'الرابط غير صالح'); goTo('invalid-link'); return; }
        if (!linkData) { setErrorMsg('الرابط غير موجود'); goTo('invalid-link'); return; }

        if ((linkData.type as string) === 'enroll') {
          setErrorMsg('هذا النوع من الروابط لم يعد مدعوماً — اطلب رابطاً جديداً من إدارة الكلية');
          goTo('invalid-link');
          return;
        }

        setLink(linkData);

        // روابط الحضور: نجلب طلاب المرحلة من المسار العام ونطابق الاسم عليهم
        if (linkData.type === 'attendance') {
          let year = linkData.academicYear || '';
          if (!year) { try { year = await getActiveAcademicYear(); } catch { year = ''; } }
          if (!year) { setErrorMsg('تعذر تحميل السنة الدراسية'); goTo('invalid-link'); return; }

          const ac = new AbortController();
          const st = setTimeout(() => ac.abort(), TIMEOUT);
          try {
            const list = await loadStageStudentsPublic(linkData.adminUid, year, linkData.stageId);
            if (!mounted) return;
            if (list.length === 0) {
              setErrorMsg('لم نجد بيانات طلاب لهذه المرحلة');
              goTo('invalid-link');
              return;
            }
            setStageStudents(list);
            goTo('upload-id');
          } finally { clearTimeout(st); }
          return;
        }

        // روابط التسجيل الفردية: هوية الطالب مضمّنة داخل الرابط نفسه — بدون قراءة بيانات الطلاب
        if (linkData.studentName && linkData.studentId) {
          setExpected(buildStudentFromLink(linkData));
          goTo('upload-id');
          return;
        }

        // روابط قديمة أُنشئت قبل تضمين الهوية: نجلب الطالب المربوط فقط من المسار العام
        if (linkData.studentId) {
          let year = linkData.academicYear || '';
          if (!year) { try { year = await getActiveAcademicYear(); } catch { year = ''; } }
          if (!year) { setErrorMsg('تعذر تحميل السنة الدراسية'); goTo('invalid-link'); return; }

          const list = await loadStageStudentsPublic(linkData.adminUid, year, linkData.stageId);
          if (!mounted) return;
          const bound = list.find(s => s.id === linkData.studentId);
          if (bound) {
            setExpected(bound);
            goTo('upload-id');
            return;
          }
          setErrorMsg('لم نجد بيانات الطالب المرتبط بهذا الرابط');
          goTo('invalid-link');
          return;
        }

        setErrorMsg('هذا الرابط غير مرتبط بأي طالب');
        goTo('invalid-link');
      } catch (e: any) {
        if (!mounted) return;
        setErrorMsg(e?.name === 'AbortError' ? 'تعذر الاتصال بقاعدة البيانات' : 'فشل تحميل بيانات الرابط');
        goTo('invalid-link');
      } finally { clearTimeout(globalTimeout); }
    })();

    return () => { mounted = false; clearTimeout(globalTimeout); };
  }, [token, goTo]);

  const handleIdExtracted = async (result: IDExtractionResult) => {
    setIdData(result);
    if (!link) return;

    try {
      // تسجيل البصمة: الاسم يجب أن يطابق اسم الطالب داخل الرابط حصراً
      if (link.type !== 'attendance') {
        const st = expected;
        if (!st || !st.name) { setErrorMsg('بيانات الطالب غير متوفرة في الرابط'); goTo('invalid-link'); return; }

        const nameOk = !!(result.ocrText && st.name && findNameInOCRText(st.name, result.ocrText).matched);
        const qrOk = !!(result.qrId && st.qrCodeId && result.qrId === st.qrCodeId);

        if (nameOk || qrOk) {
          goTo('confirm');
        } else {
          goTo('name-mismatch');
        }
        return;
      }

      // الحضور: مطابقة على طلاب المرحلة
      let found: Student | null = null;
      if (result.ocrText) {
        let bestConf = -1;
        for (const s of stageStudents) {
          const check = findNameInOCRText(s.name, result.ocrText);
          if (check.matched && check.confidence > bestConf) { found = s; bestConf = check.confidence; }
        }
      }
      if (!found && result.qrId) {
        found = stageStudents.find(s =>
          s.universityId === result.qrId ||
          (s.qrCodeId && s.qrCodeId === result.qrId)
        ) || null;
      }

      if (found) {
        setExpected(found);
        const { records, sessionNameMap: namesMap } = await loadStageRecordsForStudent(link, found.id);
        setAttendanceRecords(records);
        setSessionNameMap(namesMap);
        goTo('attendance-report');
      } else {
        goTo('name-mismatch');
      }
    } catch (e) {
      console.error('❌ خطأ في معالجة الهوية:', e);
      goTo('name-mismatch');
    }
  };

  const handleFaceCaptured = async (descriptor: FaceGalleryDescriptor) => {
    if (!link || !expected) return;
    goTo('submitting');

    // توحيد البصمة إلى v5 نظيفة + التحقق من سلامتها قبل الحفظ — لا نرسل بصمة فارغة/تالفة
    const migrated = migrateToV5(descriptor);
    if (!migrated) {
      setErrorMsg('تعذر حفظ البصمة: لم يتم التقاط وجه صالح. أعد المحاولة.');
      setRetryStep('capture-face');
      goTo('error');
      return;
    }

    try {
      const requestId = `${expected.id}_${Date.now()}`;
      const qrCodeId = idData?.qrId || expected.qrCodeId || '';
      await set(ref(database, `registrationSystem/pending/${link.adminUid}/${requestId}`), {
        id: requestId,
        adminUid: link.adminUid,
        stageId: link.stageId,
        studentId: expected.id,
        studentCode: expected.code || '',
        nameInSystem: expected.name,
        nameFromCard: expected.name,
        nationalId: idData?.nationalId || '',
        qrCodeUrl: idData?.qrUrl || '',
        qrCodeId,
        qrVerified: !!idData?.qrId,
        nameMatched: true,
        faceDescriptor: migrated,
        linkToken: link.token,
        linkType: link.type,
        status: 'pending',
        createdAt: new Date().toISOString(),
        hasExistingQr: !!expected.qrCodeId,
        hasExistingFace: !!expected.faceDescriptor,
      });
      // لا نُعلّم الرابط «مستخدماً» هنا حتى يتمكّن الطالب من إعادة المحاولة عند الفشل.
      // روابط الطالب الواحد تُعلَّم مستخدمة فقط بعد موافقة الأدمن (انظر PendingRegistrations).
      goTo('success');
    } catch (e: any) {
      setErrorMsg(e.code === 'PERMISSION_DENIED' ? 'لا توجد صلاحية' : e.message || 'فشل الحفظ');
      setRetryStep('capture-face');
      goTo('error');
    }
  };

  const getAttendanceStats = () => {
    if (!expected) return { present: 0, absent: 0, total: 0, records: [] as AttendanceRecord[] };
    const present = attendanceRecords.filter(r => r.status === 'present').length;
    const absent = attendanceRecords.filter(r => r.status === 'absent').length;
    const sortedRecords = [...attendanceRecords].sort((a, b) => normalizeDate(b.date).localeCompare(normalizeDate(a.date)));
    return { present, absent, total: present + absent, records: sortedRecords };
  };

  const subjectName = link?.subjectName || 'المادة';

  // بوابة محرك البصمة: الخطوات التفاعلية لا تظهر إلا بعد تحميل المودل بالكامل
  const needsEngine = step !== 'loading' && step !== 'invalid-link';
  if (needsEngine && !engineReady) {
    return (
      <div className="min-h-screen bg-[#0B1220] flex items-center justify-center p-4" dir="rtl">
        <div className="w-full max-w-md">
          <EngineOverlay
            progress={progress}
            error={engineError}
            onRetry={engineRetry}
            onCancel={onExit}
          />
        </div>
      </div>
    );
  }

  if (step === 'loading') {
    return <div className="min-h-screen bg-[#0B1220] flex items-center justify-center p-4" dir="rtl"><div className="w-full max-w-md"><SkeletonCard /></div></div>;
  }

  if (step === 'invalid-link') {
    return (
      <div className="min-h-screen bg-[#0B1220] flex items-center justify-center p-4" dir="rtl">
        <div className="glass-card p-8 max-w-md w-full text-center">
          <div className="mx-auto w-16 h-16 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center mb-4">
            <AlertTriangle className="w-8 h-8 text-red-400" />
          </div>
          <h2 className="text-2xl font-bold text-red-400 mb-2">رابط غير صالح</h2>
          <p className="text-white/60 mb-6">{errorMsg}</p>
          <button onClick={onExit} className="btn-base btn-primary w-full py-3">العودة للرئيسية</button>
        </div>
      </div>
    );
  }

  if (step === 'upload-id' && expected) {
    return (
      <div className="min-h-screen bg-[#0B1220] flex items-center justify-center p-4" dir="rtl">
        <div className="w-full max-w-md">
          {link?.type !== 'attendance' && expected.name && (
            <div className="text-center mb-5">
              <div className="mx-auto w-14 h-14 rounded-full bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center mb-3">
                <ScanFace className="w-7 h-7 text-indigo-400" />
              </div>
              <h2 className="text-xl font-bold text-white">تسجيل بصمة الوجه الذاتي</h2>
              <p className="text-sm text-white/50 mt-1">ارفع صورة الهوية الوطنية ليتحقق النظام من مطابقة الاسم</p>
              <div className="mt-3 inline-flex items-center gap-2 bg-indigo-500/10 border border-indigo-500/25 rounded-full px-4 py-1.5">
                <IdCard className="w-4 h-4 text-indigo-300" />
                <span className="text-sm font-bold text-indigo-200">{expected.name}</span>
              </div>
            </div>
          )}
          <IDCardUpload student={expected} onExtracted={handleIdExtracted} onCancel={onExit} />
        </div>
      </div>
    );
  }

  if (step === 'name-mismatch' && idData) {
    return (
      <div className="min-h-screen bg-[#0B1220] flex items-center justify-center p-4" dir="rtl">
        <div className="glass-card p-8 max-w-md w-full text-center">
          <div className="mx-auto w-16 h-16 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mb-4">
            <AlertTriangle className="w-8 h-8 text-amber-400" />
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">تعذّر التحقق من الهوية</h2>
          {expected?.name && link?.type !== 'attendance' && (
            <div className="glass-card-sm p-3 mb-4">
              <p className="text-sm text-white/50">الاسم المطلوب: <span className="text-white font-bold">{expected.name}</span></p>
            </div>
          )}
          <div className="glass-card-sm p-4 mb-4 text-right space-y-2">
            {idData.ocrText && (
              <p className="text-sm text-white/50">النصوص المستخرجة: <span className="text-white/80 font-mono text-xs break-all">{idData.ocrText.slice(0, 300)}</span></p>
            )}
            {idData.qrId && (
              <p className="text-sm text-white/50">رمز QR: <span className="text-white/80 font-mono text-xs">{idData.qrId}</span></p>
            )}
          </div>
          <p className="text-sm text-white/60 mb-6">
            تأكد أنك تصوّر هويتك أنت، وأن الاسم على البطاقة واضح ومطابق للمعروض أعلاه، ثم أعد المحاولة.
          </p>
          <button onClick={() => goTo('upload-id')} className="btn-base btn-secondary w-full py-3">
            <XCircle className="w-4 h-4" /> إعادة تصوير الهوية
          </button>
        </div>
      </div>
    );
  }

  if (step === 'confirm' && expected) {
    const student = expected;
    const barcode = idData?.qrId || student.qrCodeId || '';
    const qrVerified = !!(idData?.qrId && barcode === idData.qrId);
    return (
      <div className="min-h-screen bg-[#0B1220] flex items-center justify-center p-4" dir="rtl">
        <div className="glass-card p-8 max-w-md w-full text-center">
          <div className="mx-auto w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mb-4">
            <CheckCircle className="w-8 h-8 text-emerald-400" />
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">تم التحقق من هويتك</h2>
          <div className="bg-white/5 rounded-xl p-4 mb-4 text-right space-y-2">
            <p className="text-sm text-white/50">الاسم: <span className="text-white font-bold">{student.name}</span></p>
            {student.code && <p className="text-sm text-white/50">الكود: <span className="text-white font-mono">{student.code}</span></p>}
            {barcode && (
              <p className="text-sm text-white/50">الباركود: <span className="text-emerald-300 font-mono">{barcode}</span></p>
            )}
            {qrVerified && (
              <p className="text-[11px] text-emerald-400">✅ تم التحقق من الباركود على الهوية</p>
            )}
          </div>
          <p className="text-sm text-white/60 mb-6">اضغط البدء لتسجيل بصمة وجهك بنفس آلية التسجيل في إدارة الطلاب.</p>
          <button onClick={() => goTo('capture-face')} className="btn-base btn-primary w-full py-3">
            <ScanFace className="w-4 h-4" /> بدء تسجيل البصمة
          </button>
          <button onClick={() => goTo('upload-id')} className="btn-base btn-secondary w-full py-3 mt-2">
            <XCircle className="w-4 h-4" /> بطاقة خاطئة
          </button>
        </div>
      </div>
    );
  }

  if (step === 'capture-face' && expected) {
    return (
      <Suspense fallback={<div className="min-h-screen bg-[#0B1220] flex items-center justify-center p-4" dir="rtl"><div className="w-full max-w-md"><SkeletonCard /></div></div>}>
        <LazySelfCapture
          student={expected}
          allStudents={[]}
          onCaptured={handleFaceCaptured}
          onCancel={() => goTo('confirm')}
        />
      </Suspense>
    );
  }

  if (step === 'submitting') {
    return (
      <div className="min-h-screen bg-[#0B1220] flex items-center justify-center p-4" dir="rtl">
        <div className="text-center">
          <div className="inline-block w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4" />
          <p className="text-white font-bold text-lg">جاري إرسال البيانات...</p>
          <p className="text-sm text-white/50 mt-2">لا تغلق الصفحة</p>
        </div>
      </div>
    );
  }

  if (step === 'success' && expected) {
    return <RegistrationSuccess student={expected} qrVerified={!!(idData?.qrId && (idData.qrId === expected.qrCodeId || !expected.qrCodeId))} onExit={onExit} />;
  }

  if (step === 'error') {
    return (
      <div className="min-h-screen bg-[#0B1220] flex items-center justify-center p-4" dir="rtl">
        <div className="glass-card p-8 max-w-md w-full text-center">
          <div className="mx-auto w-16 h-16 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center mb-4">
            <XCircle className="w-8 h-8 text-red-400" />
          </div>
          <h2 className="text-2xl font-bold text-red-400 mb-2">حدث خطأ</h2>
          <p className="text-white/60 mb-6">{errorMsg}</p>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={onExit} className="btn-base btn-secondary py-3">خروج</button>
              <button onClick={() => goTo(retryStep)} className="btn-base btn-primary py-3">إعادة</button>
            </div>
        </div>
      </div>
    );
  }

  if (step === 'attendance-report' && expected) {
    const { present, absent, total, records } = getAttendanceStats();
    return (
      <div className="min-h-screen bg-[#0B1220] flex items-center justify-center p-4" dir="rtl">
        <div className="w-full max-w-2xl">
          <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 overflow-hidden">
            <div className="bg-gradient-to-r from-emerald-600 to-teal-600 p-6">
              <div className="flex items-center gap-3 mb-2">
                <div className="bg-white/20 p-3 rounded-xl"><BookOpen className="w-7 h-7 text-white" /></div>
                <div>
                  <p className="text-sm text-emerald-100">مادة</p>
                  <h1 className="text-2xl font-bold text-white">{subjectName}</h1>
                </div>
              </div>
              <p className="text-emerald-100/80">تقرير الحضور والغياب للطالب</p>
            </div>
            <div className="p-6 border-b border-white/10">
              <div className="flex items-center gap-4 bg-white/5 rounded-xl p-4">
                <div className="bg-emerald-500/20 p-4 rounded-xl"><Users className="w-8 h-8 text-emerald-400" /></div>
                <div>
                  <p className="text-sm text-white/50">اسم الطالب</p>
                  <h2 className="text-2xl font-bold text-white">{expected.name}</h2>
                  {expected.code && <p className="text-sm text-white/40 font-mono">كود: {expected.code}</p>}
                </div>
              </div>
            </div>
            <div className="p-6 grid grid-cols-3 gap-3">
              <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-4 text-center">
                <div className="flex items-center justify-center gap-2 mb-1"><CheckCircle className="w-5 h-5 text-green-400" /><span className="text-sm font-medium text-green-300">حضور</span></div>
                <div className="text-3xl font-bold text-green-300">{present}</div>
              </div>
              <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-center">
                <div className="flex items-center justify-center gap-2 mb-1"><XCircle className="w-5 h-5 text-red-400" /><span className="text-sm font-medium text-red-300">غياب</span></div>
                <div className="text-3xl font-bold text-red-300">{absent}</div>
              </div>
              <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4 text-center">
                <div className="flex items-center justify-center gap-2 mb-1"><CalendarDays className="w-5 h-5 text-blue-400" /><span className="text-sm font-medium text-blue-300">المجموع</span></div>
                <div className="text-3xl font-bold text-blue-300">{total}</div>
              </div>
            </div>
            {records.length > 0 && (
              <div className="px-6 pb-6">
                <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2"><CalendarDays className="w-5 h-5 text-emerald-400" /> تفاصيل الجلسات</h3>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {records.map(record => (
                    <div key={record.id} className="bg-white/5 border border-white/10 rounded-xl p-3 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center ${record.status === 'present' ? 'bg-green-500/20' : 'bg-red-500/20'}`}>
                          {record.status === 'present' ? <CheckCircle className="w-5 h-5 text-green-400" /> : <XCircle className="w-5 h-5 text-red-400" />}
                        </div>
                        <div className="text-right">
                          <p className="font-medium text-white">{(record as any).sessionName || sessionNameMap[record.sessionId] || 'جلسة'}</p>
                          <p className="text-xs text-white/50 font-mono">{normalizeDate(record.date)} {record.time && `• ${record.time}`}</p>
                        </div>
                      </div>
                      <span className={`px-3 py-1 rounded-full text-xs font-bold ${record.status === 'present' ? 'bg-green-500/20 text-green-300' : 'bg-red-500/20 text-red-300'}`}>
                        {record.status === 'present' ? 'حاضر' : 'غائب'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {records.length === 0 && (
              <div className="px-6 pb-6 text-center">
                <div className="bg-white/5 border border-white/10 rounded-xl p-8">
                  <CalendarDays className="w-12 h-12 text-white/20 mx-auto mb-3" />
                  <p className="text-white/60">لا توجد سجلات حضور لهذا الطالب</p>
                </div>
              </div>
            )}
            <div className="px-6 pb-6">
              <button onClick={onExit} className="w-full bg-white/10 hover:bg-white/20 text-white font-bold py-3 rounded-xl transition-all flex items-center justify-center gap-2">
                <ArrowLeft className="w-5 h-5" /> العودة للرئيسية
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
};
