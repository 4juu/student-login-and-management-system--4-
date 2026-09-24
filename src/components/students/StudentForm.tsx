import React from 'react';
import { IdCard, Lightbulb, Plus, QrCode } from 'lucide-react';
import { Field } from '../ui/field';

interface StudentFormProps {
  name: string;
  code: string;
  group: string;
  universityId: string;
  qrCodeId: string;
  error: string;
  onNameChange: (value: string) => void;
  onCodeChange: (value: string) => void;
  onGroupChange: (value: string) => void;
  onUniversityIdChange: (value: string) => void;
  onQrCodeIdChange: (value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
}

export const StudentForm: React.FC<StudentFormProps> = ({
  name,
  code,
  group,
  universityId,
  qrCodeId,
  error,
  onNameChange,
  onCodeChange,
  onGroupChange,
  onUniversityIdChange,
  onQrCodeIdChange,
  onSubmit,
}) => {
  return (
    <form onSubmit={onSubmit} className="mb-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Field label="اسم الطالب" required>
          {(f) => (
            <input
              {...f}
              type="text"
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              className="w-full px-4 py-2 border border-slate-600 bg-slate-800 text-white placeholder:text-slate-500 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="أدخل اسم الطالب"
              dir="rtl"
            />
          )}
        </Field>

        <Field label="رمز الطالب (4 أرقام)" required hint="من 1000 إلى 9999">
          {(f) => (
            <input
              {...f}
              type="text"
              value={code}
              onChange={(e) => {
                const value = e.target.value.replace(/\D/g, '');
                if (value.length <= 4) onCodeChange(value);
              }}
              maxLength={4}
              className="w-full px-4 py-2 border border-slate-600 bg-slate-800 text-white placeholder:text-slate-500 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent text-center text-lg font-bold"
              placeholder="1001"
              inputMode="numeric"
            />
          )}
        </Field>

        <Field label="الكروب (اختياري)">
          {(f) => (
            <input
              {...f}
              type="text"
              value={group}
              onChange={(e) => onGroupChange(e.target.value.toUpperCase())}
              className="w-full px-4 py-2 border border-slate-600 bg-slate-800 text-white placeholder:text-slate-500 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent text-center"
              placeholder="A1"
            />
          )}
        </Field>

        <Field
          label={
            <span className="flex items-center gap-1">
              <IdCard className="w-4 h-4" /> الرقم الجامعي
              <span className="text-xs text-blue-400">(اختياري)</span>
            </span>
          }
          hint="رقم الهوية الجامعية"
        >
          {(f) => (
            <input
              {...f}
              type="text"
              value={universityId}
              onChange={(e) => onUniversityIdChange(e.target.value.replace(/\D/g, ''))}
              className="w-full px-4 py-2 border border-slate-600 bg-slate-800 text-white placeholder:text-slate-500 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent text-center font-mono"
              placeholder="8886736221"
              inputMode="numeric"
            />
          )}
        </Field>
      </div>

      <div className="mt-4 p-4 bg-gradient-to-br from-emerald-500/10 to-teal-500/10 border-2 border-emerald-500/30 rounded-lg">
        <Field
          label={
            <span className="flex items-center gap-2">
              <QrCode className="w-5 h-5 text-emerald-300" />
              <span>رمز QR الهوية</span>
              <span className="text-xs font-normal text-emerald-300 bg-white/10 px-2 py-0.5 rounded-full">
                اختياري - للمسح السريع
              </span>
            </span>
          }
          labelClassName="text-emerald-300! font-bold!"
          hint={
            <span className="flex items-start gap-1 text-emerald-300">
              <Lightbulb className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                يمكنك لصق <strong>الرابط الكامل</strong> من هوية الوزارة وسيتم استخراج الرمز تلقائياً،
                أو تركه فارغاً ليتم الربط تلقائياً عند أول مسح للهوية.
              </span>
            </span>
          }
        >
          {(f) => (
            <input
              {...f}
              type="text"
              value={qrCodeId}
              onChange={(e) => onQrCodeIdChange(e.target.value)}
              className="w-full px-4 py-2 border border-emerald-500/30 bg-slate-800 text-white placeholder:text-slate-500 rounded-md focus:ring-2 focus:ring-emerald-500 focus:border-transparent font-mono text-sm"
              placeholder="ألصق هنا: https://sis.mohesr.gov.iq/verify?id=... أو الرمز مباشرة"
              dir="ltr"
            />
          )}
        </Field>
      </div>

      <div className="mt-4 flex justify-end">
        <button
          type="submit"
          className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-8 rounded-md transition duration-200 flex items-center gap-2"
        >
          <Plus className="w-4 h-4" /> إضافة طالب
        </button>
      </div>

      {error && (
        <div className="mt-4 p-3 bg-red-500/10 border border-red-500/30 text-red-300 rounded-md" role="alert" dir="rtl">
          {error}
        </div>
      )}
    </form>
  );
};
