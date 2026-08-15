import React, { useState, useEffect, lazy, Suspense, useCallback } from 'react';
import { ref, set } from 'firebase/database';
import { database, dbURL } from '../../firebase/config';
import { Student, AttendanceRecord } from '../../types/student';
import { RegistrationLink, IDExtractionResult } from '../../types/registration';
import {
  getRegistrationLink,
  validateLink,
} from '../../services/tokenService';
import {
  matchArabicNames,
} from '../../services/nameMatching';
import { IDCardUpload } from './IDCardUpload';
import { RegistrationSuccess } from './RegistrationSuccess';
import { getActiveAcademicYear } from '../../firebase/dataService';
import { SkeletonCard } from '../Skeleton';
import type { MultiDescriptor } from '../../services/faceRecognition';
import { AlertTriangle, XCircle, RotateCcw, CalendarDays, CheckCircle, XCircle as XCircleIcon, Users, BookOpen, ArrowLeft } from 'lucide-react';

const LazyFaceCaptureStep = lazy(() =>
  import('./FaceCaptureStep').then(m => ({ default: m.FaceCaptureStep }))
);

const MIN_MATCH = 90;

type Step =
  | 'loading'
  | 'invalid-link'
  | 'upload-id'
  | 'name-mismatch'
  | 'capture-face'
  | 'submitting'
  | 'success'
  | 'error'
  | 'attendance-report';

interface SelfRegisterPageProps {
  token: string;
  onExit: () => void;
}

const deepSanitize = (obj: any): any => {
  if (obj === null || obj === undefined) return null;
  if (typeof obj === 'number' || typeof obj === 'string' || typeof obj === 'boolean') return obj;
  if (typeof obj === 'function') return null;
  if (obj instanceof Float32Array) return Array.from(obj);
  if (obj instanceof Set) return Array.from(obj);
  if (obj instanceof Map) return Object.fromEntries(obj);
  if (Array.isArray(obj)) {
    return obj.map(deepSanitize).filter(v => v !== undefined && v !== null);
  }
  if (typeof obj === 'object') {
    const cleaned: any = {};
    for (const key in obj) {
      const val = obj[key];
      if (val === undefined) continue;
      const sanitized = deepSanitize(val);
      if (sanitized !== undefined) cleaned[key] = sanitized;
    }
    return cleaned;
  }
  return obj;
};

const dbFetch = async <T,>(path: string, signal?: AbortSignal): Promise<T | null> => {
  const url = `${dbURL}/${path}.json`;
  const res = await fetch(url, { signal });
  if (!res.ok) {
    console.warn('⚠️ dbFetch فشل:', url, res.status);
    return null;
  }
  return res.json() as Promise<T | null>;
};

const normalizeDate = (dateStr: string): string => {
  if (!dateStr) return '';
  const arabicNumbers = '٠١٢٣٤٥٦٧٨٩';
  const englishNumbers = '0123456789';
  let normalized = dateStr.replace(/[٠-٩]/g, (d) => englishNumbers[arabicNumbers.indexOf(d)]);
  normalized = normalized.replace(/[‏‎\u200E\u200F]/g, '').trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return normalized;

  const slashMatch = normalized.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const [, day, month, year] = slashMatch;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  return normalized;
};

export const SelfRegisterPage: React.FC<SelfRegisterPageProps> = ({ token, onExit }) => {
  const [step, setStep] = useState<Step>('loading');
  const [link, setLink] = useState<RegistrationLink | null>(null);
  const [student, setStudent] = useState<Student | null>(null);
  const [allStudents, setAllStudents] = useState<Student[]>([]);
  const [idData, setIdData] = useState<IDExtractionResult | null>(null);
  const [matchPercentage, setMatchPercentage] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[]>([]);
  const [matchedStudent, setMatchedStudent] = useState<Student | null>(null);

  const goTo = useCallback((s: Step) => { if (step !== s) setStep(s); }, [step]);

  const loadAllStudentsForStage = async (adminUid: string, stageId: string, signal: AbortSignal, linkYear?: string): Promise<Student[] | null> => {
    let year = linkYear || '';
    if (!year) {
      try { year = await getActiveAcademicYear(); } catch { year = ''; }
    }
    if (!year) { setErrorMsg('تعذر تحميل السنة الدراسية'); goTo('invalid-link'); return null; }

    const studentPath = `academicYears/${year}/userData/${adminUid}/stageData/${stageId}/students`;
    const data = await dbFetch<Record<string, Student> | Student[]>(studentPath, signal);
    if (!data) { setErrorMsg('لم نجد بيانات الطلاب'); goTo('invalid-link'); return null; }

    const studentsArr: Student[] = Array.isArray(data) ? data : Object.values(data);
    return studentsArr;
  };

  const loadAttendanceRecords = async (adminUid: string, stageId: string, studentId: string, linkYear?: string): Promise<AttendanceRecord[]> => {
    let year = linkYear || '';
    if (!year) {
      try { year = await getActiveAcademicYear(); } catch { year = ''; }
    }
    if (!year) return [];

    const recordsPath = `academicYears/${year}/userData/${adminUid}/stageData/${stageId}/attendanceRecords`;
    const data = await dbFetch<Record<string, AttendanceRecord> | AttendanceRecord[]>(recordsPath);
    if (!data) return [];

    const recordsArr: AttendanceRecord[] = Array.isArray(data) ? data : Object.values(data);
    return recordsArr.filter(r => r.studentId === studentId);
  };

  const findMatchingStudent = (extractedName: string, students: Student[]): { student: Student; percentage: number } | null => {
    let bestMatch: { student: Student; percentage: number } | null = null;
    for (const s of students) {
      const pct = matchArabicNames(s.name, extractedName);
      if (pct >= MIN_MATCH && (!bestMatch || pct > bestMatch.percentage)) {
        bestMatch = { student: s, percentage: pct };
      }
    }
    return bestMatch;
  };

  useEffect(() => {
    let mounted = true;
    const TIMEOUT = 20000;

    const globalTimeout = setTimeout(() => {
      if (!mounted) return;
      console.warn('⏱️ انتهى الوقت الكلي');
      setErrorMsg('تعذر الاتصال بقاعدة البيانات');
      goTo('invalid-link');
    }, TIMEOUT);

    (async () => {
      try {
        const linkData = await getRegistrationLink(token);
        if (!mounted) return;

        const validation = validateLink(linkData);
        if (!validation.valid) {
          setErrorMsg(validation.reason || 'الرابط غير صالح');
          goTo('invalid-link');
          return;
        }
        if (!linkData) {
          setErrorMsg('الرابط غير موجود');
          goTo('invalid-link');
          return;
        }

        setLink(linkData);

        if (linkData.type === 'attendance') {
          const ac = new AbortController();
          const studentTimeout = setTimeout(() => ac.abort(), TIMEOUT);
          try {
            const students = await loadAllStudentsForStage(linkData.adminUid, linkData.stageId, ac.signal, linkData.academicYear);
            if (mounted && students) {
              setAllStudents(students);
              goTo('upload-id');
            }
          } finally {
            clearTimeout(studentTimeout);
          }
        } else if (linkData.studentId) {
          const ac = new AbortController();
          const studentTimeout = setTimeout(() => ac.abort(), TIMEOUT);
          try {
            const s = await loadAllStudentsForStage(linkData.adminUid, linkData.stageId, ac.signal, linkData.academicYear);
            if (mounted && s) {
              const found = s.find((stu) => stu.id === linkData.studentId);
              if (found) {
                setStudent(found);
                setAllStudents(s);
                goTo('upload-id');
              } else {
                setErrorMsg('لم نجد بياناتك في النظام');
                goTo('invalid-link');
              }
            }
          } finally {
            clearTimeout(studentTimeout);
          }
        } else {
          setErrorMsg('هذا الرابط غير مرتبط بطالب محدد');
          goTo('invalid-link');
        }
      } catch (e: any) {
        if (e?.name === 'AbortError') {
          console.warn('⏱️ طلب Firebase انقطع');
          setErrorMsg('تعذر الاتصال بقاعدة البيانات');
        } else {
          console.error(e);
          setErrorMsg('فشل تحميل بيانات الرابط');
        }
        goTo('invalid-link');
      } finally {
        clearTimeout(globalTimeout);
      }
    })();

    return () => {
      mounted = false;
      clearTimeout(globalTimeout);
    };
  }, [token, goTo]);

  const handleIdExtracted = async (result: IDExtractionResult) => {
    try {
      setIdData(result);
      if (!link) return;

      const extractedName = result.name || result.fullName || '';

      if (link.type === 'attendance') {
        const match = findMatchingStudent(extractedName, allStudents);
        if (!match) {
          setMatchPercentage(0);
          goTo('name-mismatch');
          return;
        }
        setMatchPercentage(match.percentage);
        setMatchedStudent(match.student);

        const records = await loadAttendanceRecords(link.adminUid, link.stageId, match.student.id, link.academicYear);
        setAttendanceRecords(records);
        goTo('attendance-report');
        return;
      }

      if (!student) return;
      const pct = matchArabicNames(student.name, extractedName);
      setMatchPercentage(pct);

      if (pct < MIN_MATCH) {
        goTo('name-mismatch');
        return;
      }

      saveQRAsync(result).catch(e => console.warn('⚠️ فشل حفظ QR:', e));
      goTo('capture-face');
    } catch (e) {
      console.error('❌ خطأ في معالجة الهوية:', e);
      if (link?.type === 'attendance') {
        goTo('name-mismatch');
      } else {
        goTo('capture-face');
      }
    }
  };

  const saveQRAsync = async (result: IDExtractionResult) => {
    if (!student || !link || !result.qrId) return;
    try {
      const year = await getActiveAcademicYear();
      const path = `academicYears/${year}/userData/${link.adminUid}/stageData/${link.stageId}/students`;
      const data = await dbFetch<Record<string, Student> | Student[]>(path);
      if (data) {
        const arr: Student[] = Array.isArray(data) ? data : Object.values(data);
        const idx = arr.findIndex((s) => s.id === student.id);
        if (idx !== -1) {
          arr[idx] = { ...arr[idx], qrCodeId: result.qrId };
          await set(ref(database, path), arr);
        }
      }
    } catch (e) {
      console.warn('⚠️ فشل حفظ QR:', e);
    }
  };

  const handleFaceCaptured = async (descriptor: MultiDescriptor) => {
    if (!link || !student) return;
    goTo('submitting');
    const cleanFaceDescriptor = deepSanitize(descriptor);
    try {
      const requestId = `${student.id}_${Date.now()}`;
      const pendingRef = ref(database, `registrationSystem/pending/${link.adminUid}/${requestId}`);
      await set(pendingRef, {
        id: requestId,
        adminUid: link.adminUid,
        stageId: link.stageId,
        studentId: student.id,
        studentCode: student.code,
        nameFromID: idData?.name || '',
        nameInSystem: student.name,
        matchPercentage,
        qrCodeUrl: idData?.qrUrl || '',
        qrCodeId: idData?.qrId || '',
        faceDescriptor: cleanFaceDescriptor,
        status: 'pending',
        createdAt: new Date().toISOString(),
        hasExistingQr: !!student.qrCodeId,
        hasExistingFace: !!student.faceDescriptor,
      });
      set(ref(database, `registrationSystem/links/${token}/used`), true).catch((e) =>
        console.warn('⚠️ فشل تعليم الرابط كمستخدم:', e)
      );
      goTo('success');
    } catch (e: any) {
      console.error('❌ فشل حفظ:', e);
      setErrorMsg(e.code === 'PERMISSION_DENIED' ? 'لا توجد صلاحية' : e.message || 'فشل الحفظ');
      goTo('error');
    }
  };

  const handleRetryId = () => goTo('upload-id');

  const getAttendanceStats = () => {
    if (!matchedStudent) return { present: 0, absent: 0, total: 0, records: [] as any[] };

    const present = attendanceRecords.filter(r => r.status === 'present').length;
    const absent = attendanceRecords.filter(r => r.status === 'absent').length;

    const sortedRecords = [...attendanceRecords].sort((a, b) =>
      normalizeDate(b.date).localeCompare(normalizeDate(a.date))
    );

    return { present, absent, total: present + absent, records: sortedRecords };
  };

  const subjectName = link?.subjectName || link?.adminUid || 'المادة';

  if (step === 'loading') {
    return (
      <div className="min-h-screen bg-[#0B1220] flex items-center justify-center p-4" dir="rtl">
        <div className="w-full max-w-md"><SkeletonCard /></div>
      </div>
    );
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
          <button onClick={onExit} className="btn-base btn-primary w-full py-3">
            العودة للرئيسية
          </button>
        </div>
      </div>
    );
  }

  if (step === 'upload-id') {
    return (
      <div className="min-h-screen bg-[#0B1220] flex items-center justify-center p-4" dir="rtl">
        <div className="w-full max-w-md">
          <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-6">
            {link?.type === 'attendance' && (
              <div className="mb-6 p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
                <div className="flex items-center gap-3 mb-2">
                  <div className="bg-emerald-500/20 p-3 rounded-xl">
                    <BookOpen className="w-6 h-6 text-emerald-400" />
                  </div>
                  <div>
                    <p className="text-xs text-emerald-300">المادة</p>
                    <p className="text-lg font-bold text-emerald-300">{subjectName}</p>
                  </div>
                </div>
                <p className="text-sm text-emerald-300/80">ارفع هويتك الجامعية لعرض تقرير الحضور والغياب</p>
              </div>
            )}
            <IDCardUpload student={student || { id: '', name: '', code: '' } as Student} onExtracted={handleIdExtracted} onCancel={onExit} />
          </div>
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
          <h2 className="text-2xl font-bold text-white mb-2">الاسم غير متطابق</h2>
          <p className="text-sm text-white/50 mb-4">نسبة التطابق: {matchPercentage}% (المطلوب {MIN_MATCH}% فأكثر)</p>
          <div className="glass-card-sm p-4 mb-4 text-right">
            {matchedStudent ? (
              <p className="text-sm text-white/50">أقرب تطابق: <span className="text-white font-bold">{matchedStudent.name}</span></p>
            ) : (
              <>
                <p className="text-sm text-white/50">المستخرج من الهوية: <span className="text-white font-bold">{idData.name || idData.fullName}</span></p>
              </>
            )}
          </div>
          <p className="text-sm text-white/60 mb-6">الاسم في الهوية لا يتطابق مع أي طالب في هذه المرحلة. حاول تصوير الهوية بشكل أوضح أو تأكد من استخدام الهوية الصحيحة.</p>
          <button onClick={handleRetryId} className="btn-base btn-secondary w-full py-3">
            <RotateCcw className="w-4 h-4" /> إعادة التصوير
          </button>
        </div>
      </div>
    );
  }

  if (step === 'capture-face' && student) {
    return (
      <Suspense fallback={
        <div className="min-h-screen bg-[#0B1220] flex items-center justify-center p-4" dir="rtl">
          <div className="w-full max-w-md"><SkeletonCard /></div>
        </div>
      }>
        <LazyFaceCaptureStep
          student={student}
          matchPercentage={matchPercentage}
          allStudents={allStudents}
          onCaptured={handleFaceCaptured}
          onCancel={() => goTo('upload-id')}
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

  if (step === 'success' && student) {
    return <RegistrationSuccess student={student} matchPercentage={matchPercentage} autoApproved={false} onExit={onExit} />;
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

  if (step === 'attendance-report' && matchedStudent) {
    const { present, absent, total, records } = getAttendanceStats();

    return (
      <div className="min-h-screen bg-[#0B1220] flex items-center justify-center p-4" dir="rtl">
        <div className="w-full max-w-2xl">
          <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 overflow-hidden">
            {/* Header with Subject Name */}
            <div className="bg-gradient-to-r from-emerald-600 to-teal-600 p-6">
              <div className="flex items-center gap-3 mb-2">
                <div className="bg-white/20 p-3 rounded-xl">
                  <BookOpen className="w-7 h-7 text-white" />
                </div>
                <div>
                  <p className="text-sm text-emerald-100">مادة</p>
                  <h1 className="text-2xl font-bold text-white">{subjectName}</h1>
                </div>
              </div>
              <p className="text-emerald-100/80">تقرير الحضور والغياب للطالب</p>
            </div>

            {/* Student Name Card */}
            <div className="p-6 border-b border-white/10">
              <div className="flex items-center gap-4 bg-white/5 rounded-xl p-4">
                <div className="bg-emerald-500/20 p-4 rounded-xl">
                  <Users className="w-8 h-8 text-emerald-400" />
                </div>
                <div>
                  <p className="text-sm text-white/50">اسم الطالب</p>
                  <h2 className="text-2xl font-bold text-white">{matchedStudent.name}</h2>
                  <p className="text-sm text-white/40 font-mono">كود: {matchedStudent.code}</p>
                </div>
              </div>
            </div>

            {/* Stats Cards */}
            <div className="p-6 grid grid-cols-3 gap-3">
              <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-4 text-center">
                <div className="flex items-center justify-center gap-2 mb-1">
                  <CheckCircle className="w-5 h-5 text-green-400" />
                  <span className="text-sm font-medium text-green-300">حضور</span>
                </div>
                <div className="text-3xl font-bold text-green-300">{present}</div>
                <div className="text-xs text-green-500/70">يوم</div>
              </div>
              <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-center">
                <div className="flex items-center justify-center gap-2 mb-1">
                  <XCircleIcon className="w-5 h-5 text-red-400" />
                  <span className="text-sm font-medium text-red-300">غياب</span>
                </div>
                <div className="text-3xl font-bold text-red-300">{absent}</div>
                <div className="text-xs text-red-500/70">يوم</div>
              </div>
              <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4 text-center">
                <div className="flex items-center justify-center gap-2 mb-1">
                  <CalendarDays className="w-5 h-5 text-blue-400" />
                  <span className="text-sm font-medium text-blue-300">المجموع</span>
                </div>
                <div className="text-3xl font-bold text-blue-300">{total}</div>
                <div className="text-xs text-blue-500/70">جلسة</div>
              </div>
            </div>

            {/* Records List */}
            {records.length > 0 && (
              <div className="px-6 pb-6">
                <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                  <CalendarDays className="w-5 h-5 text-emerald-400" /> تفاصيل الجلسات
                </h3>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {records.map((record) => (
                    <div
                      key={record.id}
                      className="bg-white/5 border border-white/10 rounded-xl p-3 flex items-center justify-between"
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                          record.status === 'present' ? 'bg-green-500/20' : 'bg-red-500/20'
                        }`}>
                          {record.status === 'present' ? (
                            <CheckCircle className="w-5 h-5 text-green-400" />
                          ) : (
                            <XCircleIcon className="w-5 h-5 text-red-400" />
                          )}
                        </div>
                        <div className="text-right">
                          <p className="font-medium text-white">{record.sessionName || 'جلسة'}</p>
                          <p className="text-xs text-white/50 font-mono">
                            {normalizeDate(record.date)} {record.time && `• ${record.time}`}
                          </p>
                        </div>
                      </div>
                      <span className={`px-3 py-1 rounded-full text-xs font-bold ${
                        record.status === 'present'
                          ? 'bg-green-500/20 text-green-300'
                          : 'bg-red-500/20 text-red-300'
                      }`}>
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

            {/* Exit Button */}
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