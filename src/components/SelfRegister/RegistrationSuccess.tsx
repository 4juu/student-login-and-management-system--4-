import React, { useEffect, useState } from 'react';
import { Student } from '../../types/student';
import { Check, CheckCircle2, ClipboardList, Clock, Lock, PartyPopper, Smile } from 'lucide-react';
import './selfRegister.css';

interface RegistrationSuccessProps {
  student: Student;
  qrVerified: boolean;
  onExit: () => void;
}

export const RegistrationSuccess: React.FC<RegistrationSuccessProps> = ({
  student,
  qrVerified,
  onExit,
}) => {
  const [showConfetti, setShowConfetti] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setShowConfetti(false), 3500);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="sel-bg relative overflow-hidden" dir="rtl">
      {/* Confetti خفيف في أول 3.5 ثوانٍ */}
      {showConfetti && (
        <div className="absolute inset-0 pointer-events-none z-0" aria-hidden>
          {[...Array(36)].map((_, i) => (
            <div
              key={i}
              className="absolute w-2 h-2 rounded-full animate-[sel-confetti_linear_forwards]"
              style={{
                left: `${Math.random() * 100}%`,
                top: '-10px',
                backgroundColor: ['#1458E2', '#10B981', '#6D28D9', '#F59E0B', '#3B82F6'][Math.floor(Math.random() * 5)],
                animationDelay: `${Math.random() * 2}s`,
                animationDuration: `${2 + Math.random() * 2}s`,
              }}
            />
          ))}
        </div>
      )}

      <div className="sel-shell relative z-10">
        <div className="sel-card text-center">
          <div className="sel-icon-circle sel-ok mx-auto">
            <Check className="w-9 h-9" />
          </div>

          <h2 className="sel-heading mt-5 mb-1 flex items-center justify-center gap-2">
            <PartyPopper className="w-6 h-6 text-[#34D399]" /> تم تسجيل طلبك بنجاح
          </h2>
          <p className="sel-muted mb-5">
            مرحباً <span className="font-bold text-[#F3F7FF]">{student.name}</span> — بياناتك وصلتنا بأمان
          </p>

          {qrVerified ? (
            <div className="rounded-2xl border border-[#1D5A45] bg-[#0F3A2C] p-4 mb-5">
              <div className="flex items-center gap-2 text-[#34D399] font-bold mb-1">
                <CheckCircle2 className="w-5 h-5" /> تم التحقق من رمز QR في البطاقة
              </div>
              <p className="text-sm text-[#34D399]">يمكنك الآن استخدام الهوية والوجه والرمز داخل الكلية</p>
            </div>
          ) : (
            <div className="rounded-2xl border border-[#5C4520] bg-[#33270F] p-4 mb-5 text-right">
              <p className="font-bold text-[#FBBF24] mb-1 flex items-center gap-2">
                <Clock className="w-5 h-5" /> بانتظار موافقة المشرف
              </p>
              <p className="text-sm text-[#E5B768] leading-relaxed">
                أُرسل طلب تسجيل وجهك للمراجعة. سيُفعَّل حسابك فور موافقة إدارة الكلية — وقد تلاحظ ذلك عبر إشعار الأدمن داخل النظام.
              </p>
            </div>
          )}

          <div className="rounded-2xl border border-[#24365A] bg-[#132041] p-4 mb-5 text-right">
            <p className="text-xs font-bold text-[#93A5C8] mb-2 flex items-center gap-1.5">
              <ClipboardList className="w-4 h-4 text-[#7AA8F0]" /> ما تم تسجيله:
            </p>
            <ul className="space-y-1.5 text-sm text-[#B7C6E2]">
              <li className="flex items-center gap-2">
                <Check className="w-4 h-4 text-[#34D399]" /> السم الشخصي المطابق للسجل الرسمي
              </li>
              <li className="flex items-center gap-2">
                <Check className="w-4 h-4 text-[#34D399]" /> بصمة الوجه (أرقام رياضية مشفّرة)
              </li>
              <li className="flex items-center gap-2">
                <Check className="w-4 h-4 text-[#34D399]" /> ربط الهوية بملف الطالب
              </li>
            </ul>
          </div>

          <div className="sel-note mb-6">
            <Lock className="w-4 h-4 shrink-0" />
            <span>
              <strong>تم حذف جميع الصور</strong> من جهازك ومن النظام. ما يُحفظ هو معلومات تعرّف رقمية فقط.
            </span>
          </div>

          <button type="button" className="sel-btn sel-btn-primary" onClick={onExit}>
            <Smile className="w-5 h-5" /> تم
          </button>
        </div>
      </div>

      <style>{`
        @keyframes sel-confetti {
          0%   { transform: translateY(0) rotate(0deg); opacity: 1; }
          100% { transform: translateY(100dvh) rotate(720deg); opacity: 0; }
        }
      `}</style>
    </div>
  );
};

export default RegistrationSuccess;