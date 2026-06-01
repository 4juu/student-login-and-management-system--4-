import React, { useState, useEffect } from 'react';
import { ref, get, set } from 'firebase/database';
import { database, dbURL } from '../../firebase/config';
import { Student } from '../../types/student';
import { RegistrationLink, IDExtractionResult } from '../../types/registration';
import {
  getRegistrationLink,
  validateLink,
} from '../../services/tokenService';
import {
  matchArabicNames,
  getMatchDescription,
} from '../../services/nameMatching';
import { IDCardUpload } from './IDCardUpload';
import { FaceCaptureStep } from './FaceCaptureStep';
import { RegistrationSuccess } from './RegistrationSuccess';
import { getActiveAcademicYear } from '../../firebase/dataService';
import { SkeletonCard } from '../Skeleton';
import type { MultiDescriptor } from '../../services/faceRecognition';

const MIN_MATCH = 90;

type Step =
  | 'loading'
  | 'invalid-link'
  | 'upload-id'
  | 'name-mismatch'
  | 'capture-face'
  | 'submitting'
  | 'success'
  | 'error';

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

const validateMultiDescriptor = (desc: any): desc is MultiDescriptor => {
  if (!desc || typeof desc !== 'object') return false;
  if (!desc.main || !Array.isArray(desc.main)) return false;
  return desc.main.length > 0;
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

export const SelfRegisterPage: React.FC<SelfRegisterPageProps> = ({ token, onExit }) => {
  const [step, setStep] = useState<Step>('loading');
  const [link, setLink] = useState<RegistrationLink | null>(null);
  const [student, setStudent] = useState<Student | null>(null);
  const [allStudents, setAllStudents] = useState<Student[]>([]);
  const [idData, setIdData] = useState<IDExtractionResult | null>(null);
  const [matchPercentage, setMatchPercentage] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');

  const goTo = (s: Step) => { if (step !== s) setStep(s); };

  const loadStudent = async (adminUid: string, stageId: string, studentId: string, signal: AbortSignal, linkYear?: string): Promise<Student | null> => {
    let year = linkYear || '';
    if (!year) {
      try { year = await getActiveAcademicYear(); } catch { year = ''; }
    }
    if (!year) { setErrorMsg('تعذر تحميل السنة الدراسية'); goTo('invalid-link'); return null; }

    const studentPath = `academicYears/${year}/userData/${adminUid}/stageData/${stageId}/students`;
    console.log('📡 dbFetch loading students from:', `${dbURL}/${studentPath}.json`);
    const data = await dbFetch<Record<string, Student> | Student[]>(studentPath, signal);
    if (!data) { setErrorMsg('لم نجد بيانات الطلاب'); goTo('invalid-link'); return null; }

    const studentsArr: Student[] = Array.isArray(data) ? data : Object.values(data);
    setAllStudents(studentsArr);
    const found = studentsArr.find((s) => s.id === studentId);
    if (!found) { setErrorMsg('لم نجد بياناتك في النظام'); goTo('invalid-link'); return null; }
    setStudent(found);
    return found;
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

        setLink(linkData);

        if (linkData!.studentId) {
          const ac = new AbortController();
          const studentTimeout = setTimeout(() => ac.abort(), TIMEOUT);
          try {
            const s = await loadStudent(linkData!.adminUid, linkData!.stageId, linkData!.studentId, ac.signal, linkData!.academicYear);
            if (mounted && s) goTo('upload-id');
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
  }, [token]);

  const handleIdExtracted = async (result: IDExtractionResult) => {
    setIdData(result);
    if (!student || !link) return;
    const pct = matchArabicNames(student.name, result.name || result.fullName || '');
    setMatchPercentage(pct);

    if (pct < MIN_MATCH) {
      goTo('name-mismatch');
      return;
    }

    // حفظ QR في Firebase مباشرة
    try {
      const year = await getActiveAcademicYear();
      const path = `academicYears/${year}/userData/${link.adminUid}/stageData/${link.stageId}/students`;
      const data = await dbFetch<Record<string, Student> | Student[]>(path);
      if (data) {
        const arr: Student[] = Array.isArray(data) ? data : Object.values(data);
        const idx = arr.findIndex((s) => s.id === student.id);
        if (idx !== -1 && result.qrId) {
          arr[idx] = { ...arr[idx], qrCodeId: result.qrId };
          await set(ref(database, path), arr);
        }
      }
    } catch (e) {
      console.warn('⚠️ فشل حفظ QR:', e);
    }

    goTo('capture-face');
  };

  const handleFaceCaptured = async (descriptor: MultiDescriptor) => {
    if (!link || !student) return;
    goTo('submitting');
    const cleanFaceDescriptor = deepSanitize(descriptor);
    try {
      const year = await getActiveAcademicYear();
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
      await set(ref(database, `registrationSystem/links/${token}/used`), true);
      goTo('success');
    } catch (e: any) {
      console.error('❌ فشل حفظ:', e);
      setErrorMsg(e.code === 'PERMISSION_DENIED' ? 'لا توجد صلاحية' : e.message || 'فشل الحفظ');
      goTo('error');
    }
  };

  const handleRetryId = () => goTo('upload-id');

  const stepLabels = ['الهوية', 'البصمة', 'تأكيد'];
  const stepIcons = ['🪪', '😊', '✅'];

  if (step === 'loading') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 to-pink-50 dark:from-gray-900 dark:to-gray-800 flex items-center justify-center p-4" dir="rtl">
        <div className="w-full max-w-md"><SkeletonCard /></div>
      </div>
    );
  }

  if (step === 'invalid-link') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-red-50 to-orange-50 flex items-center justify-center p-4" dir="rtl">
        <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full text-center">
          <div className="text-6xl mb-4">⚠️</div>
          <h2 className="text-2xl font-bold text-red-700 mb-2">رابط غير صالح</h2>
          <p className="text-gray-600 mb-6">{errorMsg}</p>
          <button onClick={onExit} className="bg-gray-600 hover:bg-gray-700 text-white font-bold py-3 px-6 rounded-lg w-full">
            العودة للرئيسية
          </button>
        </div>
      </div>
    );
  }

  const renderStepIndicator = () => {
    const activeIdx = ['upload-id', 'capture-face', 'success'].indexOf(step);
    return (
      <div className="mb-6">
        <div className="flex items-center justify-between">
          {stepLabels.map((label, i) => {
            const isActive = i === activeIdx;
            const isDone = i < activeIdx;
            return (
              <div key={i} className="flex flex-col items-center flex-1 relative">
                {i > 0 && (
                  <div className={`absolute top-4 right-0 w-full h-0.5 -translate-y-1/2 ${isDone || isActive ? 'bg-purple-500' : 'bg-gray-200'}`} style={{ right: '50%', width: '100%', zIndex: 0 }} />
                )}
                <div className={`relative z-10 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-all duration-300 ${
                  isDone ? 'bg-purple-600 text-white' :
                  isActive ? 'bg-purple-600 text-white scale-110 shadow-md' :
                  'bg-gray-100 text-gray-400 border border-gray-200'
                }`}>
                  {isDone ? '✓' : stepIcons[i]}
                </div>
                <span className={`text-[10px] mt-1 font-medium transition-colors ${
                  isActive ? 'text-purple-700' :
                  isDone ? 'text-purple-500' :
                  'text-gray-400'
                }`}>{label}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  if (step === 'upload-id' && student) {
    return <IDCardUpload student={student} onExtracted={handleIdExtracted} onCancel={onExit} />;
  }

  if (step === 'name-mismatch' && student && idData) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-yellow-50 to-orange-50 flex items-center justify-center p-4" dir="rtl">
        <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full text-center">
          <div className="text-6xl mb-4">⚠️</div>
          <h2 className="text-2xl font-bold text-gray-800 mb-2">الاسم غير متطابق</h2>
          <p className="text-sm text-gray-500 mb-4">نسبة التطابق: {matchPercentage}% (المطلوب {MIN_MATCH}% فأكثر)</p>
          <div className="bg-gray-50 rounded-xl p-4 mb-4 text-right">
            <p className="text-sm text-gray-500">المسجل بالنظام: <span className="text-gray-800 font-bold">{student.name}</span></p>
            <p className="text-sm text-gray-500">المستخرج من الهوية: <span className="text-gray-800 font-bold">{idData.name || idData.fullName}</span></p>
          </div>
          <p className="text-sm text-gray-600 mb-6">الاسم في الهوية لا يتطابق مع الاسم المسجل في النظام. حاول تصوير الهوية بشكل أوضح أو تأكد من استخدام الهوية الصحيحة.</p>
          <button onClick={handleRetryId} className="w-full py-3 bg-gray-200 hover:bg-gray-300 text-gray-700 font-bold rounded-lg">
            🔄 إعادة التصوير
          </button>
        </div>
      </div>
    );
  }

  if (step === 'capture-face' && student) {
    return (
      <FaceCaptureStep
        student={student}
        matchPercentage={matchPercentage}
        allStudents={allStudents}
        onCaptured={handleFaceCaptured}
        onCancel={() => goTo('upload-id')}
      />
    );
  }

  if (step === 'submitting') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 to-pink-50 flex items-center justify-center p-4" dir="rtl">
        <div className="text-center">
          <div className="inline-block w-16 h-16 border-4 border-purple-500 border-t-transparent rounded-full animate-spin mb-4" />
          <p className="text-gray-700 font-bold text-lg">جاري إرسال البيانات...</p>
          <p className="text-sm text-gray-500 mt-2">لا تغلق الصفحة</p>
        </div>
      </div>
    );
  }

  if (step === 'success' && student) {
    return <RegistrationSuccess student={student} matchPercentage={matchPercentage} autoApproved={false} onExit={onExit} />;
  }

  if (step === 'error') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-red-50 to-orange-50 flex items-center justify-center p-4" dir="rtl">
        <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full text-center">
          <div className="text-6xl mb-4">❌</div>
          <h2 className="text-2xl font-bold text-red-700 mb-2">حدث خطأ</h2>
          <p className="text-gray-600 mb-6">{errorMsg}</p>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={onExit} className="py-3 bg-gray-200 text-gray-700 font-bold rounded-lg">خروج</button>
            <button onClick={() => goTo('upload-id')} className="py-3 bg-purple-600 text-white font-bold rounded-lg">إعادة</button>
          </div>
        </div>
      </div>
    );
  }

  return null;
};
