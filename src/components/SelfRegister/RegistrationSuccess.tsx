// src/components/SelfRegister/RegistrationSuccess.tsx
import React, { useEffect, useState } from 'react';
import { Student } from '../../types/student';

interface RegistrationSuccessProps {
  student: Student;
  matchPercentage: number;
  autoApproved: boolean;
  onExit: () => void;
}

export const RegistrationSuccess: React.FC<RegistrationSuccessProps> = ({
  student,
  matchPercentage,
  autoApproved,
  onExit,
}) => {
  const [showConfetti, setShowConfetti] = useState(true);
  
  useEffect(() => {
    const timer = setTimeout(() => setShowConfetti(false), 3000);
    return () => clearTimeout(timer);
  }, []);
  
  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-50 flex items-center justify-center p-4 relative overflow-hidden" dir="rtl">
      
      {/* Confetti animation */}
      {showConfetti && (
        <div className="absolute inset-0 pointer-events-none">
          {[...Array(50)].map((_, i) => (
            <div
              key={i}
              className="absolute w-2 h-2 rounded-full animate-confetti"
              style={{
                left: `${Math.random() * 100}%`,
                top: '-10px',
                backgroundColor: ['#10b981', '#8b5cf6', '#ec4899', '#f59e0b', '#3b82f6'][Math.floor(Math.random() * 5)],
                animationDelay: `${Math.random() * 2}s`,
                animationDuration: `${2 + Math.random() * 2}s`,
              }}
            />
          ))}
        </div>
      )}
      
      <div className="bg-white rounded-2xl shadow-2xl p-6 md:p-8 max-w-md w-full text-center relative z-10">
        
        {/* أيقونة النجاح */}
        <div className="mb-4">
          <div className="inline-flex items-center justify-center w-24 h-24 bg-gradient-to-br from-emerald-400 to-teal-500 rounded-full shadow-xl animate-bounce-slow">
            <svg className="w-14 h-14 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
        </div>
        
        <h2 className="text-3xl font-bold text-gray-800 mb-2">🎉 تم بنجاح!</h2>
        <p className="text-gray-600 mb-1">مرحباً <span className="font-bold text-emerald-700">{student.name}</span></p>
        
        {autoApproved ? (
          <div className="mt-4 p-4 bg-emerald-50 border-2 border-emerald-200 rounded-xl mb-4">
            <div className="text-4xl mb-2">✅</div>
            <p className="font-bold text-emerald-800 mb-1">تم تفعيل حسابك تلقائياً</p>
            <p className="text-sm text-emerald-700">
              تطابق الاسم: <strong>{matchPercentage}%</strong>
            </p>
            <p className="text-xs text-emerald-600 mt-2">
              يمكنك الآن تسجيل حضورك في الكلية باستخدام:
            </p>
            <div className="flex justify-center gap-3 mt-2">
              <span className="text-xs bg-white px-2 py-1 rounded-full border border-emerald-300">🪪 الهوية</span>
              <span className="text-xs bg-white px-2 py-1 rounded-full border border-emerald-300">😊 الوجه</span>
              <span className="text-xs bg-white px-2 py-1 rounded-full border border-emerald-300">🔢 الرمز</span>
            </div>
          </div>
        ) : (
          <div className="mt-4 p-4 bg-amber-50 border-2 border-amber-200 rounded-xl mb-4">
            <div className="text-4xl mb-2">⏳</div>
            <p className="font-bold text-amber-800 mb-1">في انتظار موافقة المشرف</p>
            <p className="text-sm text-amber-700">
              تطابق الاسم: <strong>{matchPercentage}%</strong>
            </p>
            <p className="text-xs text-amber-600 mt-2">
              تم إرسال طلبك للمراجعة. سيتم تفعيل حسابك قريباً بعد موافقة الأدمن.
            </p>
          </div>
        )}
        
        {/* معلومات إضافية */}
        <div className="bg-gray-50 rounded-xl p-3 mb-4 text-right">
          <p className="text-xs text-gray-500 mb-2 font-medium">📋 ما تم تسجيله:</p>
          <ul className="text-sm text-gray-700 space-y-1.5">
            <li className="flex items-center gap-2">
              <span className="text-emerald-600">✓</span>
              <span>التحقق من الهوية الرسمية</span>
            </li>
            <li className="flex items-center gap-2">
              <span className="text-emerald-600">✓</span>
              <span>ربط رمز QR للهوية</span>
            </li>
            <li className="flex items-center gap-2">
              <span className="text-emerald-600">✓</span>
              <span>تسجيل بصمة الوجه</span>
            </li>
          </ul>
        </div>
        
        {/* تنبيه الخصوصية */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
          <p className="text-xs text-blue-800">
            🔒 <strong>تم حذف جميع الصور</strong> من جهازك ومن النظام. تم حفظ معلومات التعرف عليك كأرقام رياضية فقط.
          </p>
        </div>
        
        <button
          onClick={onExit}
          className="w-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-bold py-3 rounded-xl active:scale-95 transition shadow-lg"
        >
          ✓ تم
        </button>
      </div>
      
      <style>{`
        @keyframes confetti {
          0% { transform: translateY(0) rotate(0deg); opacity: 1; }
          100% { transform: translateY(100vh) rotate(720deg); opacity: 0; }
        }
        .animate-confetti { animation: confetti linear forwards; }
        
        @keyframes bounce-slow {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-10px); }
        }
        .animate-bounce-slow { animation: bounce-slow 2s ease-in-out infinite; }
      `}</style>
    </div>
  );
};

export default RegistrationSuccess;