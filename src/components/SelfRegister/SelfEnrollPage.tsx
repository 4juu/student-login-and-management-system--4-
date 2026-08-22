import React, { useState, useEffect, lazy, Suspense, useCallback } from 'react';
import { ref, set, get } from 'firebase/database';
import { database, dbURL } from '../../firebase/config';
import { Student, AttendanceRecord } from '../../types/student';
import { RegistrationLink, IDExtractionResult } from '../../types/registration';
import { getRegistrationLink, validateLink } from '../../services/tokenService';
import { findNameInOCRText } from '../../services/nameMatching';
import { IDCardUpload } from './IDCardUpload';
import { RegistrationSuccess } from './RegistrationSuccess';
import { getActiveAcademicYear, loadAttendanceRecords, loadSessions } from '../../firebase/dataService';
import { decompressRecord } from '../../firebase/dataServiceCompressed';
import { SkeletonCard } from '../Skeleton';
import type { FaceGalleryDescriptor } from '../../services/faceAI/descriptors';
import { AlertTriangle, XCircle, CalendarDays, CheckCircle, Users, BookOpen, ArrowLeft, ScanFace } from 'lucide-react';

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

interface TaggedStudent { student: Student; stageId: string; }

const deepSanitize = (obj: any): any => {
  if (obj === null || obj === undefined) return null;
  if (typeof obj === 'number' || typeof obj === 'string' || typeof obj === 'boolean') return obj;
  if (typeof obj === 'function') return null;
  if (obj instanceof Float32Array) return Array.from(obj);
  if (obj instanceof Set) return Array.from(obj);
  if (obj instanceof Map) return Object.fromEntries(obj);
  if (Array.isArray(obj)) return obj.map(deepSanitize).filter(v => v != null);
  if (typeof obj === 'object') {
    const cleaned: any = {};
    for (const key in obj) {
      if (obj[key] === undefined) continue;
      const s = deepSanitize(obj[key]);
      if (s !== undefined) cleaned[key] = s;
    }
    return cleaned;
  }
  return obj;
};

const dbFetch = async <T,>(path: string, signal?: AbortSignal): Promise<T | null> => {
  const url = `${dbURL}/${path}.json`;
  const res = await fetch(url, { signal });
  if (!res.ok) return null;
  return res.json() as Promise<T | null>;
};

const normalizeDate = (dateStr: string): string => {
  if (!dateStr) return '';
  const arabicNums = '٠١٢٣٤٥٦٧٨٩';
  const engNums = '0123456789';
  let n = dateStr.replace(/[٠-٩]/g, d => engNums[arabicNums.indexOf(d)]).replace(/[‏‎\u200E\u200F]/g, '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(n)) return n;
  const m = n.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return n;
};

export const SelfEnrollPage: React.FC<SelfEnrollPageProps> = ({ token, onExit }) => {
  const [step, setStep] = useState<Step>('loading');
  const [link, setLink] = useState<RegistrationLink | null>(null);
  const [allStudents, setAllStudents] = useState<TaggedStudent[]>([]);
  const [idData, setIdData] = useState<IDExtractionResult | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[]>([]);
  const [matched, setMatched] = useState<TaggedStudent | null>(null);
  const [sessionNameMap, setSessionNameMap] = useState<Record<string, string>>({});

  const goTo = useCallback((s: Step) => setStep(prev => prev === s ? prev : s), []);

  const loadAllStudentsForAdmin = async (adminUid: string, year: string): Promise<TaggedStudent[]> => {
    const base = `academicYears/${year}/userData/${adminUid}/stageData`;
    const snap = await get(ref(database, base));
    const out: TaggedStudent[] = [];
    if (snap.exists()) {
      const stagesObj = snap.val() as Record<string, any>;
      for (const stageId of Object.keys(stagesObj)) {
        const students = stagesObj[stageId]?.students;
        if (!students) continue;
        const arr: Student[] = Array.isArray(students) ? students : Object.values(students);
        for (const s of arr) if (s && s.id) out.push({ student: s as Student, stageId });
      }
    }
    return out;
  };

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

    if (records.length === 0 && lnk.subjectName) {
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
        records = all.filter(r => r.studentId === studentId && r.subjectName === lnk.subjectName);
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

        setLink(linkData);

        let year = linkData.academicYear || '';
        if (!year) { try { year = await getActiveAcademicYear(); } catch { year = ''; } }
        if (!year) { setErrorMsg('تعذر تحميل السنة الدراسية'); goTo('invalid-link'); return; }

        const ac = new AbortController();
        const st = setTimeout(() => ac.abort(), TIMEOUT);
        try {
          const tagged = await loadAllStudentsForAdmin(linkData.adminUid, year);
          if (!mounted) return;
          if (tagged.length === 0) {
            setErrorMsg('لم نجد بيانات طلاب لربط بصمتك بها');
            goTo('invalid-link');
            return;
          }
          setAllStudents(tagged);

          // رابط فردي مربوط بطالب محدد → تجاوز رفع الهوية وانتقل مباشرة لالتقاط البصمة
          if (linkData.type === 'single' && linkData.studentId) {
            const bound = tagged.find(t => t.student.id === linkData.studentId);
            if (bound) {
              setMatched(bound);
              goTo('capture-face');
              return;
            }
            setErrorMsg('لم نجد بيانات الطالب المرتبط بهذا الرابط');
            goTo('invalid-link');
            return;
          }

          goTo('upload-id');
        } finally { clearTimeout(st); }
      } catch (e: any) {
        if (!mounted) return;
        setErrorMsg(e?.name === 'AbortError' ? 'تعذر الاتصال بقاعدة البيانات' : 'فشل تحميل بيانات الرابط');
        goTo('invalid-link');
      } finally { clearTimeout(globalTimeout); }
    })();

    return () => { mounted = false; clearTimeout(globalTimeout); };
  }, [token, goTo]);

  const matchStudent = (result: IDExtractionResult): TaggedStudent | null => {
    let best: { t: TaggedStudent; confidence: number } | null = null;
    if (result.ocrText) {
      for (const t of allStudents) {
        const check = findNameInOCRText(t.student.name, result.ocrText);
        if (check.matched && (!best || check.confidence > best.confidence)) {
          best = { t, confidence: check.confidence };
        }
      }
    }
    if (best) return best.t;
    if (result.qrId) {
      const byQr = allStudents.find(t =>
        t.student.universityId === result.qrId || t.student.qrCodeId === result.qrId
      );
      if (byQr) return byQr;
    }
    return null;
  };

  const handleIdExtracted = async (result: IDExtractionResult) => {
    try {
      setIdData(result);
      if (!link) return;

      if (allStudents.length === 0) {
        setErrorMsg('لم نجد بيانات طلاب لربط بصمتك بها');
        goTo('invalid-link');
        return;
      }

      const found = matchStudent(result);
      if (found) {
        setMatched(found);
        if (link.type === 'attendance') {
          const { records, sessionNameMap: namesMap } = await loadStageRecordsForStudent(link, found.student.id);
          setAttendanceRecords(records);
          setSessionNameMap(namesMap);
          goTo('attendance-report');
        } else {
          goTo('confirm');
        }
      } else {
        goTo('name-mismatch');
      }
    } catch (e) {
      console.error('❌ خطأ في معالجة الهوية:', e);
      goTo('name-mismatch');
    }
  };

  const handleFaceCaptured = async (descriptor: FaceGalleryDescriptor) => {
    if (!link || !matched) return;
    goTo('submitting');
    const cleanFD = deepSanitize(descriptor);
    try {
      const requestId = `${matched.student.id}_${Date.now()}`;
      const qrCodeId = idData?.qrId || matched.student.qrCodeId || '';
      await set(ref(database, `registrationSystem/pending/${link.adminUid}/${requestId}`), {
        id: requestId,
        adminUid: link.adminUid,
        stageId: matched.stageId,
        studentId: matched.student.id,
        studentCode: matched.student.code,
        nameInSystem: matched.student.name,
        nameFromCard: matched.student.name,
        nationalId: idData?.qrId || idData?.nationalId || '',
        qrCodeUrl: idData?.qrUrl || '',
        qrCodeId,
        qrVerified: !!idData?.qrId,
        nameMatched: true,
        faceDescriptor: cleanFD,
        status: 'pending',
        createdAt: new Date().toISOString(),
        hasExistingQr: !!matched.student.qrCodeId,
        hasExistingFace: !!matched.student.faceDescriptor,
      });
      // رابط مخصص لطالب واحد فقط يُعلَّم مستخدماً — أما الرابط العام فيبقى متاحاً للجميع
      if (link.type === 'single') {
        await set(ref(database, `registrationSystem/links/${token}/used`), true).catch(() => {});
      }
      goTo('success');
    } catch (e: any) {
      setErrorMsg(e.code === 'PERMISSION_DENIED' ? 'لا توجد صلاحية' : e.message || 'فشل الحفظ');
      goTo('error');
    }
  };

  const getAttendanceStats = () => {
    if (!matched) return { present: 0, absent: 0, total: 0, records: [] as any[] };
    const present = attendanceRecords.filter(r => r.status === 'present').length;
    const absent = attendanceRecords.filter(r => r.status === 'absent').length;
    const sortedRecords = [...attendanceRecords].sort((a, b) => normalizeDate(b.date).localeCompare(normalizeDate(a.date)));
    return { present, absent, total: present + absent, records: sortedRecords };
  };

  const subjectName = link?.subjectName || link?.adminUid || 'المادة';

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

  if (step === 'upload-id') {
    return (
      <div className="min-h-screen bg-[#0B1220] flex items-center justify-center p-4" dir="rtl">
        <div className="w-full max-w-md">
          <div className="text-center mb-5">
            <div className="mx-auto w-14 h-14 rounded-full bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center mb-3">
              <ScanFace className="w-7 h-7 text-indigo-400" />
            </div>
            <h2 className="text-xl font-bold text-white">تسجيل بصمة الوجه الذاتي</h2>
            <p className="text-sm text-white/50 mt-1">ارفع صورة الهوية ليتعرّف النظام على اسمك تلقائياً</p>
          </div>
          <IDCardUpload student={{ id: '', name: '', code: '' } as Student} onExtracted={handleIdExtracted} onCancel={onExit} />
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
          <h2 className="text-2xl font-bold text-white mb-2">تعذّر التعرّف على الطالب</h2>
          <div className="glass-card-sm p-4 mb-4 text-right space-y-2">
            {idData.ocrText && (
              <p className="text-sm text-white/50">النصوص المستخرجة: <span className="text-white/80 font-mono text-xs break-all">{idData.ocrText.slice(0, 300)}</span></p>
            )}
            {idData.qrId && (
              <p className="text-sm text-white/50">رمز QR: <span className="text-white/80 font-mono text-xs">{idData.qrId}</span></p>
            )}
          </div>
          <p className="text-sm text-white/60 mb-6">
            لم نتمكن من مطابقة البطاقة مع أي طالب في النظام. تأكد أن الاسم على الهوية مطابق لما في النظام وحاول التصوير بوضوح.
          </p>
          <button onClick={() => goTo('upload-id')} className="btn-base btn-secondary w-full py-3">
            <XCircle className="w-4 h-4" /> إعادة تصوير الهوية
          </button>
        </div>
      </div>
    );
  }

  if (step === 'confirm' && matched) {
    const student = matched.student;
    const barcode = idData?.qrId || student.qrCodeId || '';
    return (
      <div className="min-h-screen bg-[#0B1220] flex items-center justify-center p-4" dir="rtl">
        <div className="glass-card p-8 max-w-md w-full text-center">
          <div className="mx-auto w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mb-4">
            <CheckCircle className="w-8 h-8 text-emerald-400" />
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">تم التعرّف عليك</h2>
          <div className="bg-white/5 rounded-xl p-4 mb-4 text-right space-y-2">
            <p className="text-sm text-white/50">الاسم: <span className="text-white font-bold">{student.name}</span></p>
            <p className="text-sm text-white/50">الكود: <span className="text-white font-mono">{student.code}</span></p>
            {barcode && (
              <p className="text-sm text-white/50">الباركود: <span className="text-emerald-300 font-mono">{barcode}</span></p>
            )}
            {idData?.qrId && (
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

  if (step === 'capture-face' && matched) {
    return (
      <Suspense fallback={<div className="min-h-screen bg-[#0B1220] flex items-center justify-center p-4" dir="rtl"><div className="w-full max-w-md"><SkeletonCard /></div></div>}>
        <LazySelfCapture
          student={matched.student}
          allStudents={allStudents.map(t => t.student)}
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

  if (step === 'success' && matched) {
    return <RegistrationSuccess student={matched.student} qrVerified={!!idData?.qrId} onExit={onExit} />;
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
            <button onClick={() => goTo('upload-id')} className="btn-base btn-primary py-3">إعادة</button>
          </div>
        </div>
      </div>
    );
  }

  if (step === 'attendance-report' && matched) {
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
                  <h2 className="text-2xl font-bold text-white">{matched.student.name}</h2>
                  <p className="text-sm text-white/40 font-mono">كود: {matched.student.code}</p>
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
                          <p className="font-medium text-white">{record.sessionName || sessionNameMap[record.sessionId] || 'جلسة'}</p>
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
