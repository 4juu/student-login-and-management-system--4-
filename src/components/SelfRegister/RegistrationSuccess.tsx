// src/components/SelfRegister/RegistrationSuccess.tsx
import React from 'react';
import { Student } from '../../types/student';
import { Check, CircleCheck, ClipboardList, IdCard, LoaderCircle, ShieldCheck, QrCode, Smile } from 'lucide-react';

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
  return (
    <div className="min-h-screen bg-[#f4f6f8] flex items-center justify-center p-4" dir="rtl">
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 max-w-md w-full overflow-hidden">

        {/* شريط علوي رسمي */}
        <div className="bg-[#0e2a47] px-6 py-5 border-b-4 border-[#c9a227] text-center">
          <div className="mx-auto w-14 h-14 rounded-full bg-white/10 border border-white/25 flex items-center justify-center mb-2">
            <CircleCheck className="w-8 h-8 text-emerald-300" />
          </div>
          <h2 className="text-lg font-bold text-white">تم استلام طلب التسجيل</h2>
          <p className="text-xs text-slate-300 mt-1">نظام التحقق الإلكتروني للطلبة</p>
        </div>

        <div className="p-6 text-center">
          <p className="text-sm text-slate-500 mb-0.5">اسم الطالب</p>
          <p className="text-xl font-bold text-[#0e2a47] mb-5">{student.name}</p>

          {qrVerified ? (
            <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-lg mb-4 text-right">
              <div className="flex items-center gap-2 mb-2">
                <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0" />
                <p className="font-bold text-emerald-800 text-sm">تم التحقق من الهوية بنجاح</p>
              </div>
              <p className="text-xs text-emerald-700 leading-relaxed">
                تم التحقق من رمز QR الموجود على البطاقة، وسيُفعَّل حسابك فور مراجعة إدارة الكلية.
              </p>
              <div className="flex justify-center gap-2 mt-3">
                <span className="text-[11px] bg-white px-2.5 py-1 rounded-md border border-emerald-300 text-emerald-700 flex items-center gap-1"><IdCard className="w-3.5 h-3.5" /> الهوية</span>
                <span className="text-[11px] bg-white px-2.5 py-1 rounded-md border border-emerald-300 text-emerald-700 flex items-center gap-1"><Smile className="w-3.5 h-3.5" /> الوجه</span>
                <span className="text-[11px] bg-white px-2.5 py-1 rounded-md border border-emerald-300 text-emerald-700 flex items-center gap-1"><QrCode className="w-3.5 h-3.5" /> الرمز</span>
              </div>
            </div>
          ) : (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg mb-4 text-right">
              <div className="flex items-center gap-2 mb-2">
                <LoaderCircle className="w-5 h-5 text-amber-600 shrink-0 animate-spin" />
                <p className="font-bold text-amber-800 text-sm">بانتظار موافقة إدارة الكلية</p>
              </div>
              <p className="text-xs text-amber-700 leading-relaxed">
                لم يتم التحقق التلقائي من رمز QR على البطاقة، لذا يحتاج طلبك مراجعة يدوية. سيتم تفعيل حسابك بعد الموافقة.
              </p>
            </div>
          )}

          <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 mb-4 text-right">
            <p className="text-xs text-slate-500 mb-2.5 font-bold flex items-center gap-1.5">
              <ClipboardList className="w-4 h-4 text-slate-400" /> عناصر الطلب المُرسل
            </p>
            <ul className="text-sm text-slate-700 space-y-2">
              <li className="flex items-center gap-2">
                <Check className="w-4 h-4 text-[#0f766e]" />
                <span>التحقق من الهوية الرسمية</span>
              </li>
              <li className="flex items-center gap-2">
                <Check className="w-4 h-4 text-[#0f766e]" />
                <span>ربط رمز QR الخاص بالهوية</span>
              </li>
              <li className="flex items-center gap-2">
                <Check className="w-4 h-4 text-[#0f766e]" />
                <span>تسجيل بصمة الوجه</span>
              </li>
            </ul>
          </div>

          <div className="bg-white border border-slate-200 rounded-lg p-3 mb-5">
            <p className="text-[11px] text-slate-500 flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-[#0f766e] shrink-0" />
              <span>تم حذف جميع الصور من جهازك ومن النظام. حُفظت بيانات التعرّف كقيم رقمية مشفّرة فقط.</span>
            </p>
          </div>

          <button
            onClick={onExit}
            className="w-full bg-[#0e2a47] hover:bg-[#123a61] text-white font-bold py-3 rounded-lg active:scale-[0.99] transition flex items-center justify-center gap-1.5"
          >
            <Check className="w-5 h-5" /> تم
          </button>
        </div>
      </div>
    </div>
  );
};

export default RegistrationSuccess;
