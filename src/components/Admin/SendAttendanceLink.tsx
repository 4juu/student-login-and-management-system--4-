// src/components/Admin/SendAttendanceLink.tsx
import React, { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useModalBehavior } from '../../hooks/useModalBehavior';
import { Student, Stage, College } from '../../types/student';
import { TelegramConfig } from '../../types/telegram';
import {
  createAttendanceLink,
} from '../../services/tokenService';
import { flushAllPendingSaves } from '../../firebase/dataService';
import { ChevronRight, Clock, Copy, FileSpreadsheet, Landmark, Library, Rocket, Smartphone, Users, CalendarDays, BookOpen } from 'lucide-react';

interface SendAttendanceLinkProps {
  adminUid: string;
  colleges: College[];
  stages: Stage[];
  loadStudents: (stageId: string) => Promise<Student[]>;
  telegramConfig?: TelegramConfig | null;
  subjectName: string;
  teacherId?: string;
  onClose: () => void;
}

interface GeneratedAttendanceLink {
  token: string;
  url: string;
  expiryDays: number;
  stageName: string;
  collegeName: string;
  subjectName: string;
  date: string;
  copied: boolean;
}

const FILE_PREFIX = 'attendance_links';

const getFormattedDate = () => {
  const now = new Date();
  return {
    date: now.toLocaleDateString('ar-IQ', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }),
    time: now.toLocaleTimeString('ar-IQ', {
      hour: '2-digit',
      minute: '2-digit',
    }),
    timestamp: now.getTime(),
  };
};

const getFileName = (collegeName: string, stageName: string): string => {
  const { timestamp } = getFormattedDate();
  const cleanCollege = collegeName.replace(/[^\u0600-\u06FFa-zA-Z0-9]/g, '_');
  const cleanStage = stageName.replace(/[^\u0600-\u06FFa-zA-Z0-9]/g, '_');
  return `${FILE_PREFIX}_${cleanCollege}_${cleanStage}_${timestamp}.xlsx`;
};

const generateExcel = async (
  link: GeneratedAttendanceLink
): Promise<Blob> => {
  const XLSX = await import('xlsx-js-style');

  const data: any[][] = [];

  data.push(['رابط تقرير الحضور والغياب للطلاب', '', '', '']);
  data.push(['', '', '', '']);
  data.push(['الكلية', 'المرحلة', 'المادة', 'رابط التقرير']);
  data.push([link.collegeName, link.stageName, link.subjectName, link.url]);
  data.push(['', '', '', '']);
  data.push(['صلاحية الرابط', `${link.expiryDays} يوم`, '', '']);
  data.push(['تاريخ التوليد', link.date, '', '']);

  const ws = XLSX.utils.aoa_to_sheet(data);

  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 3 } },
  ];

  ws['!cols'] = [
    { wch: 30 },
    { wch: 25 },
    { wch: 30 },
    { wch: 60 },
  ];

  ws['!rows'] = [];
  ws['!rows'][0] = { hpt: 45 };
  ws['!rows'][1] = { hpt: 10 };
  ws['!rows'][2] = { hpt: 32 };
  ws['!rows'][3] = { hpt: 28 };
  ws['!rows'][4] = { hpt: 10 };
  ws['!rows'][5] = { hpt: 28 };
  ws['!rows'][6] = { hpt: 28 };

  if (!ws['!sheetView']) ws['!sheetView'] = [];
  (ws as any)['!sheetView'] = [{ RTL: true }];

  const titleStyle = {
    font: { name: 'Calibri', sz: 20, bold: true, color: { rgb: 'FFFFFF' } },
    fill: { patternType: 'solid', fgColor: { rgb: '059669' } },
    alignment: { horizontal: 'center', vertical: 'center', readingOrder: 2 },
    border: {
      top: { style: 'medium', color: { rgb: '047857' } },
      bottom: { style: 'medium', color: { rgb: '047857' } },
      left: { style: 'medium', color: { rgb: '047857' } },
      right: { style: 'medium', color: { rgb: '047857' } },
    },
  };

  const headerStyle = {
    font: { name: 'Calibri', sz: 14, bold: true, color: { rgb: 'FFFFFF' } },
    fill: { patternType: 'solid', fgColor: { rgb: '10B981' } },
    alignment: { horizontal: 'center', vertical: 'center', readingOrder: 2 },
    border: {
      top: { style: 'thin', color: { rgb: '059669' } },
      bottom: { style: 'thin', color: { rgb: '059669' } },
      left: { style: 'thin', color: { rgb: '059669' } },
      right: { style: 'thin', color: { rgb: '059669' } },
    },
  };

  const dataStyle = {
    font: { name: 'Calibri', sz: 13, color: { rgb: '111827' } },
    fill: { patternType: 'solid', fgColor: { rgb: 'FFFFFF' } },
    alignment: { horizontal: 'right', vertical: 'center', readingOrder: 2 },
    border: {
      top: { style: 'thin', color: { rgb: 'D1D5DB' } },
      bottom: { style: 'thin', color: { rgb: 'D1D5DB' } },
      left: { style: 'thin', color: { rgb: 'D1D5DB' } },
      right: { style: 'thin', color: { rgb: 'D1D5DB' } },
    },
  };

  const linkStyle = {
    font: { name: 'Consolas', sz: 11, color: { rgb: '2563EB' } },
    fill: { patternType: 'solid', fgColor: { rgb: 'EFF6FF' } },
    alignment: { horizontal: 'left', vertical: 'center', wrapText: true },
    border: {
      top: { style: 'thin', color: { rgb: 'D1D5DB' } },
      bottom: { style: 'thin', color: { rgb: 'D1D5DB' } },
      left: { style: 'thin', color: { rgb: 'D1D5DB' } },
      right: { style: 'thin', color: { rgb: 'D1D5DB' } },
    },
  };

  const labelStyle = {
    font: { name: 'Calibri', sz: 13, bold: true, color: { rgb: '374151' } },
    fill: { patternType: 'solid', fgColor: { rgb: 'F3F4F6' } },
    alignment: { horizontal: 'right', vertical: 'center', readingOrder: 2 },
    border: {
      top: { style: 'thin', color: { rgb: 'D1D5DB' } },
      bottom: { style: 'thin', color: { rgb: 'D1D5DB' } },
      left: { style: 'thin', color: { rgb: 'D1D5DB' } },
      right: { style: 'thin', color: { rgb: 'D1D5DB' } },
    },
  };

  ws['A1'].s = titleStyle;
  ['A3', 'B3', 'C3', 'D3'].forEach(cell => { if (ws[cell]) ws[cell].s = headerStyle; });
  ['A4', 'B4', 'C4'].forEach(cell => { if (ws[cell]) ws[cell].s = dataStyle; });
  if (ws['D4']) ws['D4'].s = linkStyle;
  ['A6', 'B6', 'C6', 'D6'].forEach(cell => { if (ws[cell]) ws[cell].s = labelStyle; });
  ['A7', 'B7', 'C7', 'D7'].forEach(cell => { if (ws[cell]) ws[cell].s = labelStyle; });

  ws['!freeze'] = { xSplit: 0, ySplit: 3 };

  const wb = XLSX.utils.book_new();
  wb.Workbook = { Views: [{ RTL: true }] };
  XLSX.utils.book_append_sheet(wb, ws, 'رابط الحضور');

  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true });

  return new Blob([wbout], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
};

export const SendAttendanceLink: React.FC<SendAttendanceLinkProps> = ({
  adminUid,
  colleges,
  stages,
  subjectName,
  teacherId,
  onClose,
}) => {
  const [selectedCollegeId, setSelectedCollegeId] = useState('');
  const [selectedStageId, setSelectedStageId] = useState('');
  const [expiryDays, setExpiryDays] = useState(30);
  const [generatedLink, setGeneratedLink] = useState<GeneratedAttendanceLink | null>(null);
  const [generating, setGenerating] = useState(false);

  const [confirmState, setConfirmState] = useState<{
    title: string;
    message: string;
    confirmLabel?: string;
    onConfirm: () => void;
  } | null>(null);

  const modalBehaviorRef = useModalBehavior({
    open: !!confirmState && !generatedLink,
    onClose: () => setConfirmState(null),
  });
  const modalBehaviorRefLink = useModalBehavior({
    open: !!generatedLink,
    onClose,
  });

  const selectedCollege = colleges.find(c => c.id === selectedCollegeId);
  const selectedStage = stages.find(s => s.id === selectedStageId);

  const stagesForCollege = useMemo(() =>
    stages.filter(s => s.collegeId === selectedCollegeId),
    [stages, selectedCollegeId]
  );

  const handleStageChange = async (stageId: string) => {
    setSelectedStageId(stageId);
    if (!stageId) return;
  };

  const handleGenerateLink = () => {
    if (!selectedStageId) { alert('الرجاء اختيار مرحلة'); return; }
    setConfirmState({
      title: 'تأكيد توليد رابط الحضور',
      message: `سيتم توليد رابط تقرير الحضور والغياب للمرحلة: ${selectedStage?.name}\nالمادة: ${subjectName}\nمتابعة؟`,
      confirmLabel: 'نعم، توليد',
      onConfirm: () => {
        setConfirmState(null);
        doGenerateLink();
      },
    });
  };

  const doGenerateLink = async () => {
    setGenerating(true);
    try {
      await flushAllPendingSaves();
      const { token, url } = await createAttendanceLink(adminUid, selectedStageId, subjectName, expiryDays, teacherId);

      const { date } = getFormattedDate();
      const generated: GeneratedAttendanceLink = {
        token,
        url,
        expiryDays,
        stageName: selectedStage?.name || 'غير محدد',
        collegeName: selectedCollege?.name || 'غير محدد',
        subjectName,
        date,
        copied: false,
      };
      setGeneratedLink(generated);
    } catch (e: any) {
      console.error(e);
      alert('فشل توليد الرابط: ' + (e.message || ''));
    } finally {
      setGenerating(false);
    }
  };

  const handleCopyLink = async () => {
    if (!generatedLink) return;
    try {
      await navigator.clipboard.writeText(generatedLink.url);
      setGeneratedLink(prev => prev ? { ...prev, copied: true } : null);
      setTimeout(() => {
        setGeneratedLink(prev => prev ? { ...prev, copied: false } : null);
      }, 2000);
    } catch { alert('فشل النسخ'); }
  };

  const handleDownloadExcel = async () => {
    if (!generatedLink) return;
    const blob = await generateExcel(generatedLink);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = getFileName(generatedLink.collegeName, generatedLink.stageName);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleShareWhatsApp = () => {
    if (!generatedLink) return;
    const text = encodeURIComponent(
      `📊 تقرير الحضور والغياب\n\n` +
      `الكلية: ${generatedLink.collegeName}\n` +
      `المرحلة: ${generatedLink.stageName}\n` +
      `المادة: ${generatedLink.subjectName}\n\n` +
      `رابط التقرير:\n${generatedLink.url}\n\n` +
      `الرابط صالح لمدة ${generatedLink.expiryDays} يوم.`
    );
    const a = document.createElement('a');
    a.href = `https://wa.me/?text=${text}`;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  if (generatedLink) {
    return createPortal(
      <div className="fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center p-4" dir="rtl">
        <div ref={modalBehaviorRefLink} className="bg-slate-900 border border-white/10 text-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden">

          <div className="p-5 border-b border-white/10 bg-gradient-to-l from-emerald-500/15 to-teal-500/15">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                  <CalendarDays className="w-5 h-5 text-emerald-400" /> رابط تقرير الحضور جاهز
                </h2>
                <p className="text-sm text-slate-400 mt-1">
                  <strong className="text-emerald-400">{generatedLink.stageName}</strong> • {generatedLink.collegeName}
                </p>
              </div>
              <button onClick={onClose} className="bg-red-500/20 hover:bg-red-500/30 text-red-300 w-10 h-10 rounded-full font-bold text-lg transition-all hover:scale-110">✕</button>
            </div>
          </div>

          <div className="p-4 border-b border-white/10 bg-white/5">
            <div className="flex flex-wrap gap-2 items-center">
              <button onClick={handleCopyLink} className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-xl transition-all hover:scale-105 flex items-center gap-1.5 shadow-md">
                <Copy className="w-4 h-4" /> {generatedLink.copied ? 'تم النسخ!' : 'نسخ الرابط'}
              </button>

              <button onClick={handleDownloadExcel} className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold rounded-xl transition-all hover:scale-105 flex items-center gap-1.5 shadow-md">
                <FileSpreadsheet className="w-4 h-4" /> تحميل Excel
              </button>

              <button onClick={handleShareWhatsApp} className="px-4 py-2.5 bg-green-600 hover:bg-green-700 text-white text-sm font-bold rounded-xl transition-all hover:scale-105 flex items-center gap-1.5 shadow-md">
                <Smartphone className="w-4 h-4" /> واتساب
              </button>

              <div className="flex-1" />

              <div className="flex items-center gap-2 bg-emerald-500/15 px-3 py-1.5 rounded-lg border border-emerald-500/30">
                <span className="text-xs text-emerald-300 font-medium flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" /> صالحة {generatedLink.expiryDays} يوم
                </span>
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            <div className="bg-white/5 border border-white/10 rounded-xl p-4">
              <div className="flex items-center gap-3 mb-3">
                <div className="bg-emerald-500/15 text-emerald-300 w-10 h-10 rounded-full flex items-center justify-center font-bold text-lg">
                  <CalendarDays className="w-5 h-5" />
                </div>
                <div>
                  <p className="font-bold text-white">{generatedLink.subjectName}</p>
                  <p className="text-xs text-slate-400">اسم المادة (من وصف التدريسي)</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 mb-3">
                <div className="bg-slate-800 p-3 rounded-lg border border-white/10">
                  <p className="text-xs text-slate-400">الكلية</p>
                  <p className="font-bold text-white">{generatedLink.collegeName}</p>
                </div>
                <div className="bg-slate-800 p-3 rounded-lg border border-white/10">
                  <p className="text-xs text-slate-400">المرحلة</p>
                  <p className="font-bold text-white">{generatedLink.stageName}</p>
                </div>
              </div>

              <div className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-xs font-mono text-slate-300 break-all" dir="ltr">
                {generatedLink.url}
              </div>
            </div>
          </div>

          <div className="p-3 border-t border-white/10 bg-white/5 text-center">
            <button onClick={() => setGeneratedLink(null)} className="text-sm text-emerald-400 hover:text-emerald-300 font-medium hover:underline flex items-center gap-1 mx-auto">
              <ChevronRight className="w-4 h-4" /> توليد رابط آخر
            </button>
          </div>
        </div>
      </div>,
      document.body
    );
  }

  return createPortal(
    <div className="fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center p-4" dir="rtl">
      <div ref={modalBehaviorRefLink} className="bg-slate-900 border border-white/10 text-white rounded-2xl shadow-2xl max-w-md w-full max-h-[90vh] flex flex-col overflow-hidden">

        <div className="p-5 border-b border-white/10 bg-gradient-to-l from-teal-500/15 to-emerald-500/15">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                <CalendarDays className="w-5 h-5 text-teal-400" /> إنشاء رابط تقرير الحضور
              </h2>
              <p className="text-sm text-slate-400 mt-1">رابط واحد للمرحلة - الطلاب يرفعون الهوية ويشوفون تقريرهم</p>
            </div>
            <button onClick={onClose} className="bg-red-500/20 hover:bg-red-500/30 text-red-300 w-10 h-10 rounded-full font-bold text-lg transition-all hover:scale-110">✕</button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-bold text-slate-300 mb-1 flex items-center gap-1.5"><Landmark className="w-4 h-4" /> الكلية</label>
              <select
                value={selectedCollegeId}
                onChange={e => { setSelectedCollegeId(e.target.value); setSelectedStageId(''); }}
                className="w-full px-3 py-2.5 border border-slate-600 bg-slate-800 text-white rounded-xl focus:border-teal-500 focus:ring-2 focus:ring-teal-500/30"
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
                className="w-full px-3 py-2.5 border border-slate-600 bg-slate-800 text-white rounded-xl disabled:bg-slate-800 disabled:opacity-50 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/30"
              >
                <option value="">اختر مرحلة...</option>
                {stagesForCollege.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          </div>

          <div className="bg-teal-500/10 border border-teal-500/30 rounded-xl p-4">
            <label className="flex items-center justify-between text-sm font-bold text-teal-300 mb-2">
              <span className="flex items-center gap-1.5"><CalendarDays className="w-4 h-4" /> مدة صلاحية الرابط</span>
              <span className="bg-teal-600 text-white px-3 py-1 rounded-full text-xs">{expiryDays} يوم</span>
            </label>
            <input type="range" min="1" max="90" value={expiryDays} onChange={e => setExpiryDays(Number(e.target.value))} className="w-full accent-teal-500 h-2" />
            <div className="flex justify-between text-xs text-teal-400 mt-1">
              <span>1 يوم</span><span>30 يوم</span><span>90 يوم</span>
            </div>
          </div>

          <div className="bg-white/5 border border-white/10 rounded-xl p-4">
            <label className="block text-sm font-bold text-slate-300 mb-2 flex items-center gap-1.5">
              <BookOpen className="w-4 h-4" /> المادة
            </label>
            <div className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white font-medium">
              {subjectName || 'لم يتم تعيين وصف للمادة في الملف الشخصي'}
            </div>
            <p className="text-xs text-slate-400 mt-1">يؤخذ من البايو في إعدادات الملف الشخصي</p>
          </div>

          {selectedStageId && (
            <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4">
              <p className="text-sm text-emerald-300 font-medium flex items-center gap-1.5">
                <Users className="w-4 h-4" /> سيتم إنشاء رابط واحد مشترك لكل طلاب مرحلة <strong>{selectedStage?.name}</strong>
              </p>
              <p className="text-xs text-emerald-400 mt-1">الطالب يرفع هويته → يتطابق الاسم → يشوف أيام حضوره وغيابه</p>
            </div>
          )}

        </div>

        <div className="p-4 border-t border-white/10 bg-gradient-to-l from-teal-500/15 to-emerald-500/15">
          <button
            onClick={handleGenerateLink}
            disabled={!selectedStageId || generating}
            className="w-full bg-gradient-to-l from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold py-3.5 rounded-xl active:scale-[0.98] transition-all shadow-lg hover:shadow-xl flex items-center justify-center gap-2 text-lg"
          >
            {generating
              ? <><div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /> جاري التوليد...</>
              : <><Rocket className="w-5 h-5" /> توليد رابط الحضور</>}
          </button>
        </div>

        {confirmState &&
          createPortal(
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[10000] p-4" onClick={() => setConfirmState(null)}>
              <div ref={modalBehaviorRef} className="bg-slate-900 border border-white/10 text-white rounded-xl shadow-2xl max-w-sm w-full overflow-y-auto p-6 text-center" onClick={e => e.stopPropagation()}>
                <h3 className="text-lg font-bold text-white mb-2">{confirmState.title}</h3>
                <p className="text-sm text-slate-400 mb-6 whitespace-pre-line">{confirmState.message}</p>
                <div className="flex gap-2">
                  <button onClick={confirmState.onConfirm} className="flex-1 bg-teal-600 hover:bg-teal-500 text-white font-bold py-3 px-4 rounded-lg transition">
                    {confirmState.confirmLabel || 'موافق'}
                  </button>
                  <button onClick={() => setConfirmState(null)} className="bg-white/10 hover:bg-white/20 text-slate-300 font-medium py-3 px-4 rounded-lg transition">
                    إلغاء
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )}
      </div>
    </div>,
    document.body
  );
};

// Need to import BookOpen
export default SendAttendanceLink;