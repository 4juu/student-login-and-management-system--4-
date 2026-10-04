// src/components/Admin/SendEnrollLink.tsx
import React, { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useModalBehavior } from '../../hooks/useModalBehavior';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { Student, Stage, College } from '../../types/student';
import { createBulkRegistrationLinks } from '../../services/tokenService';
import {
  Check, Clock, Copy, FileSpreadsheet, Landmark, Library, Link2,
  Rocket, Smartphone, Users, ScanFace, UserCheck,
} from 'lucide-react';
import { LoadingState } from '../loading/LoadingState';
import { MorphingSquare } from '../MorphingSquare';
import { toast } from '@/hooks/use-toast';

interface SendEnrollLinkProps {
  adminUid: string;
  colleges: College[];
  stages: Stage[];
  loadStudents: (stageId: string) => Promise<Student[]>;
  onClose: () => void;
  /** 'id' (Ø§ÙØªØ±Ø§Ø¶ÙŠ): Ø±ÙØ¹ ØµÙˆØ±Ø© Ø§Ù„Ù‡ÙˆÙŠØ© Â· 'name': Ø±Ø§Ø¨Ø· Ø¨ØµÙ…Ø© ÙƒÙˆØ¯ â€” Ø§Ù„Ø·Ø§Ù„Ø¨ ÙŠÙƒØªØ¨ Ø§Ø³Ù…Ù‡ */
  mode?: 'id' | 'name' | undefined;
}

interface StudentLinkRow {
  student: Student;
  url: string;
  copied: boolean;
}

const FILE_PREFIX_ID = 'enroll_links';
const FILE_PREFIX_NAME = 'namecode_links';

const getFormattedDate = () => {
  const now = new Date();
  return {
    date: now.toLocaleDateString('ar-IQ', { year: 'numeric', month: 'long', day: 'numeric' }),
    timestamp: now.getTime(),
  };
};

const getFileName = (collegeName: string, stageName: string, prefix: string): string => {
  const { timestamp } = getFormattedDate();
  const cleanCollege = collegeName.replace(/[^\u0600-\u06FFa-zA-Z0-9]/g, '_');
  const cleanStage = stageName.replace(/[^\u0600-\u06FFa-zA-Z0-9]/g, '_');
  return `${prefix}_${cleanCollege}_${cleanStage}_${timestamp}.xlsx`;
};

const generateStudentExcel = async (
  rows: StudentLinkRow[],
  meta: { collegeName: string; stageName: string; expiryDays: number; date: string; mode: 'id' | 'name' },
): Promise<Blob> => {
  const XLSX = await import('xlsx-js-style');

  const data: any[][] = [];
  data.push([meta.mode === 'name' ? 'Ø±ÙˆØ§Ø¨Ø· Ø¨ØµÙ…Ø© ÙƒÙˆØ¯ Ù„Ù„Ø·Ù„Ø§Ø¨ (ÙƒØªØ§Ø¨Ø© Ø§Ù„Ø§Ø³Ù…)' : 'Ø±ÙˆØ§Ø¨Ø· ØªØ³Ø¬ÙŠÙ„ Ø¨ØµÙ…Ø© Ø§Ù„ÙˆØ¬Ù‡ Ù„Ù„Ø·Ù„Ø§Ø¨', '', '', '']);
  data.push(['', '', '', '']);
  data.push(['Ø§Ù„ÙƒÙ„ÙŠØ©', 'Ø§Ù„Ù…Ø±Ø­Ù„Ø©', 'ØµÙ„Ø§Ø­ÙŠØ© Ø§Ù„Ø±Ø§Ø¨Ø·', '']);
  data.push([meta.collegeName, meta.stageName, `${meta.expiryDays} ÙŠÙˆÙ…`, '']);
  data.push(['ØªØ§Ø±ÙŠØ® Ø§Ù„ØªÙˆÙ„ÙŠØ¯', meta.date, '', '']);
  data.push(['', '', '', '']);
  data.push(['Ø§Ù„Ø§Ø³Ù…', 'Ø§Ù„ÙƒÙˆØ¯', 'Ø§Ù„Ù…Ø¬Ù…ÙˆØ¹Ø©', 'Ø±Ø§Ø¨Ø· Ø§Ù„ØªØ³Ø¬ÙŠÙ„']);
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
  XLSX.utils.book_append_sheet(wb, ws, 'Ø±ÙˆØ§Ø¨Ø· Ø§Ù„Ø¨ØµÙ…Ø©');
  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true });
  return new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
};

const buildShareText = (
  rows: StudentLinkRow[],
  meta: { collegeName: string; stageName: string },
  mode: 'id' | 'name',
): string => {
  let text = mode === 'name'
    ? `ðŸ” Ø±ÙˆØ§Ø¨Ø· Ø¨ØµÙ…Ø© ÙƒÙˆØ¯\n\nØ§Ù„ÙƒÙ„ÙŠØ©: ${meta.collegeName}\nØ§Ù„Ù…Ø±Ø­Ù„Ø©: ${meta.stageName}\nØ¹Ø¯Ø¯ Ø§Ù„Ø·Ù„Ø§Ø¨: ${rows.length}\n\n`
    : `ðŸ” Ø±ÙˆØ§Ø¨Ø· ØªØ³Ø¬ÙŠÙ„ Ø¨ØµÙ…Ø© Ø§Ù„ÙˆØ¬Ù‡\n\nØ§Ù„ÙƒÙ„ÙŠØ©: ${meta.collegeName}\nØ§Ù„Ù…Ø±Ø­Ù„Ø©: ${meta.stageName}\nØ¹Ø¯Ø¯ Ø§Ù„Ø·Ù„Ø§Ø¨: ${rows.length}\n\n`;
  rows.forEach((r, i) => {
    text += `${i + 1}. ${r.student.name}${r.student.code ? ` (${r.student.code})` : ''}\n${r.url}\n\n`;
  });
  text += mode === 'name'
    ? 'Ù„ÙƒÙ„ Ø·Ø§Ù„Ø¨ Ø±Ø§Ø¨Ø·Ù‡ Ø§Ù„Ø®Ø§Øµ â€” ÙŠÙØªØ­Ù‡ ÙˆÙŠÙƒØªØ¨ Ø§Ø³Ù…Ù‡ØŒ ÙˆØ¥Ø°Ø§ Ø·Ø§Ø¨Ù‚ Ù…Ø¹ Ø³Ø¬Ù„Ù‡ ÙŠØ³Ø¬Ù‘Ù„ Ø¨ØµÙ…Ø© ÙˆØ¬Ù‡Ù‡.'
    : 'Ù„ÙƒÙ„ Ø·Ø§Ù„Ø¨ Ø±Ø§Ø¨Ø·Ù‡ Ø§Ù„Ø®Ø§Øµ â€” ÙŠÙØªØ­Ù‡ ÙˆÙŠØ±ÙØ¹ ØµÙˆØ±Ø© Ù‡ÙˆÙŠØªÙ‡ ÙˆÙŠØ³Ø¬Ù„ Ø¨ØµÙ…Ø© ÙˆØ¬Ù‡Ù‡.';
  return text;
};

export const SendEnrollLink: React.FC<SendEnrollLinkProps> = ({
  adminUid, colleges, stages, loadStudents, onClose, mode = 'id',
}) => {
  const isNameMode = mode === 'name';
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

  useBodyScrollLock(true);
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
      console.error('ÙØ´Ù„ ØªØ­Ù…ÙŠÙ„ Ø§Ù„Ø·Ù„Ø§Ø¨:', e);
      toast({ variant: 'destructive', title: 'ØªØ¹Ø°Ø± ØªØ­Ù…ÙŠÙ„ Ù‚Ø§Ø¦Ù…Ø© Ø§Ù„Ø·Ù„Ø§Ø¨' });
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
    if (!selectedStageId) { toast({ variant: 'destructive', title: 'Ø§Ù„Ø±Ø¬Ø§Ø¡ Ø§Ø®ØªÙŠØ§Ø± Ù…Ø±Ø­Ù„Ø©' }); return; }
    if (selectedIds.size === 0) { toast({ variant: 'destructive', title: 'Ø§Ù„Ø±Ø¬Ø§Ø¡ ØªØ­Ø¯ÙŠØ¯ Ø·Ø§Ù„Ø¨ ÙˆØ§Ø­Ø¯ Ø¹Ù„Ù‰ Ø§Ù„Ø£Ù‚Ù„' }); return; }
    setGenerating(true);
    try {
      const chosen = students.filter(s => selectedIds.has(s.id));
      const results = await createBulkRegistrationLinks(
        adminUid,
        selectedStageId,
        chosen.map(s => ({ id: s.id, name: s.name, code: s.code, qrCodeId: s.qrCodeId })),
        expiryDays,
        isNameMode ? 'namecheck' : 'single',
      );
      const byId = new Map(results.map(r => [r.studentId, r.url]));
      const rows: StudentLinkRow[] = chosen
        .filter(s => byId.has(s.id))
        .map(s => ({ student: s, url: byId.get(s.id)!, copied: false }));
      setResultRows(rows);
    } catch (e: any) {
      console.error(e);
      toast({ variant: 'destructive', title: 'ÙØ´Ù„ ØªÙˆÙ„ÙŠØ¯ Ø§Ù„Ø±ÙˆØ§Ø¨Ø·', description: e?.message || undefined });
    } finally {
      setGenerating(false);
    }
  };

  const copyRow = async (url: string, idx: number) => {
    try {
      await navigator.clipboard.writeText(url);
      setResultRows(prev => prev.map((r, i) => i === idx ? { ...r, copied: true } : r));
      setTimeout(() => setResultRows(prev => prev.map((r, i) => i === idx ? { ...r, copied: false } : r)), 2000);
    } catch { toast({ variant: 'destructive', title: 'ÙØ´Ù„ Ø§Ù„Ù†Ø³Ø®' }); }
  };

  const downloadStudentExcel = async () => {
    if (resultRows.length === 0) return;
    const blob = await generateStudentExcel(resultRows, {
      collegeName: selectedCollege?.name || 'ØºÙŠØ± Ù…Ø­Ø¯Ø¯',
      stageName: selectedStage?.name || 'ØºÙŠØ± Ù…Ø­Ø¯Ø¯',
      expiryDays,
      date: getFormattedDate().date,
      mode,
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = getFileName(selectedCollege?.name || 'ÙƒÙ„', selectedStage?.name || 'Ø§Ù„ÙƒÙ„', isNameMode ? FILE_PREFIX_NAME : FILE_PREFIX_ID);
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const shareWhatsAppStudents = () => {
    if (resultRows.length === 0) return;
    const text = encodeURIComponent(buildShareText(resultRows, {
      collegeName: selectedCollege?.name || 'ØºÙŠØ± Ù…Ø­Ø¯Ø¯',
      stageName: selectedStage?.name || 'ØºÙŠØ± Ù…Ø­Ø¯Ø¯',
    }, mode));
    const a = document.createElement('a');
    a.href = `https://wa.me/?text=${text}`;
    a.target = '_blank'; a.rel = 'noopener noreferrer';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  };

  const copyAllStudents = async () => {
    if (resultRows.length === 0) return;
    const text = buildShareText(resultRows, {
      collegeName: selectedCollege?.name || 'ØºÙŠØ± Ù…Ø­Ø¯Ø¯',
      stageName: selectedStage?.name || 'ØºÙŠØ± Ù…Ø­Ø¯Ø¯',
    }, mode);
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: `ØªÙ… Ù†Ø³Ø® ${resultRows.length} Ø±Ø§Ø¨Ø·Ø§Ù‹ Ù…Ø¹ Ø§Ù„Ø£Ø³Ù…Ø§Ø¡` });
    } catch { toast({ variant: 'destructive', title: 'ÙØ´Ù„ Ø§Ù„Ù†Ø³Ø®' }); }
  };

  if (resultRows.length > 0) {
    return createPortal(
      <div className="fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center p-4 animate-fadeIn" dir="rtl">
        <div role="dialog" aria-modal="true" aria-labelledby="enroll-links-result-title" tabIndex={-1} className="glass-modal p-0 text-white w-[calc(100vw-2rem)] max-w-2xl flex flex-col overflow-hidden animate-modalUp focus:outline-none">
          <div className="px-4 sm:px-6 py-4 sm:py-5 border-b border-white/10 bg-gradient-to-l from-violet-500/15 to-purple-500/15 shrink-0">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 id="enroll-links-result-title" className="text-base sm:text-lg font-semibold text-white flex items-center gap-2">
                  <UserCheck className="w-5 h-5 text-violet-400 shrink-0" /> ØªÙ… ØªÙˆÙ„ÙŠØ¯ {resultRows.length} {isNameMode ? 'Ø±Ø§Ø¨Ø· Ø¨ØµÙ…Ø© ÙƒÙˆØ¯' : 'Ø±Ø§Ø¨Ø· Ø¨ØµÙ…Ø©'}
                </h2>
                <p className="text-sm text-slate-400 mt-1">
                  <strong className="text-violet-300">{selectedStage?.name}</strong> â€¢ {selectedCollege?.name}
                </p>
              </div>
              <button onClick={onClose} aria-label="Ø¥ØºÙ„Ø§Ù‚" className="shrink-0 bg-red-500/20 hover:bg-red-500/30 text-red-300 w-10 h-10 rounded-full font-bold text-lg transition duration-200">âœ•</button>
            </div>
          </div>

          <div className="px-4 sm:px-6 py-4 border-b border-white/10 bg-white/5 flex flex-wrap gap-2 items-center shrink-0">
            <button onClick={copyAllStudents} className="btn-base btn-primary">
              <Copy className="w-4 h-4" /> Ù†Ø³Ø® Ø§Ù„ÙƒÙ„
            </button>
            <button onClick={downloadStudentExcel} className="btn-base btn-secondary">
              <FileSpreadsheet className="w-4 h-4" /> ØªØ­Ù…ÙŠÙ„ Excel
            </button>
            <button onClick={shareWhatsAppStudents} className="btn-base btn-secondary">
              <Smartphone className="w-4 h-4" /> ÙˆØ§ØªØ³Ø§Ø¨
            </button>
            <div className="hidden sm:block flex-1" />
            <div className="flex items-center gap-2 bg-violet-500/15 px-3 py-1.5 rounded-lg border border-violet-500/30">
              <Clock className="w-3.5 h-3.5 text-violet-300" />
              <span className="text-xs text-violet-300 font-medium">ØµØ§Ù„Ø­Ø© {expiryDays} ÙŠÙˆÙ…</span>
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 py-4 space-y-3">
            {resultRows.map((r, i) => (
              <div key={r.student.id} className="bg-white/5 border border-white/10 rounded-xl p-3">
                <div className="flex items-center justify-between gap-3 mb-2">
                  <div className="min-w-0">
                    <p className="font-bold text-white truncate">{r.student.name}</p>
                    <p className="text-xs text-slate-400 font-mono">
                      {r.student.code || 'â€”'}{r.student.group ? ` â€¢ ${r.student.group}` : ''}
                    </p>
                  </div>
                  <button onClick={() => copyRow(r.url, i)} className="shrink-0 px-3 py-1.5 bg-blue-600/80 hover:bg-blue-600 text-white text-xs font-bold rounded-lg flex items-center gap-1">
                    {r.copied ? <><Check className="w-3 h-3" /> ØªÙ…</> : <><Copy className="w-3 h-3" /> Ù†Ø³Ø®</>}
                  </button>
                </div>
                <div className="bg-slate-800 border border-slate-600 rounded-lg px-2 py-1.5 text-xs font-mono text-slate-300 break-all" dir="ltr">
                  {r.url}
                </div>
              </div>
            ))}
          </div>

          <div className="px-4 sm:px-6 py-3 border-t border-white/10 bg-white/5 text-center shrink-0">
            <button onClick={() => { setResultRows([]); }} className="text-sm text-violet-400 hover:text-violet-300 font-medium hover:underline flex items-center gap-1 mx-auto transition-colors duration-200">
              <Link2 className="w-4 h-4" /> ØªÙˆÙ„ÙŠØ¯ Ø±ÙˆØ§Ø¨Ø· Ø£Ø®Ø±Ù‰
            </button>
          </div>
        </div>
      </div>,
      document.body,
    );
  }

  return createPortal(
    <div className="fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center p-4 animate-fadeIn" dir="rtl">
      <div role="dialog" aria-modal="true" aria-labelledby="send-enroll-links-title" tabIndex={-1} className="glass-modal p-0 text-white w-[calc(100vw-2rem)] max-w-2xl flex flex-col overflow-hidden animate-modalUp focus:outline-none">
        <div className="px-4 sm:px-6 py-4 sm:py-5 border-b border-white/10 bg-gradient-to-l from-purple-500/15 to-violet-500/15 shrink-0">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 id="send-enroll-links-title" className="text-base sm:text-lg font-semibold text-white flex items-center gap-2">
                <ScanFace className="w-5 h-5 text-purple-400 shrink-0" /> {isNameMode ? 'Ø¥Ø±Ø³Ø§Ù„ Ø±Ø§Ø¨Ø· Ø¨ØµÙ…Ø© ÙƒÙˆØ¯' : 'Ø¥Ø±Ø³Ø§Ù„ Ø±ÙˆØ§Ø¨Ø· ØªØ³Ø¬ÙŠÙ„ Ø¨ØµÙ…Ø© Ø§Ù„ÙˆØ¬Ù‡'}
              </h2>
              <p className="text-sm text-slate-400 mt-1">
                {isNameMode
                  ? 'Ø§Ø®ØªØ± Ø§Ù„ÙƒÙ„ÙŠØ© ÙˆØ§Ù„Ù…Ø±Ø­Ù„Ø© Ø«Ù… Ø­Ø¯Ø¯ Ø§Ù„Ø·Ù„Ø§Ø¨ â€” ÙƒÙ„ Ø·Ø§Ù„Ø¨ ÙŠÙØªØ­ Ø±Ø§Ø¨Ø·Ù‡ ÙˆÙŠÙƒØªØ¨ Ø§Ø³Ù…Ù‡ Ø¨Ø¯Ù„ Ø±ÙØ¹ Ø§Ù„Ù‡ÙˆÙŠØ©'
                  : 'Ø§Ø®ØªØ± Ø§Ù„ÙƒÙ„ÙŠØ© ÙˆØ§Ù„Ù…Ø±Ø­Ù„Ø© Ø«Ù… Ø­Ø¯Ø¯ Ø§Ù„Ø·Ù„Ø§Ø¨ Ù„Ø¥Ù†Ø´Ø§Ø¡ Ø±Ø§Ø¨Ø· Ø®Ø§Øµ Ù„ÙƒÙ„ Ø·Ø§Ù„Ø¨'}
              </p>
            </div>
            <button onClick={onClose} aria-label="Ø¥ØºÙ„Ø§Ù‚" className="shrink-0 bg-red-500/20 hover:bg-red-500/30 text-red-300 w-10 h-10 rounded-full font-bold text-lg transition duration-200">âœ•</button>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 py-4 sm:py-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="block text-sm font-bold text-slate-300 flex items-center gap-1.5"><Landmark className="w-4 h-4" /> Ø§Ù„ÙƒÙ„ÙŠØ©</label>
              <select
                value={selectedCollegeId}
                onChange={e => { setSelectedCollegeId(e.target.value); setSelectedStageId(''); setStudents([]); setSelectedIds(new Set()); }}
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

          <div className="bg-violet-500/10 border border-violet-500/30 rounded-xl p-3">
            <label className="flex items-center justify-between text-sm font-bold text-violet-300 mb-1">
              <span className="flex items-center gap-1.5"><Clock className="w-4 h-4" /> Ù…Ø¯Ø© ØµÙ„Ø§Ø­ÙŠØ© Ø§Ù„Ø±ÙˆØ§Ø¨Ø·</span>
              <span className="bg-violet-600 text-white px-3 py-1 rounded-full text-xs">{expiryDays} ÙŠÙˆÙ…</span>
            </label>
            <input type="range" min="1" max="90" value={expiryDays} onChange={e => setExpiryDays(Number(e.target.value))} className="w-full accent-violet-500 h-2" />
          </div>

          {selectedStageId && (
            <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <p className="text-sm font-bold text-slate-200 flex items-center gap-1.5">
                  <Users className="w-4 h-4" /> Ø§Ù„Ø·Ù„Ø§Ø¨ ({students.length})
                </p>
                <div className="flex items-center gap-2">
                  {groups.length > 0 && (
                    <select
                      value={groupFilter}
                      onChange={e => setGroupFilter(e.target.value)}
                      className="px-2 py-1.5 border border-slate-600 bg-slate-800 text-white rounded-lg text-xs"
                    >
                      <option value="">ÙƒÙ„ Ø§Ù„Ù…Ø¬Ù…ÙˆØ¹Ø§Øª</option>
                      {groups.map(g => <option key={g} value={g}>{g}</option>)}
                    </select>
                  )}
                  <button
                    onClick={toggleSelectAll}
                    className="px-3 py-1.5 bg-violet-600/20 hover:bg-violet-600/40 text-violet-200 text-xs font-bold rounded-lg border border-violet-500/30"
                  >
                    {filteredStudents.length > 0 && filteredStudents.every(s => selectedIds.has(s.id)) ? 'Ø¥Ù„ØºØ§Ø¡ ØªØ­Ø¯ÙŠØ¯ Ø§Ù„ÙƒÙ„' : 'ØªØ­Ø¯ÙŠØ¯ Ø§Ù„ÙƒÙ„'}
                  </button>
                </div>
              </div>

              {loadingStudents ? (
                <LoadingState size="sm" className="py-6" />
              ) : (
                <div className="max-h-64 overflow-y-auto space-y-1.5 border border-white/10 rounded-lg p-2">
                  {filteredStudents.length === 0 && (
                    <p className="text-center text-sm text-slate-500 py-6">Ù„Ø§ ÙŠÙˆØ¬Ø¯ Ø·Ù„Ø§Ø¨ ÙÙŠ Ù‡Ø°Ù‡ Ø§Ù„Ù…Ø±Ø­Ù„Ø©</p>
                  )}
                  {filteredStudents.map(s => {
                    const sel = selectedIds.has(s.id);
                    return (
                      <label key={s.id} className={`flex items-center gap-3 px-3 py-2 rounded-lg border cursor-pointer transition ${sel ? 'bg-violet-500/15 border-violet-400/50' : 'bg-white/[0.04] border-white/[0.08] hover:bg-white/[0.08]'}`}>
                        <input type="checkbox" checked={sel} onChange={() => toggleStudent(s.id)} className="w-4 h-4 accent-violet-500" />
                        <span className="flex-1 min-w-0">
                          <span className="block text-sm font-bold text-white truncate">{s.name}</span>
                          <span className="block text-xs text-slate-400">{s.code || 'â€”'}{s.group ? ` â€¢ ${s.group}` : ''}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}

              <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-3 py-2 text-sm text-emerald-300">
                {isNameMode
                  ? <>ØªÙ… ØªØ­Ø¯ÙŠØ¯ <strong>{selectedIds.size}</strong> Ø·Ø§Ù„Ø¨ â€” Ø³ÙŠÙÙˆÙ„ÙŽÙ‘Ø¯ Ø±Ø§Ø¨Ø· Ø®Ø§Øµ Ø¨ÙƒÙ„ Ø·Ø§Ù„Ø¨ØŒ ÙŠÙØªØ­Ù‡ ÙˆÙŠÙƒØªØ¨ Ø§Ø³Ù…Ù‡ ÙˆÙŠÙØ·Ø§Ø¨Ù‚ Ù…Ø¹ Ø³Ø¬Ù„Ù‡ Ù‚Ø¨Ù„ ØªØ³Ø¬ÙŠÙ„ Ø§Ù„Ø¨ØµÙ…Ø©.</>
                  : <>ØªÙ… ØªØ­Ø¯ÙŠØ¯ <strong>{selectedIds.size}</strong> Ø·Ø§Ù„Ø¨ â€” Ø³ÙŠÙÙˆÙ„ÙŽÙ‘Ø¯ Ø±Ø§Ø¨Ø· Ø®Ø§Øµ Ø¨ÙƒÙ„ Ø·Ø§Ù„Ø¨ ÙŠØ­Ù…Ù„ Ø§Ø³Ù…Ù‡ ÙˆÙƒÙˆØ¯Ù‡ØŒ ÙˆÙ„Ø§ ÙŠØ¹Ù…Ù„ Ø¥Ù„Ø§ Ù„Ù‡.</>}
              </div>
            </div>
          )}
        </div>

        <div className="px-4 sm:px-6 py-4 border-t border-white/10 bg-gradient-to-l from-purple-500/15 to-violet-500/15 shrink-0">
          <button
            onClick={() => {
              if (selectedIds.size === 0 && selectedStageId) {
                setConfirmState({
                  title: 'ØªÙˆÙ„ÙŠØ¯ Ø±ÙˆØ§Ø¨Ø· Ù„ÙƒÙ„ Ø·Ù„Ø§Ø¨ Ø§Ù„Ù…Ø±Ø­Ù„Ø©',
                  message: `Ù„Ù… ØªØ­Ø¯Ø¯ Ø·Ù„Ø§Ø¨Ø§Ù‹. Ù‡Ù„ ØªØ±ÙŠØ¯ ØªÙˆÙ„ÙŠØ¯ Ø±Ø§Ø¨Ø· Ù„ÙƒÙ„ Ø·Ù„Ø§Ø¨ Ù…Ø±Ø­Ù„Ø© Â«${selectedStage?.name}Â» (${students.length} Ø·Ø§Ù„Ø¨)ØŸ`,
                  confirmLabel: 'Ù†Ø¹Ù…ØŒ Ø§Ù„ÙƒÙ„',
                  onConfirm: () => { setSelectedIds(new Set(students.map(s => s.id))); setConfirmState(null); doGenerateIndividual(); },
                });
                return;
              }
              doGenerateIndividual();
            }}
            disabled={!selectedStageId || generating}
            className="btn-base btn-primary w-full"
          >
            {generating ? <><MorphingSquare size="sm" /> Ø¬Ø§Ø±ÙŠ Ø§Ù„ØªÙˆÙ„ÙŠØ¯...</> : <><Rocket className="w-5 h-5" /> ØªÙˆÙ„ÙŠØ¯ Ø§Ù„Ø±ÙˆØ§Ø¨Ø· Ø§Ù„Ù…Ø­Ø¯Ø¯Ø©</>}
          </button>
        </div>

        {confirmState &&
          createPortal(
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[10000] p-4 animate-fadeIn" onClick={() => setConfirmState(null)}>
              <div ref={modalBehaviorRef} role="alertdialog" aria-modal="true" aria-labelledby="send-enroll-confirm-title" tabIndex={-1} className="glass-modal w-[calc(100vw-2rem)] max-w-sm text-white text-center animate-modalUp focus:outline-none" onClick={e => e.stopPropagation()}>
                <h3 id="send-enroll-confirm-title" className="text-base sm:text-lg font-semibold text-white mb-2">{confirmState.title}</h3>
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
            document.body,
          )}
      </div>
    </div>,
    document.body,
  );
};

export default SendEnrollLink;
