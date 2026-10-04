import React, { useEffect, useState } from 'react';
import { Activity, Download, Eraser, ScanFace, ShieldCheck, TriangleAlert, X } from 'lucide-react';
import type { Student } from '../../types/student';
import { auditFaceDescriptors, auditIssuesToCsv, type AuditIssue } from '../../lib/faceAudit';
import {
  attemptsToCsv,
  clearAttempts,
  decisionLabelAr,
  getAttempts,
  reasonLabelAr,
  sourceLabelAr,
} from '../../services/faceAI/matchDiagnostics';

interface FaceAuditPanelProps {
  students: Student[];
  stageName?: string;
}

const KIND_LABEL: Record<AuditIssue['kind'], string> = {
  'duplicate-id': 'معرّف مكرر',
  'duplicate-code': 'رمز مكرر',
  'duplicate-university-id': 'رقم جامعي مكرر',
  'duplicate-qr': 'QR مكرر',
  'weak-samples': 'بصمة ضعيفة',
  'similar-face': 'وجهان متشابهان',
};

const DECISION_STYLE: Record<string, string> = {
  accept: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  reject: 'bg-red-500/15 text-red-300 border-red-500/30',
  unknown: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
};

/** لوحة تدقيق بصمات المرحلة — قراءة فقط: تكشف ما يحتاج إعادة تسجيل (لا تكتب أي شيء) */
export const FaceAuditPanel: React.FC<FaceAuditPanelProps> = ({ students, stageName }) => {
  const [expanded, setExpanded] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [audit, setAudit] = useState<ReturnType<typeof auditFaceDescriptors> | null>(null);
  const [attempts, setAttempts] = useState(() => getAttempts());

  // سجل التشخيص يُكتب من مسارات المسح خارج React ⇒ نُحدّثه بنبضة خفيفة أثناء الفتح
  useEffect(() => {
    if (!expanded) return;
    setAttempts(getAttempts());
    const id = window.setInterval(() => setAttempts(getAttempts()), 2000);
    return () => window.clearInterval(id);
  }, [expanded]);

  if (!expanded) {
    // اللوحة تُفتح حتى لو ما فيه بصمات — فحص الأرقام المكرّرة يهم وحده
    if (students.length === 0 && attempts.length === 0) return null;
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="btn-base btn-secondary"
        title="فحص بصمات المرحلة: أرقام مكرّرة، بصمات ضعيفة، وجوه متشابهة (قراءة فقط)"
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
            students.map(s => ({
              id: s.id,
              name: s.name,
              code: s.code,
              universityId: s.universityId,
              qrCodeId: s.qrCodeId,
              faceDescriptor: s.faceDescriptor,
            })),
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

  const exportDiagCsv = () => {
    const blob = new Blob([attemptsToCsv()], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `تشخيص-المطابقة-${stageName || 'المرحلة'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const clearDiag = () => {
    clearAttempts();
    setAttempts(getAttempts());
  };

  return (
    <div className="p-4 sm:p-6 bg-gradient-to-br from-sky-500/10 to-indigo-500/10 border-2 border-sky-500/30 rounded-lg animate-cardEnter">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <h3 className="text-base sm:text-lg font-semibold text-sky-200 flex items-center gap-2">
          <ScanFace className="w-4 h-4 text-sky-400" /> تدقيق البصمات
          <span className="text-xs font-normal text-slate-400">
            (قراءة فقط{stageName ? ` — ${stageName}` : ''})
          </span>
        </h3>
        <button
          onClick={() => setExpanded(false)}
          className="min-h-10 min-w-10 inline-flex items-center justify-center text-slate-500 hover:text-slate-300 transition-colors duration-200"
          aria-label="إغلاق لوحة تدقيق البصمات"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {!audit ? (
        <div className="text-center py-4">
          <p className="text-xs text-slate-400 mb-3 leading-6">
            يفحص {students.length} طالباً: أي رقم مكرّر (الرمز/الجامعي/QR/المعرّف) · بصمات ضعيفة ·
            وجهان متشابهان.
            <br />
            <span className="text-sky-300">لا يغيّر أي بيانات — تقرير فقط.</span>
          </p>
          <button
            onClick={run}
            disabled={scanning}
            className="btn-base btn-primary disabled:opacity-50"
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
          <button onClick={run} className="mt-3 btn-base btn-secondary text-xs px-3">
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
              <button onClick={run} className="btn-base btn-secondary text-xs px-3">
                إعادة الفحص
              </button>
              <button
                onClick={exportCsv}
                className="btn-base btn-secondary text-xs px-3"
              >
                <Download className="w-3.5 h-3.5" /> تصدير CSV
              </button>
            </div>
          </div>

          <ul className="space-y-1.5 max-h-[380px] overflow-y-auto pe-1">
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
            «وجهان متشابهان» يعني احتمال حفظ وجه شخص داخل حساب طالب آخر —
            الطالب يحتاج إعادة تسجيل بصمة جديدة عبر رابط «بصمة كود».
          </p>
        </>
      )}

      {/* ── تشخيص المطابقة: لماذا قُبل/رُفض كل محاولة (للأدمن، بالذاكرة فقط) ── */}
      <div className="mt-4 pt-4 border-t border-white/10">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
          <h4 className="text-sm font-semibold text-slate-300 flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5 text-violet-400" /> تشخيص المطابقة
            <span className="font-normal text-slate-500">
              ({attempts.length} محاولة{attempts.length >= 200 ? ' — وصلت الحدّ الأقصى' : ''} · بالذاكرة فقط)
            </span>
          </h4>
          <div className="flex items-center gap-2">
            <button
              onClick={exportDiagCsv}
              disabled={attempts.length === 0}
              className="btn-base btn-secondary text-xs px-3 disabled:opacity-40"
            >
              <Download className="w-3 h-3" /> CSV
            </button>
            <button
              onClick={clearDiag}
              disabled={attempts.length === 0}
              className="btn-base btn-secondary text-xs px-3 disabled:opacity-40"
            >
              <Eraser className="w-3 h-3" /> مسح
            </button>
          </div>
        </div>

        {attempts.length === 0 ? (
          <p className="text-[11px] text-slate-500 leading-5 py-2">
            لا محاولات بعد في هذه الجلسة — يُسجَّل كل قبول/رفض/غير معروف عند وقوعه،
            ويختفي بالكامل عند إغلاق الصفحة (لا يُحفظ في أي قاعدة بيانات).
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="glass-table w-full text-[11px] border-collapse">
              <thead>
                <tr className="text-slate-400 text-start border-b border-white/10">
                  <th className="py-1.5 px-1.5 font-medium">الوقت</th>
                  <th className="py-1.5 px-1.5 font-medium">المصدر</th>
                  <th className="py-1.5 px-1.5 font-medium">القرار</th>
                  <th className="py-1.5 px-1.5 font-medium">سبب القرار</th>
                  <th className="py-1.5 px-1.5 font-medium">الطالب</th>
                  <th className="py-1.5 px-1.5 font-medium">أفضل %</th>
                  <th className="py-1.5 px-1.5 font-medium">الثاني %</th>
                  <th className="py-1.5 px-1.5 font-medium">الفرق %</th>
                  <th className="py-1.5 px-1.5 font-medium">اتفاق</th>
                </tr>
              </thead>
              <tbody>
                {attempts.map(a => (
                  <tr key={a.attemptId} className="border-b border-white/5 text-slate-300">
                    <td className="py-1.5 px-1.5 font-mono text-slate-400 whitespace-nowrap">
                      {new Date(a.at).toLocaleTimeString('en-GB', { hour12: false })}
                    </td>
                    <td className="py-1.5 px-1.5">{sourceLabelAr(a.source)}</td>
                    <td className="py-1.5 px-1.5">
                      <span
                        className={`inline-block px-1.5 py-0.5 rounded border text-[10px] font-bold ${
                          DECISION_STYLE[a.decision] ?? DECISION_STYLE.unknown
                        }`}
                      >
                        {decisionLabelAr(a.decision)}
                      </span>
                    </td>
                    <td className="py-1.5 px-1.5">{reasonLabelAr(a.reason)}</td>
                    <td className="py-1.5 px-1.5">
                      {a.studentName ?? a.bestId ?? '—'}
                      {a.studentId && a.studentName ? (
                        <span className="text-slate-500 font-mono"> ({a.studentId})</span>
                      ) : null}
                    </td>
                    <td className="py-1.5 px-1.5 font-mono">{a.bestScore ?? '—'}</td>
                    <td className="py-1.5 px-1.5 font-mono">{a.secondScore ?? '—'}</td>
                    <td className="py-1.5 px-1.5 font-mono">{a.margin ?? '—'}</td>
                    <td className="py-1.5 px-1.5 font-mono">
                      {a.totalFrames ? `${a.agreement}/${a.totalFrames}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
