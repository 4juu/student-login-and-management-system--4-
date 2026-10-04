// src/components/Admin/SendAttendanceLink.tsx
import React, { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useModalBehavior } from '../../hooks/useModalBehavior';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { Student, Stage, College } from '../../types/student';
import { TelegramConfig } from '../../types/telegram';
import {
  createAttendanceLink,
} from '../../services/tokenService';
import { flushAllPendingSaves } from '../../firebase/dataService';
import { ChevronRight, Clock, Copy, FileSpreadsheet, Landmark, Library, Rocket, Smartphone, Users, CalendarDays, BookOpen } from 'lucide-react';
import { MorphingSquare } from '../MorphingSquare';
import { toast } from '@/hooks/use-toast';

interface SendAttendanceLinkProps {
  adminUid: string;
  colleges: College[];
  stages: Stage[];
  loadStudents: (stageId: string) => Promise<Student[]>;
  telegramConfig?: TelegramConfig | null;
  subjectName: string;
  teacherId?: string;
  onClose: () => void;
  /** Ø§Ù„Ù…Ø±Ø­Ù„Ø© Ø§Ù„Ù…ÙØªÙˆØ­Ø© Ø­Ø§Ù„ÙŠØ§Ù‹ â€” ØªÙØ®ØªØ§Ø± ØªÙ„Ù‚Ø§Ø¦ÙŠØ§Ù‹ Ø¨Ø¯Ù„ Ø¥Ø¬Ø¨Ø§Ø± Ø§Ù„Ù…Ø³ØªØ®Ø¯Ù… Ø¹Ù„Ù‰ Ø§Ø®ØªÙŠØ§Ø± Ø§Ù„ÙƒÙ„ÙŠØ© ÙˆØ§Ù„Ù…Ø±Ø­Ù„Ø© */
  defaultStageId?: string | null;
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

  data.push(['Ø±Ø§Ø¨Ø· ØªÙ‚Ø±ÙŠØ± Ø§Ù„Ø­Ø¶ÙˆØ± ÙˆØ§Ù„ØºÙŠØ§Ø¨ Ù„Ù„Ø·Ù„Ø§Ø¨', '', '', '']);
  data.push(['', '', '', '']);
  data.push(['Ø§Ù„ÙƒÙ„ÙŠØ©', 'Ø§Ù„Ù…Ø±Ø­Ù„Ø©', 'Ø§Ù„Ù…Ø§Ø¯Ø©', 'Ø±Ø§Ø¨Ø· Ø§Ù„ØªÙ‚Ø±ÙŠØ±']);
  data.push([link.collegeName, link.stageName, link.subjectName, link.url]);
  data.push(['', '', '', '']);
  data.push(['ØµÙ„Ø§Ø­ÙŠØ© Ø§Ù„Ø±Ø§Ø¨Ø·', `${link.expiryDays} ÙŠÙˆÙ…`, '', '']);
  data.push(['ØªØ§Ø±ÙŠØ® Ø§Ù„ØªÙˆÙ„ÙŠØ¯', link.date, '', '']);

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
  XLSX.utils.book_append_sheet(wb, ws, 'Ø±Ø§Ø¨Ø· Ø§Ù„Ø­Ø¶ÙˆØ±');

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
  defaultStageId = null,
}) => {
  // Ø§Ù„Ù…Ø±Ø­Ù„Ø© Ø§Ù„Ù…ÙØªÙˆØ­Ø© Ø­Ø§Ù„ÙŠØ§Ù‹ â€” ØªÙØ®ØªØ§Ø± ØªÙ„Ù‚Ø§Ø¦ÙŠØ§Ù‹ Ù…Ø§ Ø¯Ø§Ù…Øª Ø¶Ù…Ù† Ù†Ø·Ø§Ù‚ Ø§Ù„ØµÙ„Ø§Ø­ÙŠØ©
  const autoStage = useMemo(() => {
    if (!defaultStageId) return null;
    const stage = stages.find(s => s.id === defaultStageId);
    if (!stage) return null;
    const college = colleges.find(c => c.id === stage.collegeId) ?? null;
    return { stage, college };
  }, [defaultStageId, stages, colleges]);

  const [selectedCollegeId, setSelectedCollegeId] = useState(autoStage?.stage.collegeId ?? '');
  const [selectedStageId, setSelectedStageId] = useState(autoStage?.stage.id ?? '');
  // Ø¹Ù†Ø¯ Ø§Ù„Ø§Ø®ØªÙŠØ§Ø± Ø§Ù„ØªÙ„Ù‚Ø§Ø¦ÙŠ ØªÙØ®ÙÙ‰ Ø§Ù„Ù‚ÙˆØ§Ø¦Ù… ÙˆÙŠØ¸Ù‡Ø± Ø§Ø³Ù… Ø§Ù„Ù…Ø±Ø­Ù„Ø© ÙÙ‚Ø· â€” Ù…Ø¹ Ø²Ø± Â«ØªØºÙŠÙŠØ±Â» ÙŠØ¹ÙŠØ¯Ù‡Ø§ ÙƒÙ…Ø§ ÙƒØ§Ù†Øª
  const [showPicker, setShowPicker] = useState(!autoStage);
  const [expiryDays, setExpiryDays] = useState(30);
  const [generatedLink, setGeneratedLink] = useState<GeneratedAttendanceLink | null>(null);
  const [generating, setGenerating] = useState(false);

  const [confirmState, setConfirmState] = useState<{
    title: string;
    message: string;
    confirmLabel?: string;
    onConfirm: () => void;
  } | null>(null);

  useBodyScrollLock(true);
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
    if (!selectedStageId) { toast({ variant: 'destructive', title: 'Ø§Ù„Ø±Ø¬Ø§Ø¡ Ø§Ø®ØªÙŠØ§Ø± Ù…Ø±Ø­Ù„Ø©' }); return; }
    setConfirmState({
      title: 'ØªØ£ÙƒÙŠØ¯ ØªÙˆÙ„ÙŠØ¯ Ø±Ø§Ø¨Ø· Ø§Ù„Ø­Ø¶ÙˆØ±',
      message: `Ø³ÙŠØªÙ… ØªÙˆÙ„ÙŠØ¯ Ø±Ø§Ø¨Ø· ØªÙ‚Ø±ÙŠØ± Ø§Ù„Ø­Ø¶ÙˆØ± ÙˆØ§Ù„ØºÙŠØ§Ø¨ Ù„Ù„Ù…Ø±Ø­Ù„Ø©: ${selectedStage?.name}\nØ§Ù„Ù…Ø§Ø¯Ø©: ${subjectName}\nÙ…ØªØ§Ø¨Ø¹Ø©ØŸ`,
      confirmLabel: 'Ù†Ø¹Ù…ØŒ ØªÙˆÙ„ÙŠØ¯',
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
        stageName: selectedStage?.name || 'ØºÙŠØ± Ù…Ø­Ø¯Ø¯',
        collegeName: selectedCollege?.name || 'ØºÙŠØ± Ù…Ø­Ø¯Ø¯',
        subjectName,
        date,
        copied: false,
      };
      setGeneratedLink(generated);
    } catch (e: any) {
      console.error(e);
      toast({ variant: 'destructive', title: 'ÙØ´Ù„ ØªÙˆÙ„ÙŠØ¯ Ø§Ù„Ø±Ø§Ø¨Ø·', description: e.message || undefined });
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
    } catch { toast({ variant: 'destructive', title: 'ÙØ´Ù„ Ø§Ù„Ù†Ø³Ø®' }); }
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
      `ðŸ“Š ØªÙ‚Ø±ÙŠØ± Ø§Ù„Ø­Ø¶ÙˆØ± ÙˆØ§Ù„ØºÙŠØ§Ø¨\n\n` +
      `Ø§Ù„ÙƒÙ„ÙŠØ©: ${generatedLink.collegeName}\n` +
      `Ø§Ù„Ù…Ø±Ø­Ù„Ø©: ${generatedLink.stageName}\n` +
      `Ø§Ù„Ù…Ø§Ø¯Ø©: ${generatedLink.subjectName}\n\n` +
      `Ø±Ø§Ø¨Ø· Ø§Ù„ØªÙ‚Ø±ÙŠØ±:\n${generatedLink.url}\n\n` +
      `Ø§Ù„Ø±Ø§Ø¨Ø· ØµØ§Ù„Ø­ Ù„Ù…Ø¯Ø© ${generatedLink.expiryDays} ÙŠÙˆÙ….`
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
      <div className="fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center p-4 animate-fadeIn" dir="rtl">
        <div ref={modalBehaviorRefLink} role="dialog" aria-modal="true" aria-labelledby="attendance-link-dialog-title" tabIndex={-1} className="glass-modal p-0 text-white w-[calc(100vw-2rem)] max-w-2xl flex flex-col overflow-hidden animate-modalUp focus:outline-none">

          <div className="px-4 sm:px-6 py-4 sm:py-5 border-b border-white/10 bg-gradient-to-l from-emerald-500/15 to-teal-500/15 shrink-0">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 id="attendance-link-dialog-title" className="text-base sm:text-lg font-semibold text-white flex items-center gap-2">
                  <CalendarDays className="w-5 h-5 text-emerald-400 shrink-0" /> Ø±Ø§Ø¨Ø· ØªÙ‚Ø±ÙŠØ± Ø§Ù„Ø­Ø¶ÙˆØ± Ø¬Ø§Ù‡Ø²
                </h2>
                <p className="text-sm text-slate-400 mt-1">
                  <strong className="text-emerald-400">{generatedLink.stageName}</strong> â€¢ {generatedLink.collegeName}
                </p>
              </div>
              <button type="button" aria-label="Ø¥ØºÙ„Ø§Ù‚" onClick={onClose} className="shrink-0 bg-red-500/20 hover:bg-red-500/30 text-red-300 w-10 h-10 rounded-full font-bold text-lg transition duration-200">âœ•</button>
            </div>
          </div>

          <div className="px-4 sm:px-6 py-4 border-b border-white/10 bg-white/5 shrink-0">
            <div className="flex flex-wrap gap-2 items-center">
              <button onClick={handleCopyLink} className="btn-base btn-primary">
                <Copy className="w-4 h-4" /> {generatedLink.copied ? 'ØªÙ… Ø§Ù„Ù†Ø³Ø®!' : 'Ù†Ø³Ø® Ø§Ù„Ø±Ø§Ø¨Ø·'}
              </button>

              <button onClick={handleDownloadExcel} className="btn-base btn-secondary">
                <FileSpreadsheet className="w-4 h-4" /> ØªØ­Ù…ÙŠÙ„ Excel
              </button>

              <button onClick={handleShareWhatsApp} className="btn-base btn-secondary">
                <Smartphone className="w-4 h-4" /> ÙˆØ§ØªØ³Ø§Ø¨
              </button>

              <div className="hidden sm:block flex-1" />

              <div className="flex items-center gap-2 bg-emerald-500/15 px-3 py-1.5 rounded-lg border border-emerald-500/30">
                <span className="text-xs text-emerald-300 font-medium flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" /> ØµØ§Ù„Ø­Ø© {generatedLink.expiryDays} ÙŠÙˆÙ…
                </span>
              </div>
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 py-4 space-y-4">
            <div className="bg-white/5 border border-white/10 rounded-xl p-4">
              <div className="flex items-center gap-3">
                <div className="bg-emerald-500/15 text-emerald-300 w-10 h-10 rounded-full flex items-center justify-center font-bold text-lg shrink-0">
                  <CalendarDays className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <p className="font-bold text-white text-base sm:text-lg truncate">{generatedLink.subjectName}</p>
                  <p className="text-xs text-slate-400">Ø§Ø³Ù… Ø§Ù„Ù…Ø§Ø¯Ø© (Ù…Ù† ÙˆØµÙ Ø§Ù„ØªØ¯Ø±ÙŠØ³ÙŠ)</p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
                <div className="bg-slate-800 p-3 rounded-lg border border-white/10">
                  <p className="text-xs text-slate-400">Ø§Ù„ÙƒÙ„ÙŠØ©</p>
                  <p className="font-bold text-white">{generatedLink.collegeName}</p>
                </div>
                <div className="bg-slate-800 p-3 rounded-lg border border-white/10">
                  <p className="text-xs text-slate-400">Ø§Ù„Ù…Ø±Ø­Ù„Ø©</p>
                  <p className="font-bold text-white">{generatedLink.stageName}</p>
                </div>
              </div>

              <div className="mt-3 bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-xs font-mono text-slate-300 break-all" dir="ltr">
                {generatedLink.url}
              </div>
            </div>
          </div>

          <div className="px-4 sm:px-6 py-3 border-t border-white/10 bg-white/5 text-center shrink-0">
            <button onClick={() => setGeneratedLink(null)} className="text-sm text-emerald-400 hover:text-emerald-300 font-medium hover:underline flex items-center gap-1 mx-auto">
              <ChevronRight className="w-4 h-4" /> ØªÙˆÙ„ÙŠØ¯ Ø±Ø§Ø¨Ø· Ø¢Ø®Ø±
            </button>
          </div>
        </div>
      </div>,
      document.body
    );
  }

  return createPortal(
    <div className="fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center p-4 animate-fadeIn" dir="rtl">
      <div ref={modalBehaviorRefLink} role="dialog" aria-modal="true" aria-labelledby="attendance-link-create-title" tabIndex={-1} className="glass-modal p-0 text-white w-[calc(100vw-2rem)] max-w-md flex flex-col overflow-hidden animate-modalUp focus:outline-none">

        <div className="px-4 sm:px-6 py-4 sm:py-5 border-b border-white/10 bg-gradient-to-l from-teal-500/15 to-emerald-500/15 shrink-0">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 id="attendance-link-create-title" className="text-base sm:text-lg font-semibold text-white flex items-center gap-2">
                <CalendarDays className="w-5 h-5 text-teal-400 shrink-0" /> Ø¥Ù†Ø´Ø§Ø¡ Ø±Ø§Ø¨Ø· ØªÙ‚Ø±ÙŠØ± Ø§Ù„Ø­Ø¶ÙˆØ±
              </h2>
              <p className="text-sm text-slate-400 mt-1">Ø±Ø§Ø¨Ø· ÙˆØ§Ø­Ø¯ Ù„Ù„Ù…Ø±Ø­Ù„Ø© - Ø§Ù„Ø·Ù„Ø§Ø¨ ÙŠØ±ÙØ¹ÙˆÙ† Ø§Ù„Ù‡ÙˆÙŠØ© ÙˆÙŠØ´ÙˆÙÙˆÙ† ØªÙ‚Ø±ÙŠØ±Ù‡Ù…</p>
            </div>
            <button type="button" aria-label="Ø¥ØºÙ„Ø§Ù‚" onClick={onClose} className="shrink-0 bg-red-500/20 hover:bg-red-500/30 text-red-300 w-10 h-10 rounded-full font-bold text-lg transition duration-200">âœ•</button>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 py-4 sm:py-5 space-y-4">

          {!showPicker && autoStage ? (
            <div className="bg-white/5 border border-white/10 rounded-xl p-4 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-bold text-slate-400 mb-0.5">Ø§Ù„Ù…Ø±Ø­Ù„Ø© Ø§Ù„Ù…Ø®ØªØ§Ø±Ø© ØªÙ„Ù‚Ø§Ø¦ÙŠØ§Ù‹</p>
                <p className="text-sm font-extrabold text-white truncate">
                  {autoStage.college ? `${autoStage.college.icon || ''} ` : ''}{autoStage.stage.name}
                </p>
                {autoStage.college && <p className="text-xs text-slate-400 truncate">{autoStage.college.name}</p>}
              </div>
              <button
                type="button"
                onClick={() => setShowPicker(true)}
                className="shrink-0 rounded-lg border border-teal-500/40 px-3 py-2 text-xs font-bold text-teal-300 transition hover:bg-teal-500/15 hover:text-teal-200 focus:outline-none focus:ring-2 focus:ring-teal-500/40"
              >
                ØªØºÙŠÙŠØ± Ø§Ù„Ù…Ø±Ø­Ù„Ø©
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="block text-sm font-bold text-slate-300 flex items-center gap-1.5"><Landmark className="w-4 h-4" /> Ø§Ù„ÙƒÙ„ÙŠØ©</label>
                <select
                  value={selectedCollegeId}
                  onChange={e => { setSelectedCollegeId(e.target.value); setSelectedStageId(''); }}
                  className="glass-input appearance-none text-sm"
                >
                  <option value="">Ø§Ø®ØªØ± ÙƒÙ„ÙŠØ©...</option>
                  {colleges.map(c => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="block text-sm font-bold text-slate-300 flex items-center gap-1.5"><Library className="w-4 h-4" /> Ø§Ù„Ù…Ø±Ø­Ù„Ø©</label>
                <select
                  value={selectedStageId}
                  onChange={e => handleStageChange(e.target.value)}
                  disabled={!selectedCollegeId}
                  className="glass-input appearance-none text-sm disabled:opacity-50"
                >
                  <option value="">Ø§Ø®ØªØ± Ù…Ø±Ø­Ù„Ø©...</option>
                  {stagesForCollege.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            </div>
          )}

          <div className="bg-teal-500/10 border border-teal-500/30 rounded-xl p-4">
            <label className="flex items-center justify-between text-sm font-bold text-teal-300 mb-2">
              <span className="flex items-center gap-1.5"><CalendarDays className="w-4 h-4" /> Ù…Ø¯Ø© ØµÙ„Ø§Ø­ÙŠØ© Ø§Ù„Ø±Ø§Ø¨Ø·</span>
              <span className="bg-teal-600 text-white px-3 py-1 rounded-full text-xs">{expiryDays} ÙŠÙˆÙ…</span>
            </label>
            <input type="range" min="1" max="90" value={expiryDays} onChange={e => setExpiryDays(Number(e.target.value))} className="w-full accent-teal-500 h-2" />
            <div className="flex justify-between text-xs text-teal-400 mt-1">
              <span>1 ÙŠÙˆÙ…</span><span>30 ÙŠÙˆÙ…</span><span>90 ÙŠÙˆÙ…</span>
            </div>
          </div>

          <div className="bg-white/5 border border-white/10 rounded-xl p-4">
            <label className="block text-sm font-bold text-slate-300 mb-2 flex items-center gap-1.5">
              <BookOpen className="w-4 h-4" /> Ø§Ù„Ù…Ø§Ø¯Ø©
            </label>
            <div className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white font-medium">
              {subjectName || 'Ù„Ù… ÙŠØªÙ… ØªØ¹ÙŠÙŠÙ† ÙˆØµÙ Ù„Ù„Ù…Ø§Ø¯Ø© ÙÙŠ Ø§Ù„Ù…Ù„Ù Ø§Ù„Ø´Ø®ØµÙŠ'}
            </div>
            <p className="text-xs text-slate-400 mt-1">ÙŠØ¤Ø®Ø° Ù…Ù† Ø§Ù„Ø¨Ø§ÙŠÙˆ ÙÙŠ Ø¥Ø¹Ø¯Ø§Ø¯Ø§Øª Ø§Ù„Ù…Ù„Ù Ø§Ù„Ø´Ø®ØµÙŠ</p>
          </div>

          {selectedStageId && (
            <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4">
              <p className="text-sm text-emerald-300 font-medium flex items-center gap-1.5">
                <Users className="w-4 h-4" /> Ø³ÙŠØªÙ… Ø¥Ù†Ø´Ø§Ø¡ Ø±Ø§Ø¨Ø· ÙˆØ§Ø­Ø¯ Ù…Ø´ØªØ±Ùƒ Ù„ÙƒÙ„ Ø·Ù„Ø§Ø¨ Ù…Ø±Ø­Ù„Ø© <strong>{selectedStage?.name}</strong>
              </p>
              <p className="text-xs text-emerald-400 mt-1">Ø§Ù„Ø·Ø§Ù„Ø¨ ÙŠØ±ÙØ¹ Ù‡ÙˆÙŠØªÙ‡ â†’ ÙŠØªØ·Ø§Ø¨Ù‚ Ø§Ù„Ø§Ø³Ù… â†’ ÙŠØ´ÙˆÙ Ø£ÙŠØ§Ù… Ø­Ø¶ÙˆØ±Ù‡ ÙˆØºÙŠØ§Ø¨Ù‡</p>
            </div>
          )}

        </div>

        <div className="px-4 sm:px-6 py-4 border-t border-white/10 bg-gradient-to-l from-teal-500/15 to-emerald-500/15 shrink-0">
          <button
            onClick={handleGenerateLink}
            disabled={!selectedStageId || generating}
            className="btn-base btn-primary w-full"
          >
            {generating
              ? <><MorphingSquare size="sm" /> Ø¬Ø§Ø±ÙŠ Ø§Ù„ØªÙˆÙ„ÙŠØ¯...</>
              : <><Rocket className="w-5 h-5" /> ØªÙˆÙ„ÙŠØ¯ Ø±Ø§Ø¨Ø· Ø§Ù„Ø­Ø¶ÙˆØ±</>}
          </button>
        </div>

        {confirmState &&
          createPortal(
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[10000] p-4 animate-fadeIn" onClick={() => setConfirmState(null)}>
              <div ref={modalBehaviorRef} role="alertdialog" aria-modal="true" aria-labelledby="send-attendance-confirm-title" tabIndex={-1} className="glass-modal w-[calc(100vw-2rem)] max-w-sm text-white text-center animate-modalUp focus:outline-none" onClick={e => e.stopPropagation()}>
                <h3 id="send-attendance-confirm-title" className="text-base sm:text-lg font-semibold text-white mb-2">{confirmState.title}</h3>
                <p className="text-sm text-slate-400 mb-6 whitespace-pre-line">{confirmState.message}</p>
                <div className="flex flex-wrap gap-2">
                  <button onClick={confirmState.onConfirm} className="btn-base btn-primary flex-1">
                    {confirmState.confirmLabel || 'Ù…ÙˆØ§ÙÙ‚'}
                  </button>
                  <button onClick={() => setConfirmState(null)} className="btn-base btn-secondary flex-1">
                    Ø¥Ù„ØºØ§Ø¡
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