import React, { useMemo, useState } from 'react';
import { Download, ScanFace, ShieldCheck, TriangleAlert, X } from 'lucide-react';
import type { Student } from '../../types/student';
import { auditFaceDescriptors, auditIssuesToCsv, type AuditIssue } from '../../lib/faceAudit';

interface FaceAuditPanelProps {
  students: Student[];
  stageName?: string;
}

const KIND_LABEL: Record<AuditIssue['kind'], string> = {
  'duplicate-id': 'رقم مكرر',
  'weak-samples': 'بصمة ضعيفة',
  'mixed-samples': 'بصمة ملوّثة',
  'similar-face': 'وجهان متشابهان',
};

/** لوحة تدقيق بصمات المرحلة — قراءة فقط: تكشف ما يحتاج إعادة تسجيل (لا تكتب أي شيء) */
export const FaceAuditPanel: React.FC<FaceAuditPanelProps> = ({ students, stageName }) => {
  const [expanded, setExpanded] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [audit, setAudit] = useState<ReturnType<typeof auditFaceDescriptors> | null>(null);

  const withFaceCount = useMemo(
    () => students.filter(s => s.faceDescriptor).length,
    [students],
  );

  if (!expanded) {
    if (withFaceCount === 0) return null;
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="mb-4 px-4 py-2 bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-600 hover:to-indigo-700 text-white font-medium rounded-lg transition duration-200 shadow-md flex items-center justify-center gap-2"
        title="فحص بصمات المرحلة: أرقام مكرّرة، بصمات ملوّثة، وجوه متشابهة (قراءة فقط)"
      >
        <ScanFace className="w-4 h-4" /> تدقيق البصمات
      </button>
    );
  }

  const run = () => {
    setScanning(true);
    // إخراج الحساب من خيط الرسم حتى لا يتجمّد الواجهة
    window.setTimeout(() => {
      try {
        setAudit(
          auditFaceDescriptors(
            students.map(s => ({ id: s.id, name: s.name, faceDescriptor: s.faceDescriptor })),
          ),
        );
      } finally {
        setScanning(false);
      }
    }, 30);
  };

  const exportCsv = () => {
    if (!audit) return;
    const blob = new Blob([auditIssuesToCsv(audit)], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `تدقيق-البصمات-${stageName || 'المرحلة'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mb-4 p-4 bg-gradient-to-br from-sky-500/10 to-indigo-500/10 border-2 border-sky-500/30 rounded-lg animate-cardEnter">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <h3 className="text-sm font-bold text-sky-200 flex items-center gap-2">
          <ScanFace className="w-4 h-4 text-sky-400" /> تدقيق البصمات
          <span className="text-xs font-normal text-slate-400">
            (قراءة فقط{stageName ? ` — ${stageName}` : ''})
          </span>
        </h3>
        <button
          onClick={() => setExpanded(false)}
          className="text-slate-500 hover:text-slate-300 p-1"
          aria-label="إغلاق لوحة تدقيق البصمات"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {!audit ? (
        <div className="text-center py-4">
          <p className="text-xs text-slate-400 mb-3 leading-6">
            يفحص {withFaceCount} بصمة في هذه المرحلة: أرقام طلاب مكرّرة · بصمات ضعيفة ·
            بصمات «ملوّثة» (عيّناتها غير متسقة ⇒ شخص تسرّب إليها) · وجهان متشابهان.
            <br />
            <span className="text-sky-300">لا يغيّر أي بيانات — تقرير فقط.</span>
          </p>
          <button
            onClick={run}
            disabled={scanning}
            className="px-4 py-2 bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white font-medium rounded-lg transition flex items-center gap-2 mx-auto"
          >
            <ScanFace className="w-4 h-4" /> {scanning ? 'جاري الفحص…' : 'ابدأ الفحص'}
          </button>
        </div>
      ) : audit.issues.length === 0 ? (
        <div className="text-center py-6">
          <ShieldCheck className="w-12 h-12 text-emerald-400 mx-auto mb-2" />
          <p className="text-white font-bold">البصمات سليمة</p>
          <p className="text-xs text-slate-400 mt-1">
            فُحصت {audit.withFace} بصمة من {audit.totalStudents} طالب — لا نتائج مشبوهة.
          </p>
          <button onClick={run} className="mt-3 text-xs text-sky-300 hover:text-sky-200 underline">
            إعادة الفحص
          </button>
        </div>
      ) : (
        <>
          <div className="mb-3 p-2.5 bg-amber-500/10 border border-amber-500/30 rounded-lg flex items-center justify-between gap-3 flex-wrap">
            <p className="text-xs text-amber-200 flex items-center gap-2">
              <TriangleAlert className="w-4 h-4 shrink-0" />
              {audit.issues.length} ملاحظة · {audit.affectedIds.length} طالب يحتاج انتباهاً
            </p>
            <div className="flex items-center gap-2">
              <button onClick={run} className="text-xs text-sky-300 hover:text-sky-200 underline">
                إعادة الفحص
              </button>
              <button
                onClick={exportCsv}
                className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-100 text-xs rounded-lg transition flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" /> تصدير CSV
              </button>
            </div>
          </div>

          <ul className="space-y-1.5 max-h-[380px] overflow-y-auto pl-1">
            {audit.issues.map((issue, i) => (
              <li
                key={i}
                className={`p-2.5 rounded-lg border text-xs ${
                  issue.severity === 'high'
                    ? 'bg-red-500/10 border-red-500/30 text-red-200'
                    : 'bg-amber-500/10 border-amber-500/30 text-amber-200'
                }`}
              >
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="font-bold">{KIND_LABEL[issue.kind]}</span>
                  <span className="text-slate-300">· {issue.studentNames.join(' + ')}</span>
                </div>
                <p className="text-slate-300/90 leading-5">{issue.detail}</p>
              </li>
            ))}
          </ul>

          <p className="mt-3 text-[11px] text-slate-400 leading-5">
            بصمات «ملوّثة» و«وجهان متشابهان» تعني احتمال حفظ وجه شخص داخل حساب طالب آخر —
            الطالب يحتاج إعادة تسجيل بصمة جديدة عبر رابط «بصمة كود».
          </p>
        </>
      )}
    </div>
  );
};
