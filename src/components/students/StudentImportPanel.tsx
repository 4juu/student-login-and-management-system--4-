import React from 'react';
import { FolderOpen, Hash, IdCard, Lightbulb, QrCode, SquarePen, Upload, Users } from 'lucide-react';
import { MorphingSquare } from '../MorphingSquare';

interface StudentImportPanelProps {
  selectedPrefix: number;
  importLoading: boolean;
  importMessage: string;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onPrefixSelect: (prefix: number) => void;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export const StudentImportPanel: React.FC<StudentImportPanelProps> = ({
  selectedPrefix,
  importLoading,
  importMessage,
  fileInputRef,
  onPrefixSelect,
  onFileChange,
}) => {
  return (
    <div className="mb-6 p-5 bg-gradient-to-br from-blue-500/10 to-indigo-500/10 border-2 border-blue-500/30 rounded-lg">
      <h3 className="text-lg font-bold text-white mb-3 flex items-center gap-2">
        <FolderOpen className="w-5 h-5 text-blue-400" /> استيراد الطلاب من ملف Excel
      </h3>
      <div className="mb-4 text-sm text-slate-400 space-y-1">
        <p>اختر بادئة الكود ثم ارفع الملف. سيتم اكتشاف الحقول التالية تلقائياً:</p>
        <div className="flex flex-wrap gap-2 mt-2">
          <span className="px-2 py-1 bg-blue-500/15 text-blue-300 rounded text-xs font-medium inline-flex items-center gap-1"><SquarePen className="w-3 h-3" /> الاسم</span>
          <span className="px-2 py-1 bg-indigo-500/15 text-indigo-300 rounded text-xs font-medium inline-flex items-center gap-1"><Users className="w-3 h-3" /> الكروب (A1, B2, ...)</span>
          <span className="px-2 py-1 bg-purple-500/15 text-purple-300 rounded text-xs font-medium inline-flex items-center gap-1"><IdCard className="w-3 h-3" /> الرقم الجامعي (8-15 رقم)</span>
          <span className="px-2 py-1 bg-emerald-500/15 text-emerald-300 rounded text-xs font-medium inline-flex items-center gap-1"><QrCode className="w-3 h-3" /> رمز QR (رابط الوزارة الكامل)</span>
        </div>
        <p className="text-xs text-emerald-300 mt-2 bg-emerald-500/10 p-2 rounded border border-emerald-500/30 flex items-start gap-1">
          <Lightbulb className="w-4 h-4 shrink-0 mt-0.5" /> <strong>نصيحة:</strong> الصق الرابط الكامل من هوية الوزارة بأي عمود، وسيتم استخراج رمز QR تلقائياً لكل طالب.
        </p>
      </div>

      <div className="mb-4">
        <label className="block text-sm font-medium text-slate-300 mb-2">اختر بادئة الكود:</label>
        <div className="flex flex-wrap gap-2">
          {[1, 2, 3, 4, 5].map((num) => (
            <button
              key={num}
              type="button"
              onClick={() => onPrefixSelect(num)}
              className={`w-14 h-14 rounded-lg font-bold text-lg transition duration-200 ${
                selectedPrefix === num
                  ? 'bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-lg scale-110'
                  : 'bg-white/10 text-slate-200 border-2 border-slate-600 hover:border-blue-400'
              }`}
            >
              {num}
            </button>
          ))}
        </div>
        <p className="text-xs text-slate-400 mt-2 flex items-center gap-1">
          <Hash className="w-3.5 h-3.5" /> الأكواد ستبدأ من: <strong>{selectedPrefix}001</strong>
        </p>
      </div>

      <div className="flex items-center gap-3">
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          onChange={onFileChange}
          className="hidden"
          id="excel-upload"
          disabled={importLoading}
        />
        <label
          htmlFor="excel-upload"
          className={`flex-1 cursor-pointer bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-medium py-3 px-6 rounded-md transition duration-200 shadow-md flex items-center justify-center gap-2 ${
            importLoading ? 'opacity-50 cursor-not-allowed' : ''
          }`}
        >
          {importLoading ? <><MorphingSquare size="sm" /> جاري المعالجة...</> : <><Upload className="w-4 h-4" /> رفع ملف Excel</>}
        </label>
      </div>

      {importMessage && (
        <div className="mt-4 p-3 bg-green-500/10 border border-green-500/30 text-green-300 rounded-md" dir="rtl">
          {importMessage}
        </div>
      )}
    </div>
  );
};
