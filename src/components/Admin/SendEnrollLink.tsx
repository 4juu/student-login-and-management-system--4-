// src/components/Admin/SendEnrollLink.tsx
import React, { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useModalBehavior } from '../../hooks/useModalBehavior';
import { Student, Stage, College } from '../../types/student';
import { createBulkRegistrationLinks } from '../../services/tokenService';
import {
  Check, Clock, Copy, FileSpreadsheet, Landmark, Library, Link2, LoaderCircle,
  Rocket, Smartphone, Users, ScanFace, UserCheck,
} from 'lucide-react';

interface SendEnrollLinkProps {
  adminUid: string;
  colleges: College[];
  stages: Stage[];
  loadStudents: (stageId: string) => Promise<Student[]>;
  onClose: () => void;
}

interface StudentLinkRow {
  student: Student;
  url: string;
  copied: boolean;
}

const FILE_PREFIX = 'enroll_links';

const getFormattedDate = () => {
  const now = new Date();
  return {
    date: now.toLocaleDateString('ar-IQ', { year: 'numeric', month: 'long', day: 'numeric' }),
    timestamp: now.getTime(),
  };
};

const getFileName = (collegeName: string, stageName: string): string => {
  const { timestamp } = getFormattedDate();
  const cleanCollege = collegeName.replace(/[^\u0600-\u06FFa-zA-Z0-9]/g, '_');
  const cleanStage = stageName.replace(/[^\u0600-\u06FFa-zA-Z0-9]/g, '_');
  return `${FILE_PREFIX}_${cleanCollege}_${cleanStage}_${timestamp}.xlsx`;
};

const generateStudentExcel = async (
  rows: StudentLinkRow[],
  meta: { collegeName: string; stageName: string; expiryDays: number; date: string },
): Promise<Blob> => {
  const XLSX = await import('xlsx-js-style');

  const data: any[][] = [];
  data.push(['روابط تسجيل بصمة الوجه للطلاب', '', '', '']);
  data.push(['', '', '', '']);
  data.push(['الكلية', 'المرحلة', 'صلاحية الرابط', '']);
  data.push([meta.collegeName, meta.stageName, `${meta.expiryDays} يوم`, '']);
  data.push(['تاريخ التوليد', meta.date, '', '']);
  data.push(['', '', '', '']);
  data.push(['الاسم', 'الكود', 'المجموعة', 'رابط التسجيل']);
  rows.forEach(r => {
    data.push([r.student.name, r.student.code || '', r.student.group || '', r.url]);
  });

  const ws = XLSX.utils.aoa_to_sheet(data);

  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 3 } }];
  ws['!cols'] = [{ wch: 32 }, { wch: 16 }, { wch: 14 }, { wch: 70 }];
  ws['!rows'] = [];
  for (let r = 0; r < data.length; r++) ws['!rows'][r] = { hpt: r === 6 ? 30 : 24 };

  if (!ws['!sheetView']) ws['!sheetView'] = [];
  (ws as any)['!sheetView'] = [{ RTL: true }];

  const titleStyle = {
    font: { name: 'Calibri', sz: 18, bold: true, color: { rgb: 'FFFFFF' } },
    fill: { patternType: 'solid', fgColor: { rgb: '7C3AED' } },
    alignment: { horizontal: 'center', vertical: 'center', readingOrder: 2 },
  };
  const headerStyle = {
    font: { name: 'Calibri', sz: 13, bold: true, color: { rgb: 'FFFFFF' } },
    fill: { patternType: 'solid', fgColor: { rgb: '8B5CF6' } },
    alignment: { horizontal: 'right', vertical: 'center', readingOrder: 2 },
  };
  const dataStyle = {
    font: { name: 'Calibri', sz: 12, color: { rgb: '111827' } },
    fill: { patternType: 'solid', fgColor: { rgb: 'FFFFFF' } },
    alignment: { horizontal: 'right', vertical: 'center', readingOrder: 2 },
  };
  const linkStyle = {
    font: { name: 'Consolas', sz: 10, color: { rgb: '2563EB' } },
    fill: { patternType: 'solid', fgColor: { rgb: 'EFF6FF' } },
    alignment: { horizontal: 'left', vertical: 'center', wrapText: true },
  };

  ws['A1'].s = titleStyle;
  ['A3', 'B3', 'C3'].forEach(c => { if (ws[c]) ws[c].s = headerStyle; });
  for (let r = 4; r <= 5; r++) ['A', 'B', 'C'].forEach(c => { if (ws[`${c}${r}`]) ws[`${c}${r}`].s = dataStyle; });
  for (let r = 7; r < data.length; r++) {
    if (ws[`A${r}`]) ws[`A${r}`].s = dataStyle;
    if (ws[`B${r}`]) ws[`B${r}`].s = dataStyle;
    if (ws[`C${r}`]) ws[`C${r}`].s = dataStyle;
    if (ws[`D${r}`]) ws[`D${r}`].s = linkStyle;
  }

  const wb = XLSX.utils.book_new();
  wb.Workbook = { Views: [{ RTL: true }] };
  XLSX.utils.book_append_sheet(wb, ws, 'روابط البصمة');
  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true });
  return new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
};

const buildShareText = (rows: StudentLinkRow[], meta: { collegeName: string; stageName: string }): string => {
  let text = `🔐 روابط تسجيل بصمة الوجه\n\nالكلية: ${meta.collegeName}\nالمرحلة: ${meta.stageName}\nعدد الطلاب: ${rows.length}\n\n`;
  rows.forEach((r, i) => {
    text += `${i + 1}. ${r.student.name}${r.student.code ? ` (${r.student.code})` : ''}\n${r.url}\n\n`;
  });
  text += `لكل طالب رابطه الخاص — يفتحه ويرفع صورة هويته ويسجل بصمة وجهه.`;
  return text;
};

export const SendEnrollLink: React.FC<SendEnrollLinkProps> = ({
  adminUid, colleges, stages, loadStudents, onClose,
}) => {
  const [selectedCollegeId, setSelectedCollegeId] = useState('');
  const [selectedStageId, setSelectedStageId] = useState('');

  const [students, setStudents] = useState<Student[]>([]);
  const [loadingStudents, setLoadingStudents] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [groupFilter, setGroupFilter] = useState('');

  const [expiryDays, setExpiryDays] = useState(30);
  const [generating, setGenerating] = useState(false);
  const [resultRows, setResultRows] = useState<StudentLinkRow[]>([]);

  const [confirmState, setConfirmState] = useState<{
    title: string; message: string; confirmLabel?: string; onConfirm: () => void;
  } | null>(null);

  const modalBehaviorRef = useModalBehavior({ open: !!confirmState, onClose: () => setConfirmState(null) });

  const selectedCollege = colleges.find(c => c.id === selectedCollegeId);
  const selectedStage = stages.find(s => s.id === selectedStageId);

  const stagesForCollege = useMemo(
    () => stages.filter(s => s.collegeId === selectedCollegeId),
    [stages, selectedCollegeId],
  );

  const groups = useMemo(() => {
    const set = new Set<string>();
    students.forEach(s => { if (s.group) set.add(s.group); });
    return Array.from(set);
  }, [students]);

  const filteredStudents = useMemo(() => {
    if (!groupFilter) return students;
    return students.filter(s => s.group === groupFilter);
  }, [students, groupFilter]);

  const handleStageChange = async (stageId: string) => {
    setSelectedStageId(stageId);
    setStudents([]);
    setSelectedIds(new Set());
    setGroupFilter('');
    if (!stageId) return;
    setLoadingStudents(true);
    try {
      const list = await loadStudents(stageId);
      setStudents(list.filter(s => s && s.id));
    } catch (e) {
      console.error('فشل تحميل الطلاب:', e);
      alert('تعذر تحميل قائمة الطلاب');
    } finally {
      setLoadingStudents(false);
    }
  };

  const toggleStudent = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedIds(prev => {
      const allSelected = filteredStudents.length > 0 && filteredStudents.every(s => prev.has(s.id));
      if (allSelected) return new Set();
      return new Set(filteredStudents.map(s => s.id));
    });
  };

  const doGenerateIndividual = async () => {
    if (!selectedStageId) { alert('الرجاء اختيار مرحلة'); return; }
    if (selectedIds.size === 0) { alert('الرجاء تحديد طالب واحد على الأقل'); return; }
    setGenerating(true);
    try {
      const chosen = students.filter(s => selectedIds.has(s.id));
      const results = await createBulkRegistrationLinks(
        adminUid,
        selectedStageId,
        chosen.map(s => ({ id: s.id, name: s.name, code: s.code, qrCodeId: s.qrCodeId })),
        expiryDays,
      );
      const byId = new Map(results.map(r => [r.studentId, r.url]));
      const rows: StudentLinkRow[] = chosen
        .filter(s => byId.has(s.id))
        .map(s => ({ student: s, url: byId.get(s.id)!, copied: false }));
      setResultRows(rows);
    } catch (e: any) {
      console.error(e);
      alert('فشل توليد الروابط: ' + (e?.message || ''));
    } finally {
      setGenerating(false);
    }
  };

  const copyRow = async (url: string, idx: number) => {
    try {
      await navigator.clipboard.writeText(url);
      setResultRows(prev => prev.map((r, i) => i === idx ? { ...r, copied: true } : r));
      setTimeout(() => setResultRows(prev => prev.map((r, i) => i === idx ? { ...r, copied: false } : r)), 2000);
    } catch { alert('فشل النسخ'); }
  };

  const downloadStudentExcel = async () => {
    if (resultRows.length === 0) return;
    const blob = await generateStudentExcel(resultRows, {
      collegeName: selectedCollege?.name || 'غير محدد',
      stageName: selectedStage?.name || 'غير محدد',
      expiryDays,
      date: getFormattedDate().date,
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = getFileName(selectedCollege?.name || 'كل', selectedStage?.name || 'الكل');
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const shareWhatsAppStudents = () => {
    if (resultRows.length === 0) return;
    const text = encodeURIComponent(buildShareText(resultRows, {
      collegeName: selectedCollege?.name || 'غير محدد',
      stageName: selectedStage?.name || 'غير محدد',
    }));
    const a = document.createElement('a');
    a.href = `https://wa.me/?text=${text}`;
    a.target = '_blank'; a.rel = 'noopener noreferrer';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  };

  const copyAllStudents = async () => {
    if (resultRows.length === 0) return;
    const text = buildShareText(resultRows, {
      collegeName: selectedCollege?.name || 'غير محدد',
      stageName: selectedStage?.name || 'غير محدد',
    });
    try {
      await navigator.clipboard.writeText(text);
      alert(`تم نسخ ${resultRows.length} رابطاً مع الأسماء`);
    } catch { alert('فشل النسخ'); }
  };

  if (resultRows.length > 0) {
    return createPortal(
      <div className="fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center p-4" dir="rtl">
        <div className="bg-slate-900 border border-white/10 text-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[92vh] flex flex-col overflow-hidden">
          <div className="p-5 border-b border-white/10 bg-gradient-to-l from-violet-500/15 to-purple-500/15">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                  <UserCheck className="w-5 h-5 text-violet-400" /> تم توليد {resultRows.length} رابط بصمة
                </h2>
                <p className="text-sm text-slate-400 mt-1">
                  <strong className="text-violet-300">{selectedStage?.name}</strong> • {selectedCollege?.name}
                </p>
              </div>
              <button onClick={onClose} aria-label="إغلاق" className="bg-red-500/20 hover:bg-red-500/30 text-red-300 w-10 h-10 rounded-full font-bold text-lg transition-all hover:scale-110">✕</button>
            </div>
          </div>

          <div className="p-4 border-b border-white/10 bg-white/5 flex flex-wrap gap-2">
            <button onClick={copyAllStudents} className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-xl flex items-center gap-1.5 shadow-md">
              <Copy className="w-4 h-4" /> نسخ الكل
            </button>
            <button onClick={downloadStudentExcel} className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold rounded-xl flex items-center gap-1.5 shadow-md">
              <FileSpreadsheet className="w-4 h-4" /> تحميل Excel
            </button>
            <button onClick={shareWhatsAppStudents} className="px-4 py-2.5 bg-green-600 hover:bg-green-700 text-white text-sm font-bold rounded-xl flex items-center gap-1.5 shadow-md">
              <Smartphone className="w-4 h-4" /> واتساب
            </button>
            <div className="flex-1" />
            <div className="flex items-center gap-2 bg-violet-500/15 px-3 py-1.5 rounded-lg border border-violet-500/30">
              <Clock className="w-3.5 h-3.5 text-violet-300" />
              <span className="text-xs text-violet-300 font-medium">صالحة {expiryDays} يوم</span>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            {resultRows.map((r, i) => (
              <div key={r.student.id} className="bg-white/5 border border-white/10 rounded-xl p-3">
                <div className="flex items-center justify-between gap-3 mb-2">
                  <div className="min-w-0">
                    <p className="font-bold text-white truncate">{r.student.name}</p>
                    <p className="text-xs text-slate-400 font-mono">
                      {r.student.code || '—'}{r.student.group ? ` • ${r.student.group}` : ''}
                    </p>
                  </div>
                  <button onClick={() => copyRow(r.url, i)} className="shrink-0 px-3 py-1.5 bg-blue-600/80 hover:bg-blue-600 text-white text-xs font-bold rounded-lg flex items-center gap-1">
                    {r.copied ? <><Check className="w-3 h-3" /> تم</> : <><Copy className="w-3 h-3" /> نسخ</>}
                  </button>
                </div>
                <div className="bg-slate-800 border border-slate-600 rounded-lg px-2 py-1.5 text-[11px] font-mono text-slate-300 break-all" dir="ltr">
                  {r.url}
                </div>
              </div>
            ))}
          </div>

          <div className="p-3 border-t border-white/10 bg-white/5 text-center">
            <button onClick={() => { setResultRows([]); }} className="text-sm text-violet-400 hover:text-violet-300 font-medium hover:underline flex items-center gap-1 mx-auto">
              <Link2 className="w-4 h-4" /> توليد روابط أخرى
            </button>
          </div>
        </div>
      </div>,
      document.body,
    );
  }

  return createPortal(
    <div className="fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center p-4" dir="rtl">
      <div className="bg-slate-900 border border-white/10 text-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[92vh] flex flex-col overflow-hidden">
        <div className="p-5 border-b border-white/10 bg-gradient-to-l from-purple-500/15 to-violet-500/15">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                <ScanFace className="w-5 h-5 text-purple-400" /> إرسال روابط تسجيل بصمة الوجه
              </h2>
              <p className="text-sm text-slate-400 mt-1">اختر الكلية والمرحلة ثم حدد الطلاب لإنشاء رابط خاص لكل طالب</p>
            </div>
            <button onClick={onClose} aria-label="إغلاق" className="bg-red-500/20 hover:bg-red-500/30 text-red-300 w-10 h-10 rounded-full font-bold text-lg transition-all hover:scale-110">✕</button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-bold text-slate-300 mb-1 flex items-center gap-1.5"><Landmark className="w-4 h-4" /> الكلية</label>
              <select
                value={selectedCollegeId}
                onChange={e => { setSelectedCollegeId(e.target.value); setSelectedStageId(''); setStudents([]); setSelectedIds(new Set()); }}
                className="w-full px-3 py-2.5 border border-slate-600 bg-slate-800 text-white rounded-xl focus:border-violet-500 focus:ring-2 focus:ring-violet-500/30"
              >
                <option value="">اختر كلية...</option>
                {colleges.map(c => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-bold text-slate-300 mb-1 flex items-center gap-1.5"><Library className="w-4 h-4" /> المرحلة</label>
              <select
                value={selectedStageId}
                onChange={e => handleStageChange(e.target.value)}
                disabled={!selectedCollegeId}
                className="w-full px-3 py-2.5 border border-slate-600 bg-slate-800 text-white rounded-xl disabled:bg-slate-800 disabled:opacity-50 focus:border-violet-500 focus:ring-2 focus:ring-violet-500/30"
              >
                <option value="">اختر مرحلة...</option>
                {stagesForCollege.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          </div>

          <div className="bg-violet-500/10 border border-violet-500/30 rounded-xl p-3">
            <label className="flex items-center justify-between text-sm font-bold text-violet-300 mb-1">
              <span className="flex items-center gap-1.5"><Clock className="w-4 h-4" /> مدة صلاحية الروابط</span>
              <span className="bg-violet-600 text-white px-3 py-1 rounded-full text-xs">{expiryDays} يوم</span>
            </label>
            <input type="range" min="1" max="90" value={expiryDays} onChange={e => setExpiryDays(Number(e.target.value))} className="w-full accent-violet-500 h-2" />
          </div>

          {selectedStageId && (
            <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <p className="text-sm font-bold text-slate-200 flex items-center gap-1.5">
                  <Users className="w-4 h-4" /> الطلاب ({students.length})
                </p>
                <div className="flex items-center gap-2">
                  {groups.length > 0 && (
                    <select
                      value={groupFilter}
                      onChange={e => setGroupFilter(e.target.value)}
                      className="px-2 py-1.5 border border-slate-600 bg-slate-800 text-white rounded-lg text-xs"
                    >
                      <option value="">كل المجموعات</option>
                      {groups.map(g => <option key={g} value={g}>{g}</option>)}
                    </select>
                  )}
                  <button
                    onClick={toggleSelectAll}
                    className="px-3 py-1.5 bg-violet-600/20 hover:bg-violet-600/40 text-violet-200 text-xs font-bold rounded-lg border border-violet-500/30"
                  >
                    {filteredStudents.length > 0 && filteredStudents.every(s => selectedIds.has(s.id)) ? 'إلغاء تحديد الكل' : 'تحديد الكل'}
                  </button>
                </div>
              </div>

              {loadingStudents ? (
                <div className="flex items-center justify-center gap-2 py-6 text-slate-400">
                  <LoaderCircle className="w-5 h-5 animate-spin" /> جاري تحميل الطلاب...
                </div>
              ) : (
                <div className="max-h-64 overflow-y-auto space-y-1.5 border border-white/10 rounded-lg p-2">
                  {filteredStudents.length === 0 && (
                    <p className="text-center text-sm text-slate-500 py-6">لا يوجد طلاب في هذه المرحلة</p>
                  )}
                  {filteredStudents.map(s => {
                    const sel = selectedIds.has(s.id);
                    return (
                      <label key={s.id} className={`flex items-center gap-3 px-3 py-2 rounded-lg border cursor-pointer transition ${sel ? 'bg-violet-500/15 border-violet-400/50' : 'bg-white/[0.04] border-white/[0.08] hover:bg-white/[0.08]'}`}>
                        <input type="checkbox" checked={sel} onChange={() => toggleStudent(s.id)} className="w-4 h-4 accent-violet-500" />
                        <span className="flex-1 min-w-0">
                          <span className="block text-sm font-bold text-white truncate">{s.name}</span>
                          <span className="block text-[11px] text-slate-400">{s.code || '—'}{s.group ? ` • ${s.group}` : ''}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}

              <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-3 py-2 text-sm text-emerald-300">
                تم تحديد <strong>{selectedIds.size}</strong> طالب — سيُولَّد رابط خاص بكل طالب يحمل اسمه وكوده، ولا يعمل إلا له.
              </div>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-white/10 bg-gradient-to-l from-purple-500/15 to-violet-500/15">
          <button
            onClick={() => {
              if (selectedIds.size === 0 && selectedStageId) {
                setConfirmState({
                  title: 'توليد روابط لكل طلاب المرحلة',
                  message: `لم تحدد طلاباً. هل تريد توليد رابط لكل طلاب مرحلة «${selectedStage?.name}» (${students.length} طالب)؟`,
                  confirmLabel: 'نعم، الكل',
                  onConfirm: () => { setSelectedIds(new Set(students.map(s => s.id))); setConfirmState(null); doGenerateIndividual(); },
                });
                return;
              }
              doGenerateIndividual();
            }}
            disabled={!selectedStageId || generating}
            className="w-full bg-gradient-to-l from-purple-600 to-violet-600 hover:from-purple-500 hover:to-violet-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold py-3.5 rounded-xl active:scale-[0.98] transition-all shadow-lg flex items-center justify-center gap-2 text-lg"
          >
            {generating ? <><LoaderCircle className="w-5 h-5 animate-spin" /> جاري التوليد...</> : <><Rocket className="w-5 h-5" /> توليد الروابط المحددة</>}
          </button>
        </div>

        {confirmState &&
          createPortal(
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[10000] p-4" onClick={() => setConfirmState(null)}>
              <div ref={modalBehaviorRef} className="bg-slate-900 border border-white/10 text-white rounded-xl shadow-2xl max-w-sm w-full p-6 text-center" onClick={e => e.stopPropagation()}>
                <h3 className="text-lg font-bold text-white mb-2">{confirmState.title}</h3>
                <p className="text-sm text-slate-400 mb-6 whitespace-pre-line">{confirmState.message}</p>
                <div className="flex gap-2">
                  <button onClick={confirmState.onConfirm} className="flex-1 bg-violet-600 hover:bg-violet-500 text-white font-bold py-3 px-4 rounded-lg transition">
                    {confirmState.confirmLabel || 'موافق'}
                  </button>
                  <button onClick={() => setConfirmState(null)} className="bg-white/10 hover:bg-white/20 text-slate-300 font-medium py-3 px-4 rounded-lg transition">
                    إلغاء
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )}
      </div>
    </div>,
    document.body,
  );
};

export default SendEnrollLink;
