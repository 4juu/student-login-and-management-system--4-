import React, { useState, useEffect, lazy, Suspense, useCallback } from 'react';
import { ref, set } from 'firebase/database';
import { database, dbURL } from '../../firebase/config';
import { AttendanceRecord, AttendanceSession, Student } from '../../types/student';
import { RegistrationLink } from '../../types/registration';
import { getRegistrationLink, validateLink } from '../../services/tokenService';
import { VerifyIdStep, type QrScanResult } from './VerifyIdStep';
import { RegistrationSuccess } from './RegistrationSuccess';
import { getActiveAcademicYear } from '../../firebase/dataService';
import { decompressRecord } from '../../firebase/dataServiceCompressed';
import { migrateToV5, parseAllSamples, checkForTampering, type FaceGalleryDescriptor } from '../../services/faceAI/descriptors';
import { useFaceAI } from '../../hooks/useFaceAI';
import { EngineOverlay } from '../face/EngineOverlay';
import {
  AlertTriangle,
  XCircle,
  CalendarDays,
  CheckCircle,
  Users,
  BookOpen,
  ArrowLeft,
  ScanFace,
  ShieldCheck,
  IdCard,
  Fingerprint,
  Clock,
  BadgeCheck,
  RefreshCw,
} from 'lucide-react';
import './selfRegister.css';
import { TextScramble } from '../TextScramble';

const LazySelfCapture = lazy(() =>
  import('../face/SelfCaptureStep').then(m => ({ default: m.SelfCaptureStep }))
);

type Step =
  | 'loading'
  | 'invalid-link'
  | 'verify'
  | 'confirm'
  | 'capture-face'
  | 'submitting'
  | 'success'
  | 'report'
  | 'error';

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

// ── تحميل الطلاب مع دمج التحسينات المحفوظة (descriptorOverrides) ──
export const loadStageStudentsWithOverrides = async (
  adminUid: string,
  stageId: string,
): Promise<Student[]> => {
  const year = await getActiveAcademicYear();
  const students = await loadStageStudentsCached(adminUid, year, stageId);
  if (students.length === 0) return students;

  try {
    const overridesPath = `academicYears/${year}/userData/${adminUid}/stageData/${stageId}/descriptorOverrides`;
    const overridesData = await dbFetch<Record<string, { faceDescriptor: any; updatedAt: number }>>(overridesPath);
    if (!overridesData) return students;

    let merged = 0;
    const result = students.map(s => {
      const ov = overridesData[s.id];
      if (ov?.faceDescriptor && ov.updatedAt > 0) {
        merged++;
        return { ...s, faceDescriptor: ov.faceDescriptor };
      }
      return s;
    });

    if (merged > 0) console.log(`[selfEnroll] دُمج ${merged} تحسين بصمة من descriptorOverrides`);
    return result;
  } catch {
    return students;
  }
};

const STAGE_CACHE_TTL = 6 * 60 * 60 * 1000; // 6 ساعات

const stageCacheKey = (adminUid: string, year: string, stageId: string) =>
  `stageStudents:${adminUid}:${year}:${stageId}`;

/** تحميل طلاب المرحلة مع cache بالجلسة (فورياً عند العودة، وتحديث بالخلفية) */
export const loadStageStudentsCached = async (
  adminUid: string,
  year: string,
  stageId: string,
): Promise<Student[]> => {
  const key = stageCacheKey(adminUid, year, stageId);

  const readCache = (): Student[] | null => {
    try {
      const raw = sessionStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.students) || Date.now() - (parsed.t || 0) > STAGE_CACHE_TTL) {
        sessionStorage.removeItem(key);
        return null;
      }
      return parsed.students as Student[];
    } catch {
      return null;
    }
  };

  const writeCache = (students: Student[]) => {
    try {
      sessionStorage.setItem(key, JSON.stringify({ t: Date.now(), students }));
    } catch {}
  };

  const cached = readCache();
  if (cached) {
    // تحديث بالخلفية دون تعطيل الفورية
    loadStageStudentsPublic(adminUid, year, stageId)
      .then(list => { if (list?.length) writeCache(list); })
      .catch(() => {});
    return cached;
  }

  const list = await loadStageStudentsPublic(adminUid, year, stageId);
  if (list?.length) writeCache(list);
  return list;
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
  const [step, setStep] = useState<Step>('loading');
  const [link, setLink] = useState<RegistrationLink | null>(null);
  const [expected, setExpected] = useState<Student | null>(null);
  const [stageStudents, setStageStudents] = useState<Student[]>([]);
  const [errorMsg, setErrorMsg] = useState('');
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[]>([]);
  const [attendanceSessions, setAttendanceSessions] = useState<AttendanceSession[]>([]);
  const [sessionNameMap, setSessionNameMap] = useState<Record<string, string>>({});
  const [retryStep, setRetryStep] = useState<Step>('verify');
  const [qrResult, setQrResult] = useState<QrScanResult | null>(null);

  const needsEngine = step === 'capture-face';
  const { ready: engineReady, progress, error: engineError, retry: engineRetry } = useFaceAI(needsEngine);

  const goTo = useCallback((s: Step) => setStep(prev => (prev === s ? prev : s)), []);

  // انتقال بين الشاشات عبر View Transitions API (مع احترام تقليل الحركة)
  const transitionTo = useCallback(
    (s: Step) => {
      const apply = () => goTo(s);
      try {
        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (reduced || typeof (document as any).startViewTransition !== 'function') {
          apply();
          return;
        }
        (document as any).startViewTransition(apply);
      } catch {
        apply();
      }
    },
    [goTo],
  );

  // العودة لأول خطوة التحقق لنفس الطالب — بلا تحويل لصفحة تسجيل الدخول
  const restart = useCallback(() => {
    setAttendanceRecords([]);
    setAttendanceSessions([]);
    setSessionNameMap({});
    setQrResult(null);
    setErrorMsg('');
    setRetryStep('verify');
    transitionTo('verify');
  }, [transitionTo]);

  const loadStageRecordsForStudent = async (
    lnk: RegistrationLink,
    studentId: string,
    signal?: AbortSignal,
  ): Promise<{ records: AttendanceRecord[]; sessions: AttendanceSession[]; sessionNameMap: Record<string, string> }> => {
    let year = lnk.academicYear || '';
    if (!year) { try { year = await getActiveAcademicYear(); } catch { year = ''; } }
if (!year) return { records: [], sessions: [], sessionNameMap: {} };

    // نجمع سجلات وجلسات الطالب من كل المدرّسين في المرحلة —
    // السجلات قد تُحفظ بحساب من يسجّل الحضور فعلياً (ليس بالضرورة مُرسل الرابط)
    const senderTeacherId = lnk.teacherId || lnk.adminUid;
    const allTeachersPath = `academicYears/${year}/userData/${lnk.adminUid}/stageData/${lnk.stageId}/teacherRecords`;
    const all = await dbFetch<any>(allTeachersPath, signal);

    const datasets: any[] = [];
    if (all && typeof all === 'object' && !Array.isArray(all)) {
      for (const tid of Object.keys(all)) {
        const td = all[tid];
        if (td && typeof td === 'object' && Object.keys(td).length > 0) datasets.push(td);
      }
    }
    if (datasets.length === 0) {
      const own = await dbFetch<any>(`${allTeachersPath}/${senderTeacherId}`, signal);
      if (own && typeof own === 'object' && Object.keys(own).length > 0) datasets.push(own);
    }

    const records: AttendanceRecord[] = [];
    const sessions: AttendanceSession[] = [];
    const seenRecords = new Set<string>();
    const seenSessions = new Set<string>();

    for (const ds of datasets) {
      if (ds.sessions) {
        const sessArr: any[] = Array.isArray(ds.sessions) ? ds.sessions : Object.values(ds.sessions);
        for (const s of sessArr) {
          if (s && s.id && !seenSessions.has(s.id)) {
            seenSessions.add(s.id);
            sessions.push(s as AttendanceSession);
          }
        }
      }

      const shapes: any[] = [];
      if (ds.recordsCompressed) {
        const arr: any[] = Array.isArray(ds.recordsCompressed) ? ds.recordsCompressed : Object.values(ds.recordsCompressed);
        for (const c of arr) {
          if (!c || typeof c !== 'object') continue;
          if (c.id) { shapes.push(c); continue; }
          try { const rec = decompressRecord(c); if (rec?.id) shapes.push(rec); } catch {}
        }
      }
      if (ds.records) {
        const raw: any[] = Array.isArray(ds.records) ? ds.records : Object.values(ds.records);
        shapes.push(...raw.filter(r => r && typeof r === 'object' && r.id));
      }
      for (const rec of shapes) {
        if (rec?.studentId === studentId && rec.id && !seenRecords.has(rec.id)) {
          seenRecords.add(rec.id);
          records.push(rec as AttendanceRecord);
        }
      }
    }

    const sessionNameMap: Record<string, string> = {};
    for (const s of sessions) { if (s.id && s.name) sessionNameMap[s.id] = s.name; }

    return { records, sessions, sessionNameMap };
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
            const list = await loadStageStudentsCached(linkData.adminUid, year, linkData.stageId);
            if (!mounted) return;
            if (list.length === 0) {
              setErrorMsg('لم نجد بيانات طلاب لهذه المرحلة');
              goTo('invalid-link');
              return;
            }
            setStageStudents(list);
            goTo('verify');
          } finally { clearTimeout(st); }
          return;
        }

        // روابط التسجيل الفردية: هوية الطالب مضمّنة داخل الرابط نفسه
        if (linkData.studentName && linkData.studentId) {
          setExpected(buildStudentFromLink(linkData));
          goTo('verify');
          return;
        }

        // روابط قديمة أُنشئت قبل تضمين الهوية
        if (linkData.studentId) {
          let year = linkData.academicYear || '';
          if (!year) { try { year = await getActiveAcademicYear(); } catch { year = ''; } }
          if (!year) { setErrorMsg('تعذر تحميل السنة الدراسية'); goTo('invalid-link'); return; }

          const list = await loadStageStudentsPublic(linkData.adminUid, year, linkData.stageId);
          if (!mounted) return;
          const bound = list.find(s => s.id === linkData.studentId);
          if (bound) {
            setExpected(bound);
            goTo('verify');
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

  const handleVerified = async (student: Student, qr?: QrScanResult | null) => {
    if (!link) return;
    setQrResult(qr ?? null);

    // روابط البصمة/التحقق: المطابقة تمت داخل نافذة التحقق — ننتقل لتأكيد البصمة
    if (link.type !== 'attendance') {
      goTo('confirm');
      return;
    }

    // روابط الحضور: نجلب تقرير الطالب المطابق
    setExpected(student);
    try {
      const { records, sessions, sessionNameMap: namesMap } = await loadStageRecordsForStudent(link, student.id);
      setAttendanceRecords(records);
      setAttendanceSessions(sessions);
      setSessionNameMap(namesMap);
      // بعد إتمام التقرير، يخرج تحديث الصفحة لتسجيل الدخول بدلاً من إعادة خطوة التحقق
      sessionStorage.setItem('selfEnrollDoneToken', link.token);
      goTo('report');
    } catch (e) {
      console.error('❌ تعذر تحميل تقرير الحضور:', e);
      setErrorMsg('تعذر تحميل تقرير الحضور — حاول مرة أخرى');
      setRetryStep('verify');
      goTo('error');
    }
  };

  const handleFaceCaptured = async (descriptor: FaceGalleryDescriptor) => {
    if (!link || !expected) return;
    goTo('submitting');

    const migrated = migrateToV5(descriptor);
    if (!migrated) {
      setErrorMsg('تعذر حفظ البصمة: لم يتم التقاط وجه صالح. أعد المحاولة.');
      setRetryStep('capture-face');
      goTo('error');
      return;
    }

    // فحص التكرار قبل الإرسال للأدمن
    try {
      const allNewSamples = parseAllSamples(migrated);
      if (allNewSamples.length > 0) {
        let year = link.academicYear || '';
        if (!year) { try { year = await getActiveAcademicYear(); } catch {} }

        const stageStudents = year
          ? await loadStageStudentsPublic(link.adminUid, year, link.stageId)
          : [];

        let tamperResult: { tampered: boolean; matchedWith?: string } = { tampered: false };
        for (const sample of allNewSamples) {
          const r = checkForTampering(sample, stageStudents, expected.id);
          if (r.tampered) { tamperResult = r; break; }
        }

        if (tamperResult.tampered) {
          setErrorMsg(`عذراً، هذه البصمة مسجّلة بالفعل باسم الطالب: ${tamperResult.matchedWith}`);
          setRetryStep('capture-face');
          goTo('error');
          return;
        }
      }
    } catch {
      console.warn('⚠️ فشل فحص تكرار البصمة، سيتم المتابعة للأدمن كخط دفاع ثانٍ:');
    }

    try {
      const requestId = `${expected.id}_${Date.now()}`;
      const cardQrId = qrResult?.qrCodeId || '';
      const qrCodeUrl = qrResult?.qrCodeUrl || '';
      const qrVerified = !!qrResult?.verified;
      // رمز البطاقة إن لم يُطابق سجل الطالب يُعلَّق مطابقته بالاسم فقط — نُخطر الأدمن بالرمز المستخرج
      const qrCodeId = cardQrId || expected.qrCodeId || '';
      await set(ref(database, `registrationSystem/pending/${link.adminUid}/${requestId}`), {
        id: requestId,
        adminUid: link.adminUid,
        stageId: link.stageId,
        studentId: expected.id,
        studentCode: expected.code || '',
        nameInSystem: expected.name,
        nameFromCard: expected.name,
        nationalId: '',
        qrCodeUrl,
        qrCodeId,
        qrVerified,
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
      goTo('success');
    } catch (e: any) {
      setErrorMsg(e.code === 'PERMISSION_DENIED' ? 'لا توجد صلاحية' : e.message || 'فشل الحفظ');
      setRetryStep('capture-face');
      goTo('error');
    }
  };

  const getAttendanceStats = () => {
    const emptyStats = { present: 0, absent: 0, total: 0, records: [] as AttendanceRecord[] };
    if (!expected) return emptyStats;

    // خريطة الحضور: أي جلسة لها سجل present نحتسبها حاضراً
    const presentSessionIds = new Set<string>();
    const recBySession = new Map<string, AttendanceRecord>();
    for (const r of attendanceRecords) {
      if (r?.status === 'present' && r.sessionId) {
        presentSessionIds.add(r.sessionId);
        if (!recBySession.has(r.sessionId)) recBySession.set(r.sessionId, r);
      }
    }

    const rows: AttendanceRecord[] = [];
    const seenIds = new Set<string>();

    // ① جلسات حاضر/غياب مرتبطة بجلسات مسجّلة في النظام
    const sortedSessions = [...attendanceSessions].sort((a, b) =>
      normalizeDate(b.date || '').localeCompare(normalizeDate(a.date || '')),
    );
    for (const s of sortedSessions) {
      const rec = recBySession.get(s.id);
      if (rec && !seenIds.has(rec.id)) {
        rows.push(rec);
        seenIds.add(rec.id);
      } else if (!presentSessionIds.has(s.id)) {
        rows.push({ ...s, id: `session_${s.id}`, sessionName: s.name, status: 'absent', time: '' } as unknown as AttendanceRecord);
      }
    }

    // ② سجلات حضور قديمة بدون جلسة حالية في النظام (جلسات حُذفت أو من مصدر آخر)
    const sortedRecords = [...attendanceRecords]
      .filter(r => r?.status === 'present' && !seenIds.has(r.id))
      .sort((a, b) => normalizeDate(b.date).localeCompare(normalizeDate(a.date)));
    for (const r of sortedRecords) rows.push(r);

    // ترتيب نهائي حسب التاريخ
    rows.sort((a, b) => normalizeDate(b.date).localeCompare(normalizeDate(a.date)));

    const present = rows.filter(r => r.status === 'present').length;
    const absent = rows.filter(r => r.status === 'absent').length;
    return { present, absent, total: present + absent, records: rows };
  };

  const subjectName = link?.subjectName || 'المادة';

  // ── بوابة محرك البصمة: تظهر فقط عند خطوة التصوير ──
  const showEngineGate = needsEngine && !engineReady;
  if (showEngineGate) {
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

  // ── شاشة التقاط الوجه (شاشة كاملة مستقلة) ──
  if (step === 'capture-face' && expected) {
    return (
      <Suspense fallback={
        <div className="min-h-screen bg-[#0B1220] flex items-center justify-center p-4" dir="rtl">
          <div className="w-10 h-10 border-3 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      }>
        <LazySelfCapture
          student={expected}
          allStudents={[]}
          onCaptured={handleFaceCaptured}
          onCancel={() => goTo('confirm')}
        />
      </Suspense>
    );
  }

  // ── شاشة النجاح (شاشة كاملة مستقلة) ──
  // زر «تم» يعيد لأول خطوة التحقق لنفس الطالب — لا انتقال لتسجيل الدخول
  if (step === 'success' && expected) {
    return <RegistrationSuccess student={expected} qrVerified={!!qrResult?.verified} onExit={restart} />;
  }

  // ═══════════ الشاشات ضمن الهيكل الحكومي الفاتح ═══════════

  // ترؤيسة حسب الخطوة
  const headerCfg =
    step === 'verify'
      ? link?.type === 'attendance'
        ? { title: 'رابط معرفة الحضور اليومي الخاص بالطلبة', subtitle: 'تحقق من هويتك عبر بطاقتك الجامعية لعرض تقريرك' }
        : { title: 'تسجيل بصمة الوجه ورمز QR code', subtitle: 'تحقق من هويتك عبر بطاقتك الجامعية ثم سجّل بصمتك الذاتية' }
      : step === 'confirm'
      ? { title: 'تأكيد هويتك', subtitle: `الطالب: ${expected?.name || ''}` }
      : step === 'report'
      ? { title: 'بطاقتي الرقمية', subtitle: 'تقرير الحضور والغياب' }
      : step === 'error'
      ? { title: 'حدث خطأ', subtitle: 'نعتذر عن الإزعاج، أعد المحاولة' }
      : step === 'invalid-link'
      ? { title: 'تعذّر فتح الرابط', subtitle: errorMsg }
      : step === 'submitting'
      ? { title: 'جاري إرسال البيانات', subtitle: 'لا تغلق الصفحة' }
      : { title: 'بطاقتي الرقمية — الكلية', subtitle: 'بوابة الطالب الرسمية' };

  return (
    <div className="sel-bg" dir="rtl">
      <div className="sel-shell">
        <header className="sel-header">
          <div className="sel-logo">
            <IdCard className="w-6 h-6" />
          </div>
          <div>
            <h1 className="sel-title">{headerCfg.title}</h1>
            <p className="sel-subtitle">{headerCfg.subtitle}</p>
          </div>
        </header>

        <main className="flex-1" style={{ minHeight: 0 }}>
          {step === 'loading' && (
            <div className="sel-card mt-6 sel-fade">
              <div className="sel-scan-wrap mb-4">
                <div className="sel-scan-icon"><ShieldCheck className="w-8 h-8" /></div>
                <div className="sel-pulse" />
              </div>
              <div className="sel-shimmer h-4 w-1/2 mx-auto mb-3" />
              <div className="sel-shimmer h-3 w-3/4 mx-auto" />
              <p className="text-center text-sm text-[#93A5C8] mt-6 font-semibold">
                جاري التحقق من صحة الرابط…
              </p>
            </div>
          )}

          {step === 'invalid-link' && (
            <div className="sel-card mt-6 sel-fade">
              <div className="sel-icon-circle sel-err-soft mx-auto"><AlertTriangle className="w-8 h-8" /></div>
              <h2 className="sel-heading text-center mt-4 mb-2">رابط غير صالح أو منتهٍ</h2>
              <p className="sel-muted text-center mb-6">{errorMsg}</p>
              <button type="button" className="sel-btn sel-btn-primary" onClick={onExit}>
                <ArrowLeft className="w-5 h-5" /> العودة للرئيسية
              </button>
            </div>
          )}

          {step === 'verify' && (
            <div className="mt-6">
              <VerifyIdStep
                roster={link?.type === 'attendance' ? stageStudents : []}
                expected={link?.type === 'attendance' ? undefined : expected}
                linkType={link?.type}
                onVerified={handleVerified}
                onCancel={() => { setErrorMsg(''); transitionTo('verify'); }}
              />
            </div>
          )}

          {step === 'confirm' && expected && (
            <div className="sel-card mt-6 sel-fade">
              <div className="text-center">
                <div className="sel-icon-circle sel-ok mx-auto"><BadgeCheck className="w-8 h-8" /></div>
                <h2 className="sel-heading mt-4 mb-1">تم تأكيد هويتك</h2>
                <p className="sel-muted mb-5">البيانات التالية مطابقة للسجل الرسمي</p>
              </div>

              <div className="sel-identity mb-5">
                <p className="sel-identity-label">الاسم</p>
                <p className="sel-identity-name">{expected.name}</p>
                {expected.code && (
                  <div className="mt-2 flex items-center justify-between border-t border-[#22355A] pt-2">
                    <p className="sel-identity-label">كود الطالب</p>
                    <p className="sel-identity-code">{expected.code}</p>
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-[#24365A] bg-[#132041] p-4 mb-5">
                <p className="text-sm font-bold text-[#7AA8F0] mb-3 flex items-center gap-2">
                  <Fingerprint className="w-5 h-5" /> خطوات تسجيل البصمة
                </p>
                <ul className="space-y-2 text-sm text-[#B7C6E2]">
                  <li className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-[#34D399]" /> وجّه وجهك داخل الدائرة</li>
                  <li className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-[#34D399]" /> أدر رأسك للجهات الخمس المطلوبة</li>
                  <li className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-[#34D399]" /> سيُحفظ الطلب ويُعرض على الأدمن للموافقة</li>
                </ul>
              </div>

              <div className="space-y-2">
                <button type="button" className="sel-btn sel-btn-primary" onClick={() => goTo('capture-face')}>
                  <ScanFace className="w-5 h-5" /> بدء التقاط البصمة
                </button>
                <button type="button" className="sel-btn sel-btn-ghost" onClick={() => goTo('verify')}>
                  <RefreshCw className="w-4 h-4" /> إعادة التحقق من البطاقة
                </button>
              </div>
            </div>
          )}

          {step === 'submitting' && (
            <div className="sel-card mt-6 sel-fade text-center">
              <div className="sel-scan-wrap">
                <div className="sel-scan-icon"><ScanFace className="w-8 h-8" /></div>
                <div className="sel-pulse" />
              </div>
              <h2 className="sel-heading mt-5 mb-1">جاري إرسال الطلب بأمان…</h2>
              <p className="sel-muted">يُحال طلبك إلى أدمن الكلية للمراجعة النهائية</p>
              <p className="sel-cam-hint mt-4">لا تغلق الصفحة حتى اكتمال الإرسال</p>
            </div>
          )}

          {step === 'error' && (
            <div className="sel-card mt-6 sel-fade">
              <div className="sel-icon-circle sel-err-soft mx-auto"><XCircle className="w-8 h-8" /></div>
              <h2 className="sel-heading text-center mt-4 mb-2">حدث خطأ</h2>
              <p className="sel-muted text-center mb-6">{errorMsg}</p>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" className="sel-btn sel-btn-ghost sel-btn-sm" onClick={onExit}>خروج</button>
                <button type="button" className="sel-btn sel-btn-primary sel-btn-sm" onClick={() => goTo(retryStep)}>إعادة</button>
              </div>
            </div>
          )}

          {step === 'report' && expected && (
            <ReportStep
              expected={expected}
              subjectName={subjectName}
              stats={getAttendanceStats()}
              sessionNameMap={sessionNameMap}
              onRestart={restart}
            />
          )}
        </main>

        <footer className="sel-footer">
          <div className="sel-footer-inner">
            بياناتك محمية ومشفّرة · تُحذف الصور بعد المعالجة
            <br />
            <div className="mt-1"><TextScramble text="ph.mujtabahaitham" /></div>
          </div>
        </footer>
      </div>
    </div>
  );
};

/* ──────────────────────────────────────── */
/*  خطوة تقرير الحضور (بنفس الثيم الفاتح)   */
/* ──────────────────────────────────────── */
const ReportStep: React.FC<{
  expected: Student;
  subjectName: string;
  stats: { present: number; absent: number; total: number; records: AttendanceRecord[] };
  sessionNameMap: Record<string, string>;
  onRestart: () => void;
}> = ({ expected, subjectName, stats, sessionNameMap, onRestart }) => (
  <div className="sel-fade">
    <div className="sel-report-hero">
      <div className="flex items-center gap-3 mb-2">
        <div className="bg-white/20 p-3 rounded-xl">
          <BookOpen className="w-6 h-6 text-white" />
        </div>
        <div>
          <p className="text-sm text-blue-100">المادة</p>
          <h1 className="text-xl font-extrabold text-white">{subjectName}</h1>
        </div>
      </div>
      <p className="text-blue-100/90 text-sm">تقرير الحضور والغياب — {new Date().toLocaleDateString('ar-IQ')}</p>
    </div>

    <div className="sel-card rounded-t-none rounded-b-2xl mt-0">
      <div className="flex items-center gap-3 p-1 mb-5">
        <div className="sel-option-icon">
          <Users className="w-6 h-6" />
        </div>
        <div>
          <p className="sel-identity-label">اسم الطالب</p>
          <h2 className="sel-identity-name">{expected.name}</h2>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="sel-stat sel-stat-green">
          <p className="text-xs font-semibold text-[#34D399] mb-1">حضور</p>
          <div className="sel-stat-num text-[#34D399]">{stats.present}</div>
        </div>
        <div className="sel-stat sel-stat-red">
          <p className="text-xs font-semibold text-[#F87171] mb-1">غياب</p>
          <div className="sel-stat-num text-[#F87171]">{stats.absent}</div>
        </div>
        <div className="sel-stat sel-stat-blue">
          <p className="text-xs font-semibold text-[#60A5FA] mb-1">المجموع</p>
          <div className="sel-stat-num text-[#60A5FA]">{stats.total}</div>
        </div>
      </div>

      {stats.records.length > 0 ? (
        <>
          <h3 className="text-sm font-extrabold text-[#F3F7FF] mb-3 flex items-center gap-2">
            <CalendarDays className="w-4 h-4 text-[#60A5FA]" /> تفاصيل الجلسات
          </h3>
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {stats.records.map(record => (
              <div key={record.id} className="sel-row-item">
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`flex items-center justify-center w-8 h-8 rounded-full shrink-0 ${
                    record.status === 'present' ? 'bg-[#0F3A2C] text-[#34D399]' : 'bg-[#3A1F28] text-[#F87171]'
                  }`}>
                    {record.status === 'present' ? <CheckCircle className="w-5 h-5" /> : <XCircle className="w-5 h-5" />}
                  </div>
                  <div className="text-right min-w-0">
                    <p className="font-bold text-[#F3F7FF] text-sm truncate">
                      {(record as any).sessionName || sessionNameMap[record.sessionId] || 'جلسة'}
                    </p>
                    <p className="text-xs text-[#93A5C8] tabular-nums">
                      {normalizeDate(record.date)}{record.time ? ` · ${record.time}` : ''}
                    </p>
                  </div>
                </div>
                <span className={`sel-pill ${record.status === 'present' ? 'sel-pill-green' : 'sel-pill-red'}`}>
                  {record.status === 'present' ? 'حاضر' : 'غائب'}
                </span>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="text-center py-8">
          <div className="sel-icon-circle sel-ok-soft mx-auto">
            <Clock className="w-8 h-8" />
          </div>
          <p className="sel-muted mt-4 mb-1 font-bold text-[#F3F7FF]">لا توجد سجلات بعد</p>
          <p className="sel-muted">عند تسجيل المحاضرات ستظهر بياناتك هنا</p>
        </div>
      )}

      <button type="button" className="sel-btn sel-btn-primary mt-6" onClick={onRestart}>
        <ScanFace className="w-5 h-5" /> إعادة تصوير الهوية
      </button>
    </div>
  </div>
);

export default SelfEnrollPage;