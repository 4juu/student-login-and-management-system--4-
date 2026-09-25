import React, { useState } from 'react';
import { AlertTriangle, BadgeCheck, Check, RefreshCw, UserCheck } from 'lucide-react';
import type { Student } from '../../types/student';
import { matchesExpectedName } from '../../services/cardMatch';

interface VerifyNameStepProps {
  expected: Student | null | undefined;
  onVerified: (student: Student) => void;
  onCancel: () => void;
}

type Screen = 'input' | 'result';

const Stepper = ({ current }: { current: 1 | 2 | 3 }) => {
  const steps = ['اكتب اسمك', 'تأكيد الاسم', 'المتابعة'];
  return (
    <div className="sel-steps" role="navigation" aria-label="خطوات التحقق">
      {steps.map((label, i) => {
        const n = (i + 1) as 1 | 2 | 3;
        const state = n < current ? 'done' : n === current ? 'active' : '';
        return (
          <div key={n} className={`sel-step ${state}`}>
            <div className="sel-step-dot">
              {n < current ? <Check className="w-3.5 h-3.5" /> : n}
            </div>
            <span className="sel-step-label">{label}</span>
          </div>
        );
      })}
    </div>
  );
};

/**
 * خطوة التحقق بكتابة الاسم — لروابط «بصمة كود»
 * الطالب يكتب اسمه ويُطابق مع اسم صاحب الرابط، وإذا طابق ينتقل لباقي
 * خطوات التسجيل نفسها (تأكيد → التقاط الوجه → إرسال)
 */
export const VerifyNameStep: React.FC<VerifyNameStepProps> = ({ expected, onVerified, onCancel }) => {
  const [screen, setScreen] = useState<Screen>('input');
  const [typed, setTyped] = useState('');
  const [error, setError] = useState('');
  const [score, setScore] = useState(0);

  if (!expected) {
    return (
      <div className="sel-fade">
        <div className="sel-card text-center">
          <div className="sel-icon-circle sel-err-soft"><AlertTriangle className="w-8 h-8" /></div>
          <h2 className="sel-heading mt-4 mb-2">هذا الرابط غير مرتبط بأي طالب</h2>
          <p className="sel-muted mb-5">اطلب رابطاً جديداً من إدارة الكلية.</p>
          <button type="button" className="sel-btn sel-btn-ghost" onClick={onCancel}>رجوع</button>
        </div>
      </div>
    );
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const r = matchesExpectedName(typed, expected.name);
    if (r.matched) {
      setError('');
      setScore(r.score);
      setScreen('result');
    } else {
      setError('الاسم غير مطابق — تأكد من كتابة اسمك كما هو مسجّل ثم أعد المحاولة.');
    }
  };

  const handleRetry = () => {
    setTyped('');
    setError('');
    setScore(0);
    setScreen('input');
  };

  if (screen === 'result') {
    return (
      <div className="sel-fade">
        <span role="status" aria-live="polite" className="sr-only">تم التعرف على الاسم بنجاح</span>
        <Stepper current={3} />
        <div className="sel-card">
          <div className="text-center">
            <div className="sel-icon-circle sel-ok">
              <Check className="w-8 h-8" />
            </div>
            <h2 className="sel-heading mt-4 mb-1">تم التعرف عليك</h2>
            <p className="sel-muted mb-5">تحقّق من تطابق البيانات ثم أكمل</p>

            <div className="sel-identity mb-5">
              <p className="sel-identity-label">الاسم</p>
              <p className="sel-identity-name">{expected.name}</p>
              {expected.code && (
                <div className="mt-2 flex justify-between border-t border-[#22355A] pt-2">
                  <p className="sel-identity-label">كود الطالب</p>
                  <p className="sel-identity-code">{expected.code}</p>
                </div>
              )}
            </div>

            <div className="mb-5 flex justify-center">
              <span className="sel-chip sel-chip-green">نسبة التطابق {score}%</span>
            </div>

            <div className="space-y-2">
              <button type="button" className="sel-btn sel-btn-primary" onClick={() => onVerified(expected)}>
                <BadgeCheck className="w-5 h-5" /> نعم، هذه هويتي
              </button>
              <button type="button" className="sel-btn sel-btn-ghost" onClick={handleRetry}>
                <RefreshCw className="w-4 h-4" /> إعادة الكتابة
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="sel-fade">
      <Stepper current={1} />
      <div className="sel-card">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-extrabold text-[#F3F7FF]">التحقق من الهوية الجامعية</h2>
          <span className="sel-chip sel-chip-violet">بصمة كود — بكتابة الاسم</span>
        </div>

        <p className="sel-muted mb-5">
          اكتب اسمك كما هو مسجّل في الجامعة — يُطابق الاسم مع سجل هذا الرابط قبل تسجيل البصمة.
        </p>

        <form onSubmit={handleSubmit} className="space-y-3">
          <label className="block text-sm font-bold text-[#93A5C8] mb-1">
            اسم الطالب الكامل
            <input
              type="text"
              dir="rtl"
              autoComplete="name"
              aria-label="اسم الطالب الكامل"
              value={typed}
              onChange={e => { setTyped(e.target.value); if (error) setError(''); }}
              placeholder="مثال: مجتبى هيثم محمد محسن"
              aria-invalid={!!error}
              aria-describedby={error ? 'namecheck-error' : undefined}
              className="sel-input w-full mt-1.5"
            />
          </label>

          {error && (
            <div id="namecheck-error" role="alert" className="p-3 bg-[#3A1F28] border border-[#5C2B35] rounded-xl text-red-300 text-sm flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={!typed.trim()}
            className="sel-btn sel-btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <UserCheck className="w-5 h-5" /> تحقق من اسمي
          </button>
        </form>

        <div className="sel-note mt-5">
          <Check className="w-4 h-4 shrink-0" />
          <span>يُطابق الاسم داخل جهازك — لا نعرض صورك ولا نرسل بياناتك لأي طرف.</span>
        </div>
      </div>
    </div>
  );
};

export default VerifyNameStep;
