import React, { useState, useEffect } from 'react';
import { ref, set } from 'firebase/database';
import { database, dbURL } from '../../firebase/config';
import { Student } from '../../types/student';
import { RegistrationLink, IDExtractionResult } from '../../types/registration';
import {
  getRegistrationLink,
  validateLink,
} from '../../services/tokenService';
import {
  matchArabicNames,
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

  const goTo = (s: Step) => { console.log('🔄 goTo:', s, 'current step:', step, 'willSet:', step !== s); if (step !== s) setStep(s); };

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
    console.log('📌 handleIdExtracted called', { hasStudent: !!student, hasLink: !!link, name: result.name });
    try {
      setIdData(result);
      if (!student || !link) { console.log('⛔ student/link null'); return; }
      const pct = matchArabicNames(student.name, result.name || result.fullName || '');
      console.log('📊 matchPercentage:', pct, 'MIN_MATCH:', MIN_MATCH);
      setMatchPercentage(pct);

      if (pct < MIN_MATCH) {
        console.log('🔀 going to name-mismatch');
        goTo('name-mismatch');
        return;
      }

      console.log('✅ match success, proceeding to capture-face');
      saveQRAsync(result).catch(e => console.warn('⚠️ فشل حفظ QR:', e));

      goTo('capture-face');
      console.log('✅ goTo capture-face called');
    } catch (e) {
      console.error('❌ خطأ في معالجة الهوية:', e);
      goTo('capture-face');
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
      await set(ref(database, `registrationSystem/links/${token}/used`), true);
      goTo('success');
    } catch (e: any) {
      console.error('❌ فشل حفظ:', e);
      setErrorMsg(e.code === 'PERMISSION_DENIED' ? 'لا توجد صلاحية' : e.message || 'فشل الحفظ');
      goTo('error');
    }
  };

  const handleRetryId = () => goTo('upload-id');

  if (step === 'loading') {
    return (
      <div className="min-h-screen bg-[#0A0A0F] flex items-center justify-center p-4" dir="rtl">
        <div className="w-full max-w-md"><SkeletonCard /></div>
      </div>
    );
  }

  if (step === 'invalid-link') {
    return (
      <div className="min-h-screen bg-[#0A0A0F] flex items-center justify-center p-4" dir="rtl">
        <div className="glass-card p-8 max-w-md w-full text-center">
          <div className="text-6xl mb-4">⚠️</div>
          <h2 className="text-2xl font-bold text-red-400 mb-2">رابط غير صالح</h2>
          <p className="text-white/60 mb-6">{errorMsg}</p>
          <button onClick={onExit} className="btn-base btn-primary w-full py-3">
            العودة للرئيسية
          </button>
        </div>
      </div>
    );
  }



  if (step === 'upload-id' && student) {
    return <IDCardUpload student={student} onExtracted={handleIdExtracted} onCancel={onExit} />;
  }

  if (step === 'name-mismatch' && student && idData) {
    return (
      <div className="min-h-screen bg-[#0A0A0F] flex items-center justify-center p-4" dir="rtl">
        <div className="glass-card p-8 max-w-md w-full text-center">
          <div className="text-6xl mb-4">⚠️</div>
          <h2 className="text-2xl font-bold text-white mb-2">الاسم غير متطابق</h2>
          <p className="text-sm text-white/50 mb-4">نسبة التطابق: {matchPercentage}% (المطلوب {MIN_MATCH}% فأكثر)</p>
          <div className="glass-card-sm p-4 mb-4 text-right">
            <p className="text-sm text-white/50">المسجل بالنظام: <span className="text-white font-bold">{student.name}</span></p>
            <p className="text-sm text-white/50">المستخرج من الهوية: <span className="text-white font-bold">{idData.name || idData.fullName}</span></p>
          </div>
          <p className="text-sm text-white/60 mb-6">الاسم في الهوية لا يتطابق مع الاسم المسجل في النظام. حاول تصوير الهوية بشكل أوضح أو تأكد من استخدام الهوية الصحيحة.</p>
          <button onClick={handleRetryId} className="btn-base btn-secondary w-full py-3">
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
      <div className="min-h-screen bg-[#0A0A0F] flex items-center justify-center p-4" dir="rtl">
        <div className="text-center">
          <div className="inline-block w-16 h-16 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mb-4" />
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
      <div className="min-h-screen bg-[#0A0A0F] flex items-center justify-center p-4" dir="rtl">
        <div className="glass-card p-8 max-w-md w-full text-center">
          <div className="text-6xl mb-4">❌</div>
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

  return null;
};
