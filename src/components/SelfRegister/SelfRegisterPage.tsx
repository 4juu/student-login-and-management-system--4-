// src/components/SelfRegister/SelfRegisterPage.tsx
import React, { useState, useEffect } from 'react';
import { ref, get, push, set } from 'firebase/database';
import { database } from '../../firebase/config';
import { Student } from '../../types/student';
import {
  RegistrationLink,
  PendingRegistration,
  IDExtractionResult,
} from '../../types/registration';
import {
  getRegistrationLink,
  validateLink,
  markLinkAsUsed,
} from '../../services/tokenService';
import {
  matchArabicNames,
  classifyMatch,
  getMatchDescription,
  MIN_ACCEPTABLE_THRESHOLD,
} from '../../services/nameMatching';
import { terminateOCR } from '../../services/ocrService';
import { IDCardUpload } from './IDCardUpload';
import { FaceCaptureStep } from './FaceCaptureStep';
import { RegistrationSuccess } from './RegistrationSuccess';
import { getActiveAcademicYear } from '../../firebase/dataService';
import { SkeletonCard } from '../Skeleton';
import type { MultiDescriptor } from '../../services/faceRecognition';

type Step =
  | 'loading'
  | 'invalid-link'
  | 'enter-code'
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

// ============================================================
// 🧹 تنظيف عميق - يحذف undefined ويحول كل القيم لصيغ آمنة
// ============================================================
const deepSanitize = (obj: any): any => {
  if (obj === null || obj === undefined) return null;
  if (typeof obj === 'number' || typeof obj === 'string' || typeof obj === 'boolean') return obj;
  if (typeof obj === 'function') return null;
  if (obj instanceof Float32Array) return Array.from(obj);
  if (obj instanceof Set) return Array.from(obj);
  if (obj instanceof Map) return Object.fromEntries(obj);
  if (Array.isArray(obj)) {
    return obj
      .map(deepSanitize)
      .filter(v => v !== undefined && v !== null);
  }
  if (typeof obj === 'object') {
    const cleaned: any = {};
    for (const key in obj) {
      const val = obj[key];
      if (val === undefined) continue;
      const sanitized = deepSanitize(val);
      if (sanitized !== undefined) {
        cleaned[key] = sanitized;
      }
    }
    return cleaned;
  }
  return obj;
};

// ============================================================
// ✅ التحقق من صحة MultiDescriptor
// ============================================================
const validateMultiDescriptor = (desc: any): desc is MultiDescriptor => {
  if (!desc || typeof desc !== 'object') return false;
  if (!desc.main || !Array.isArray(desc.main)) return false;
  if (desc.main.length === 0) return false;
  return true;
};

export const SelfRegisterPage: React.FC<SelfRegisterPageProps> = ({ token, onExit }) => {
  const [step, setStep] = useState<Step>('loading');
  const [link, setLink] = useState<RegistrationLink | null>(null);
  const [student, setStudent] = useState<Student | null>(null);
  const [allStudents, setAllStudents] = useState<Student[]>([]);
  const [enteredCode, setEnteredCode] = useState('');
  const [codeError, setCodeError] = useState('');

  const [idData, setIdData] = useState<IDExtractionResult | null>(null);
  const [matchPercentage, setMatchPercentage] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');

  // ──────────────────────────────────────────
  // 🔍 تحميل بيانات الرابط
  // ──────────────────────────────────────────
  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const linkData = await getRegistrationLink(token);
        if (!mounted) return;

        const validation = validateLink(linkData);
        if (!validation.valid) {
          setErrorMsg(validation.reason || 'الرابط غير صالح');
          setStep('invalid-link');
          return;
        }

        setLink(linkData);

        if (linkData!.studentId) {
          await loadStudent(linkData!.adminUid, linkData!.stageId, linkData!.studentId);
          setStep('upload-id');
        } else {
          setStep('enter-code');
        }
      } catch (e: any) {
        console.error(e);
        setErrorMsg('فشل تحميل بيانات الرابط');
        setStep('invalid-link');
      }
    })();

    return () => {
      mounted = false;
      terminateOCR();
    };
  }, [token]);

  // ──────────────────────────────────────────
  // 📥 جلب بيانات طالب
  // ──────────────────────────────────────────
  const loadStudent = async (
    adminUid: string,
    stageId: string,
    studentId: string
  ): Promise<Student | null> => {
    try {
      const year = await getActiveAcademicYear();
      const path = `academicYears/${year}/userData/${adminUid}/stageData/${stageId}/students`;
      const snap = await get(ref(database, path));

      if (!snap.exists()) {
        setErrorMsg('لم نجد بيانات الطلاب');
        setStep('invalid-link');
        return null;
      }

      const data = snap.val();
      const studentsArr: Student[] = Array.isArray(data) ? data : Object.values(data);
      const found = studentsArr.find((s) => s.id === studentId);

      if (!found) {
        setErrorMsg('لم نجد بياناتك في النظام');
        setStep('invalid-link');
        return null;
      }

      setStudent(found);
      return found;
    } catch (e) {
      console.error(e);
      setErrorMsg('فشل جلب بيانات الطالب');
      setStep('invalid-link');
      return null;
    }
  };

  // ──────────────────────────────────────────
  // 🔢 إدخال الكود
  // ──────────────────────────────────────────
  const handleCodeSubmit = async () => {
    if (!link) return;
    setCodeError('');

    if (!/^\d{4}$/.test(enteredCode)) {
      setCodeError('الرمز يجب أن يكون 4 أرقام');
      return;
    }

    try {
      const year = await getActiveAcademicYear();
      const path = `academicYears/${year}/userData/${link.adminUid}/stageData/${link.stageId}/students`;
      const snap = await get(ref(database, path));

      if (!snap.exists()) {
        setCodeError('لم نجد بيانات الطلاب');
        return;
      }

      const data = snap.val();
      const studentsArr: Student[] = Array.isArray(data) ? data : Object.values(data);
      setAllStudents(studentsArr);
      const found = studentsArr.find((s) => s.code === enteredCode);

      if (!found) {
        setCodeError('❌ الرمز غير صحيح. تأكد من إدخال رمزك الصحيح.');
        return;
      }

      setStudent(found);
      setStep('upload-id');
    } catch (e) {
      console.error(e);
      setCodeError('فشل التحقق من الرمز');
    }
  };

  // ──────────────────────────────────────────
  // 📷 معالجة بيانات الهوية
  // ──────────────────────────────────────────
  const handleIDExtracted = (result: IDExtractionResult) => {
    if (!result.success || !result.name || !result.qrId || !student) {
      setErrorMsg(result.error || 'فشل قراءة الهوية');
      setStep('error');
      return;
    }

    setIdData(result);
    const percentage = matchArabicNames(result.name, student.name);
    setMatchPercentage(percentage);

    const matchLevel = classifyMatch(percentage);

    if (matchLevel === 'rejected') {
      setStep('name-mismatch');
    } else {
      setStep('capture-face');
    }
  };

  // ──────────────────────────────────────────
  // 😊 معالجة بصمة الوجه - النسخة النهائية
  // ──────────────────────────────────────────
  const handleFaceCaptured = async (faceDescriptor: MultiDescriptor) => {
    if (!student || !link || !idData) {
      console.error('❌ بيانات ناقصة:', { student, link, idData });
      setErrorMsg('بيانات ناقصة');
      setStep('error');
      return;
    }

    setStep('submitting');

    try {
      console.log('═══════════════════════════════════════');
      console.log('🎯 بدء حفظ التسجيل');
      console.log('═══════════════════════════════════════');
      console.log('📦 faceDescriptor المستلم:', faceDescriptor);
      console.log('📊 main length:', faceDescriptor?.main?.length);
      console.log('📊 angles length:', faceDescriptor?.angles?.length);
      console.log('📊 quality:', faceDescriptor?.quality);
      console.log('📊 directions:', faceDescriptor?.directions);

      // 1️⃣ التحقق من صحة البصمة
      if (!validateMultiDescriptor(faceDescriptor)) {
        throw new Error('صيغة بصمة الوجه غير صحيحة');
      }

      // 2️⃣ تنظيف عميق للبصمة (للأمان)
      const cleanFaceDescriptor = deepSanitize(faceDescriptor);
      console.log('✅ البصمة بعد التنظيف:', cleanFaceDescriptor);

      const matchLevel = classifyMatch(matchPercentage);
      const status: PendingRegistration['status'] =
        matchLevel === 'auto-approve' ? 'auto-approved' : 'pending';

      console.log('📌 status:', status);
      console.log('📌 matchPercentage:', matchPercentage);

      // 3️⃣ بناء بيانات الطلب
      const registrationData = {
        adminUid: link.adminUid,
        stageId: link.stageId,
        studentId: student.id,
        studentCode: student.code,
        nameFromID: idData.name!,
        nameInSystem: student.name,
        matchPercentage,
        qrCodeUrl: idData.qrUrl!,
        qrCodeId: idData.qrId!,
        faceDescriptor: cleanFaceDescriptor,
        status,
        createdAt: new Date().toISOString(),
        hasExistingQr: !!student.qrCodeId,
        hasExistingFace: !!student.faceDescriptor,
      };

      const cleanRegData = deepSanitize(registrationData);

      // 4️⃣ حفظ في pending
      console.log('💾 جاري حفظ pending...');
      const pendingRef = push(ref(database, `registrationSystem/pending/${link.adminUid}`));
      const requestId = pendingRef.key!;

      await set(pendingRef, { ...cleanRegData, id: requestId });
      console.log('✅ تم حفظ pending:', requestId);

      // 5️⃣ إذا التطابق عالي → حفظ على الطالب
      if (status === 'auto-approved') {
        console.log('🚀 auto-approved: جاري التحديث على الطالب...');

        const year = await getActiveAcademicYear();
        const studentsPath = `academicYears/${year}/userData/${link.adminUid}/stageData/${link.stageId}/students`;

        const snap = await get(ref(database, studentsPath));

        if (snap.exists()) {
          const data = snap.val();
          const studentsArr: Student[] = Array.isArray(data) ? data : Object.values(data);
          const idx = studentsArr.findIndex((s) => s.id === student.id);

          console.log('📍 index الطالب:', idx);

          if (idx !== -1) {
            // ✅ تحديث الطالب بالبصمة والـ QR
            const updatedStudent = deepSanitize({
              ...studentsArr[idx],
              qrCodeId: idData.qrId!,
              qrCodeUrl: idData.qrUrl!,
              faceDescriptor: cleanFaceDescriptor, // ← MultiDescriptor جاهز
              faceRegisteredAt: new Date().toISOString(),
              faceCompressed: true,
            });

            studentsArr[idx] = updatedStudent as Student;

            console.log('💾 جاري حفظ الطالب المحدث...');
            console.log('📦 faceDescriptor المحفوظ:', updatedStudent.faceDescriptor);
            console.log('📦 qrCodeId المحفوظ:', updatedStudent.qrCodeId);

            // التحقق النهائي قبل الحفظ
            if (!updatedStudent.faceDescriptor?.main) {
              throw new Error('faceDescriptor.main مفقود قبل الحفظ!');
            }

            await set(ref(database, studentsPath), studentsArr);

            console.log('✅✅✅ تم حفظ البصمة والـ QR على الطالب بنجاح!');
          } else {
            throw new Error('لم نجد بياناتك في قائمة الطلاب');
          }
        } else {
          throw new Error('قاعدة بيانات الطلاب فارغة');
        }
      } else {
        console.log('⏳ pending: في انتظار موافقة الأدمن');
      }

      // 6️⃣ تعليم الرابط كمستخدم
      await markLinkAsUsed(token, student.id);
      console.log('✅ تم تعليم الرابط كمستخدم');

      console.log('═══════════════════════════════════════');
      console.log('🎉 تم بنجاح كامل!');
      console.log('═══════════════════════════════════════');

      setStep('success');
    } catch (e: any) {
      console.error('═══════════════════════════════════════');
      console.error('❌ فشل حفظ التسجيل:');
      console.error('Error:', e);
      console.error('Message:', e.message);
      console.error('Stack:', e.stack);
      console.error('Code:', e.code);
      console.error('═══════════════════════════════════════');

      let userMessage = 'فشل إرسال طلب التسجيل';

      if (e.code === 'PERMISSION_DENIED') {
        userMessage = 'لا توجد صلاحية للحفظ. تواصل مع الإدارة لتحديث أذونات Firebase.';
      } else if (e.message?.includes('descriptor') || e.message?.includes('بصمة')) {
        userMessage = e.message;
      } else if (e.message) {
        userMessage = e.message;
      }

      setErrorMsg(userMessage);
      setStep('error');
    }
  };

  // ──────────────────────────────────────────
  // 📊 خطوات التسجيل
  // ──────────────────────────────────────────
  const stepLabels = ['التحقق', 'الهوية', 'البصمة', 'تأكيد'];
  const stepIcons = ['🔐', '🪪', '😊', '✅'];

  // ──────────────────────────────────────────
  // 🎨 RENDER
  // ──────────────────────────────────────────

  if (step === 'loading') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 to-pink-50 dark:from-gray-900 dark:to-gray-800 flex items-center justify-center p-4" dir="rtl">
        <div className="w-full max-w-md">
          <SkeletonCard />
        </div>
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
          <button
            onClick={onExit}
            className="bg-gray-600 hover:bg-gray-700 text-white font-bold py-3 px-6 rounded-lg w-full"
          >
            العودة للرئيسية
          </button>
        </div>
      </div>
    );
  }

  const renderStepIndicator = () => {
    const activeIdx = ['enter-code', 'upload-id', 'capture-face', 'success'].indexOf(step);
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

  if (step === 'enter-code') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 to-pink-50 flex items-center justify-center p-4" dir="rtl">
        <div className="bg-white rounded-2xl shadow-xl p-6 md:p-8 max-w-md w-full">
          {renderStepIndicator()}
          <div className="text-center mb-6">
            <div className="text-5xl mb-3">🔐</div>
            <h2 className="text-2xl font-bold text-gray-800 mb-2">التحقق من الهوية</h2>
            <p className="text-sm text-gray-600">أدخل رمزك المكون من 4 أرقام للبدء</p>
          </div>

          <input
            type="text"
            value={enteredCode}
            onChange={(e) => {
              const v = e.target.value.replace(/\D/g, '').slice(0, 4);
              setEnteredCode(v);
              setCodeError('');
            }}
            placeholder="0000"
            maxLength={4}
            inputMode="numeric"
            className="w-full text-center text-4xl font-bold tracking-[1em] py-4 border-2 border-purple-300 rounded-xl focus:border-purple-500 outline-none"
            autoFocus
          />

          {codeError && (
            <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm text-center">
              {codeError}
            </div>
          )}

          <button
            onClick={handleCodeSubmit}
            disabled={enteredCode.length !== 4}
            className="w-full mt-4 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 disabled:opacity-40 text-white font-bold py-3 rounded-lg transition active:scale-95"
          >
            ✓ متابعة
          </button>
        </div>
      </div>
    );
  }

  if (step === 'upload-id' && student) {
    return (
      <IDCardUpload
        student={student}
        onExtracted={handleIDExtracted}
        onCancel={onExit}
      />
    );
  }

  if (step === 'name-mismatch' && student && idData) {
    const desc = getMatchDescription(matchPercentage);
    return (
      <div className="min-h-screen bg-gradient-to-br from-red-50 to-orange-50 flex items-center justify-center p-4" dir="rtl">
        <div className="bg-white rounded-2xl shadow-xl p-6 md:p-8 max-w-md w-full">
          {renderStepIndicator()}
          <div className="text-center mb-6">
            <div className="text-5xl mb-3">{desc.emoji}</div>
            <h2 className="text-2xl font-bold text-red-700 mb-2">عدم تطابق الاسم</h2>
            <p className="text-sm text-gray-600">{desc.text}</p>
          </div>

          <div className="space-y-3 mb-6">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <p className="text-xs text-blue-600 font-medium mb-1">الاسم في الهوية:</p>
              <p className="font-bold text-blue-900">{idData.name}</p>
            </div>
            <div className="bg-purple-50 border border-purple-200 rounded-lg p-3">
              <p className="text-xs text-purple-600 font-medium mb-1">الاسم المسجل في النظام:</p>
              <p className="font-bold text-purple-900">{student.name}</p>
            </div>
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-center">
              <p className="text-sm text-red-700 font-bold">نسبة التطابق: {matchPercentage}%</p>
              <p className="text-xs text-red-600 mt-1">يجب أن تكون {MIN_ACCEPTABLE_THRESHOLD}% على الأقل</p>
            </div>
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4 text-xs text-amber-800">
            💡 تأكد من أن:
            <ul className="list-disc list-inside mt-1 space-y-0.5">
              <li>الهوية التي رفعتها هي هويتك أنت</li>
              <li>الرمز الذي أدخلته هو رمزك الصحيح</li>
              <li>صورة الهوية واضحة وقابلة للقراءة</li>
            </ul>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={onExit}
              className="py-3 bg-gray-200 text-gray-700 font-bold rounded-lg active:scale-95"
            >
              إلغاء
            </button>
            <button
              onClick={() => setStep('upload-id')}
              className="py-3 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-lg active:scale-95"
            >
              🔄 إعادة المحاولة
            </button>
          </div>
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
        onCancel={() => setStep('upload-id')}
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
    const matchLevel = classifyMatch(matchPercentage);
    return (
      <RegistrationSuccess
        student={student}
        matchPercentage={matchPercentage}
        autoApproved={matchLevel === 'auto-approve'}
        onExit={onExit}
      />
    );
  }

  if (step === 'error') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-red-50 to-orange-50 flex items-center justify-center p-4" dir="rtl">
        <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full text-center">
          <div className="text-6xl mb-4">❌</div>
          <h2 className="text-2xl font-bold text-red-700 mb-2">حدث خطأ</h2>
          <p className="text-gray-600 mb-6">{errorMsg}</p>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={onExit}
              className="py-3 bg-gray-200 text-gray-700 font-bold rounded-lg"
            >
              خروج
            </button>
            <button
              onClick={() => setStep('upload-id')}
              className="py-3 bg-purple-600 text-white font-bold rounded-lg"
            >
              🔄 إعادة
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
};

export default SelfRegisterPage;