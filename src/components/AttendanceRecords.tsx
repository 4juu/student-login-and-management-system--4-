import React, { useState, useMemo, useCallback } from 'react';
import { AttendanceRecord, AttendanceSession, Student } from '../types/student';
import { getCurrentAcademicYear } from '../firebase/dataService';
import { CalendarCheck, CalendarRange, Check, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, CircleCheck, CircleX, Download, FileSpreadsheet, GraduationCap, Pencil, QrCode, Trash2, X } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { createPortal } from 'react-dom';

interface AttendanceRecordsProps {
  records: AttendanceRecord[];
  sessions: AttendanceSession[];
  students?: Student[];
  activeSessionId: string | null;
  onClearRecords: () => void;
  onUpdateRecord?: (recordId: string, updates: Partial<AttendanceRecord>) => void;
  onDeleteRecord?: (recordId: string) => void;
}

const PAGE_SIZE_OPTIONS = [50, 100, 200, 500];
const DEFAULT_PAGE_SIZE = 100;

export const AttendanceRecords: React.FC<AttendanceRecordsProps> = React.memo(({
  records,
  sessions,
  students = [],
  activeSessionId,
  onClearRecords,
  onUpdateRecord,
  onDeleteRecord,
}) => {
  // 🆕 السنة الأكاديمية الحالية (للعرض)
  const currentAcademicYear = useMemo(() => getCurrentAcademicYear(), []);

  // 🎯 useCallback للـ helper function
  const normalizeAnyDate = useCallback((dateStr: string): string => {
    if (!dateStr) return '';
    const arabicNumbers = '٠١٢٣٤٥٦٧٨٩';
    const englishNumbers = '0123456789';
    let normalized = dateStr.replace(/[٠-٩]/g, (d) => englishNumbers[arabicNumbers.indexOf(d)]);
    normalized = normalized.replace(/[‏‎\u200E\u200F]/g, '').trim();

    if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return normalized;

    const slashMatch = normalized.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (slashMatch) {
      const [, day, month, year] = slashMatch;
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }

    return normalized;
  }, []);

  const sortedSessions = useMemo(() => 
    [...sessions].sort((a, b) =>
      normalizeAnyDate(a.date).localeCompare(normalizeAnyDate(b.date))
    ), [sessions, normalizeAnyDate]);

  const { firstDate, lastDate } = useMemo(() => {
    const t = new Date().toISOString().split('T')[0];
    const f = sortedSessions.length > 0 ? normalizeAnyDate(sortedSessions[0].date) : t;
    const l = sortedSessions.length > 0 ? normalizeAnyDate(sortedSessions[sortedSessions.length - 1].date) : t;
    return { today: t, firstDate: f, lastDate: l };
  }, [sortedSessions, normalizeAnyDate]);

  const normalizedDateOptions = useMemo(() =>
    [...sessions].map(s => ({
      id: s.id,
      name: s.name,
      isoDate: normalizeAnyDate(s.date),
    })).sort((a, b) => a.isoDate.localeCompare(b.isoDate)).reverse(),
  [sessions, normalizeAnyDate]);

  // ============================================================
  // 📋 جدول سجل عمليات الدخول المباشر
  // ============================================================

  const studentMap = useMemo(() => new Map(students.map(s => [s.id, s])), [students]);
  const sessionNameMap = useMemo(() => new Map(sessions.map(s => [s.id, s.name])), [sessions]);

  const sessionRecordCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const record of records) {
      counts.set(record.sessionId, (counts.get(record.sessionId) || 0) + 1);
    }
    return counts;
  }, [records]);

  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(activeSessionId);
  const [searchRecord, setSearchRecord] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);

  const filteredRecords = useMemo(() => {
    let filtered = selectedSessionId ? records.filter(r => r.sessionId === selectedSessionId) : records;
    if (searchRecord.trim()) {
      const q = searchRecord.trim().toLowerCase();
      filtered = filtered.filter(rec => {
        const stu = studentMap.get(rec.studentId);
        const nameMatch = stu ? stu.name.toLowerCase().includes(q) : false;
        const idMatch = rec.studentId.toLowerCase().includes(q);
        const timeMatch = (rec.time || '').toLowerCase().includes(q);
        return nameMatch || idMatch || timeMatch;
      });
    }
    return filtered;
  }, [records, selectedSessionId, searchRecord, studentMap]);

  const totalPages = Math.max(1, Math.ceil(filteredRecords.length / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const paginatedRecords = useMemo(() => {
    const start = (safeCurrentPage - 1) * pageSize;
    return filteredRecords.slice(start, start + pageSize);
  }, [filteredRecords, safeCurrentPage, pageSize]);

  React.useEffect(() => {
    if (activeSessionId) setSelectedSessionId(activeSessionId);
  }, [activeSessionId]);

  React.useEffect(() => {
    setCurrentPage(1);
  }, [selectedSessionId, searchRecord, filteredRecords.length]);

  const [exportType, setExportType] = useState<'single' | 'range'>('range');
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [startDate, setStartDate] = useState<string>(firstDate);
  const [endDate, setEndDate] = useState<string>(lastDate);
  const [singleDate, setSingleDate] = useState<string>(lastDate);

  const [editingRecord, setEditingRecord] = useState<AttendanceRecord | null>(null);
  const [editStatus, setEditStatus] = useState<'present' | 'absent'>('present');
  const [editTime, setEditTime] = useState('');

  const handleOpenEdit = (rec: AttendanceRecord) => {
    setEditingRecord(rec);
    setEditStatus(rec.status === 'absent' ? 'absent' : 'present');
    setEditTime(rec.time || '');
  };

  const handleSaveEdit = () => {
    if (!editingRecord) return;
    onUpdateRecord?.(editingRecord.id, { status: editStatus, time: editTime });
    setEditingRecord(null);
  };

  const handleDeleteRecord = (rec: AttendanceRecord) => {
    if (!window.confirm(`هل أنت متأكد من حذف سجل حضور "${rec.studentName}"؟`)) return;
    onDeleteRecord?.(rec.id);
  };

  // ============================================================
  // 🎨 الأنماط (Styles) للخلايا
  // ============================================================

  const headerStyle = {
    font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 14, name: 'Arial' },
    fill: { fgColor: { rgb: '1E40AF' } },
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    border: {
      top: { style: 'medium', color: { rgb: '000000' } },
      bottom: { style: 'medium', color: { rgb: '000000' } },
      left: { style: 'thin', color: { rgb: '000000' } },
      right: { style: 'thin', color: { rgb: '000000' } },
    }
  };

  const presentStyle = {
    font: { bold: true, color: { rgb: '14532D' }, sz: 16, name: 'Arial' },
    fill: { fgColor: { rgb: 'BBF7D0' } },
    alignment: { horizontal: 'center', vertical: 'center' },
    border: {
      top: { style: 'thin', color: { rgb: '15803D' } },
      bottom: { style: 'thin', color: { rgb: '15803D' } },
      left: { style: 'thin', color: { rgb: '15803D' } },
      right: { style: 'thin', color: { rgb: '15803D' } },
    }
  };

  const absentStyle = {
    font: { bold: true, color: { rgb: '7F1D1D' }, sz: 16, name: 'Arial' },
    fill: { fgColor: { rgb: 'FECACA' } },
    alignment: { horizontal: 'center', vertical: 'center' },
    border: {
      top: { style: 'thin', color: { rgb: 'B91C1C' } },
      bottom: { style: 'thin', color: { rgb: 'B91C1C' } },
      left: { style: 'thin', color: { rgb: 'B91C1C' } },
      right: { style: 'thin', color: { rgb: 'B91C1C' } },
    }
  };

  const dataStyle = {
    font: { sz: 12, name: 'Arial', color: { rgb: '1F2937' } },
    fill: { fgColor: { rgb: 'FFFFFF' } },
    alignment: { horizontal: 'center', vertical: 'center' },
    border: {
      top: { style: 'thin', color: { rgb: '94A3B8' } },
      bottom: { style: 'thin', color: { rgb: '94A3B8' } },
      left: { style: 'thin', color: { rgb: '94A3B8' } },
      right: { style: 'thin', color: { rgb: '94A3B8' } },
    }
  };

  const nameStyle = {
    font: { sz: 13, name: 'Arial', color: { rgb: '1F2937' }, bold: true },
    fill: { fgColor: { rgb: 'FFFFFF' } },
    alignment: { horizontal: 'right', vertical: 'center', indent: 1 },
    border: {
      top: { style: 'thin', color: { rgb: '94A3B8' } },
      bottom: { style: 'thin', color: { rgb: '94A3B8' } },
      left: { style: 'thin', color: { rgb: '94A3B8' } },
      right: { style: 'thin', color: { rgb: '94A3B8' } },
    }
  };

  const totalAbsentStyle = {
    font: { bold: true, sz: 14, name: 'Arial', color: { rgb: 'FFFFFF' } },
    fill: { fgColor: { rgb: 'DC2626' } },
    alignment: { horizontal: 'center', vertical: 'center' },
    border: {
      top: { style: 'medium', color: { rgb: '7F1D1D' } },
      bottom: { style: 'medium', color: { rgb: '7F1D1D' } },
      left: { style: 'medium', color: { rgb: '7F1D1D' } },
      right: { style: 'medium', color: { rgb: '7F1D1D' } },
    }
  };

  const totalAbsentZeroStyle = {
    font: { bold: true, sz: 14, name: 'Arial', color: { rgb: 'FFFFFF' } },
    fill: { fgColor: { rgb: '16A34A' } },
    alignment: { horizontal: 'center', vertical: 'center' },
    border: {
      top: { style: 'medium', color: { rgb: '14532D' } },
      bottom: { style: 'medium', color: { rgb: '14532D' } },
      left: { style: 'medium', color: { rgb: '14532D' } },
      right: { style: 'medium', color: { rgb: '14532D' } },
    }
  };

  const indexStyle = {
    font: { bold: true, sz: 12, name: 'Arial', color: { rgb: '475569' } },
    fill: { fgColor: { rgb: 'F1F5F9' } },
    alignment: { horizontal: 'center', vertical: 'center' },
    border: {
      top: { style: 'thin', color: { rgb: '94A3B8' } },
      bottom: { style: 'thin', color: { rgb: '94A3B8' } },
      left: { style: 'thin', color: { rgb: '94A3B8' } },
      right: { style: 'thin', color: { rgb: '94A3B8' } },
    }
  };

  // ============================================================
  // 📊 إنشاء وتصدير ملف الإكسل المنسق
  // ============================================================
  const handleExportOfficialExcel = async (): Promise<boolean> => {
    if (students.length === 0) {
      alert('لا يوجد طلاب مسجلين في هذه المرحلة للتصدير.');
      return false;
    }

    if (sessions.length === 0) {
      alert('لا توجد أيام حضور (سجلات) مسجلة للتصدير.');
      return false;
    }

    let targetSessions: AttendanceSession[] = [];

    const normalizeForFilter = (dateStr: string): string => {
      if (!dateStr) return '';
      const arabicNumbers = '٠١٢٣٤٥٦٧٨٩';
      const englishNumbers = '0123456789';
      let normalized = dateStr.replace(/[٠-٩]/g, (d) => englishNumbers[arabicNumbers.indexOf(d)]);
      normalized = normalized.replace(/[‏‎\u200E\u200F]/g, '').trim();

      if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return normalized;

      const slashMatch = normalized.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (slashMatch) {
        const [, day, month, year] = slashMatch;
        return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
      }

      const slashMatchYMD = normalized.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
      if (slashMatchYMD) {
        const [, year, month, day] = slashMatchYMD;
        return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
      }

      return normalized;
    };

    if (exportType === 'single') {
      if (!singleDate) { alert('الرجاء تحديد التاريخ'); return false; }
      targetSessions = sessions.filter(s => normalizeForFilter(s.date) === singleDate);
      if (targetSessions.length === 0) {
        alert(`لا توجد سجلات حضور مسجلة في يوم ${singleDate}`);
        return false;
      }
    } else {
      if (!startDate || !endDate) { alert('الرجاء تحديد تاريخ البدء والانتهاء'); return false; }
      targetSessions = sessions.filter(s => {
        const normalized = normalizeForFilter(s.date);
        return normalized >= startDate && normalized <= endDate;
      });
      if (targetSessions.length === 0) {
        alert('لا توجد سجلات حضور في هذه المدة الزمنية');
        return false;
      }
    }

    // 🚀 تحميل مكتبة Excel عند التصدير فقط (خارج حزمة البداية)
    const XLSX = await import('xlsx-js-style');

    targetSessions.sort((a, b) => normalizeForFilter(a.date).localeCompare(normalizeForFilter(b.date)));

    const normalizeDate = (dateStr: string): string => {
      if (!dateStr) return '';
      const arabicNumbers = '٠١٢٣٤٥٦٧٨٩';
      const englishNumbers = '0123456789';
      let normalized = dateStr.replace(/[٠-٩]/g, (d) => englishNumbers[arabicNumbers.indexOf(d)]);
      normalized = normalized.replace(/[‏‎\u200E\u200F]/g, '').trim();

      if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return normalized;

      const slashMatch = normalized.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (slashMatch) {
        const [, day, month, year] = slashMatch;
        return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
      }

      const slashMatchYMD = normalized.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
      if (slashMatchYMD) {
        const [, year, month, day] = slashMatchYMD;
        return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
      }

      return normalized;
    };

    const dateHeaders = targetSessions.map(s => {
      try {
        const normalizedDate = normalizeDate(s.date);
        const d = new Date(normalizedDate);

        if (isNaN(d.getTime())) {
          return s.name || s.date;
        }

        const dayName = d.toLocaleDateString('ar-EG', { weekday: 'long' });
        const day = String(d.getDate()).padStart(2, '0');
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const year = d.getFullYear();
        const formattedDate = `${year}/${month}/${day}`;

        return `${dayName}\n${formattedDate}`;
      } catch {
        return s.name || s.date;
      }
    });

    const generateStyledSheet = (orderedStudents: Student[]): any => {
      const headerRow = ['ت', 'اسم الطالب', 'الرمز', 'الكروب', ...dateHeaders, 'إجمالي الغياب'];
      const rows: any[][] = [headerRow];

      orderedStudents.forEach((student, index) => {
        let absentCount = 0;
        const row: any[] = [
          index + 1,
          student.name,
          student.code,
          student.group || '-',
        ];

        targetSessions.forEach(session => {
          const isPresent = records.some(r => r.sessionId === session.id && r.studentId === student.id && r.status === 'present');
          if (isPresent) {
            row.push('✅');
          } else {
            row.push('❌');
            absentCount++;
          }
        });

        row.push(absentCount);
        rows.push(row);
      });

      const ws = XLSX.utils.aoa_to_sheet(rows);
      ws['!views'] = [{ rightToLeft: true }];

      const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');

      for (let R = range.s.r; R <= range.e.r; R++) {
        for (let C = range.s.c; C <= range.e.c; C++) {
          const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
          if (!ws[cellAddress]) continue;

          if (R === 0) {
            ws[cellAddress].s = headerStyle;
            continue;
          }

          if (C === 0) {
            ws[cellAddress].s = indexStyle;
            continue;
          }

          if (C === 1) {
            ws[cellAddress].s = nameStyle;
            continue;
          }

          if (C === 2 || C === 3) {
            ws[cellAddress].s = dataStyle;
            continue;
          }

          if (C === range.e.c) {
            const value = ws[cellAddress].v;
            if (value === 0) {
              ws[cellAddress].s = totalAbsentZeroStyle;
            } else {
              ws[cellAddress].s = totalAbsentStyle;
            }
            continue;
          }

          const value = ws[cellAddress].v;
          if (value === '✅') {
            ws[cellAddress].s = presentStyle;
          } else if (value === '❌') {
            ws[cellAddress].s = absentStyle;
          }
        }
      }

      const colWidths = [
        { wch: 6 },
        { wch: 35 },
        { wch: 12 },
        { wch: 12 },
        ...dateHeaders.map(() => ({ wch: 16 })),
        { wch: 18 },
      ];
      ws['!cols'] = colWidths;

      const rowHeights: any[] = [{ hpt: 45 }];
      for (let i = 1; i < rows.length; i++) {
        rowHeights.push({ hpt: 28 });
      }
      ws['!rows'] = rowHeights;

      ws['!freeze'] = { xSplit: 4, ySplit: 1 };

      return ws;
    };

    const alphabeticalStudents = [...students].sort((a, b) => a.name.localeCompare(b.name, 'ar'));
    const ws1 = generateStyledSheet(alphabeticalStudents);

    const groupedStudents = [...students].sort((a, b) => {
      const ga = a.group || 'ZZZ';
      const gb = b.group || 'ZZZ';
      const la = ga.charAt(0).toUpperCase();
      const lb = gb.charAt(0).toUpperCase();
      if (la !== lb) return la.localeCompare(lb);
      const na = parseInt(ga.slice(1)) || 0;
      const nb = parseInt(gb.slice(1)) || 0;
      if (na !== nb) return na - nb;
      return a.name.localeCompare(b.name, 'ar');
    });
    const ws2 = generateStyledSheet(groupedStudents);

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws1, 'سجل أبجدي كلي');
    XLSX.utils.book_append_sheet(wb, ws2, 'سجل جميع الكروبات');

    // 🆕 اسم الملف يحتوي على السنة الأكاديمية
    let fileName = `سجل_الحضور_${currentAcademicYear}_`;
    if (exportType === 'single') {
      fileName += singleDate;
    } else {
      fileName += `من_${startDate}_الى_${endDate}`;
    }

    XLSX.writeFile(wb, `${fileName}.xlsx`);
    return true;
  };

  const handleClearRecords = () => {
    if (window.confirm('تحذير: هل أنت متأكد من حذف جميع سجلات الحضور لهذه المرحلة؟')) {
      onClearRecords();
    }
  };

  return (
    <div className="glass-card">
      {/* 🆕 شريط السنة الأكاديمية */}
      <div className="flex items-center gap-2 mb-6">
        <span className="glass-badge badge-blue">
          <GraduationCap className="w-4 h-4" />
          السنة الأكاديمية الحالية: {currentAcademicYear.replace('_', ' - ')}
        </span>
      </div>

      {/* ============================================================ */}
      {/* 📥 تصدير سجل الحضور والغياب */}
      {/* ============================================================ */}
      <button
        type="button"
        onClick={() => setExportOpen(true)}
        className="group w-full mb-6 sm:mb-8 p-4 sm:p-5 rounded-2xl border border-indigo-500/25 bg-gradient-to-l from-indigo-950/70 via-slate-900 to-slate-900 hover:border-indigo-400/45 hover:shadow-lg hover:shadow-indigo-950/40 transition-all duration-200 flex items-center gap-3 sm:gap-4 cursor-pointer text-right"
      >
        <span className="w-11 h-11 sm:w-14 sm:h-14 rounded-xl bg-gradient-to-br from-indigo-500 to-blue-700 flex items-center justify-center shrink-0 shadow-md group-hover:scale-105 transition-transform">
          <FileSpreadsheet className="w-6 h-6 sm:w-7 sm:h-7 text-white" />
        </span>
        <span className="flex-1">
          <span className="block text-base sm:text-lg font-bold text-white">تحميل سجل الحضور والغياب (Excel)</span>
          <span className="block text-xs sm:text-sm text-slate-400 mt-0.5">اختر المدة الزمنية ثم قم بتحميل الملف</span>
        </span>
        <ChevronLeft className="w-5 h-5 sm:w-6 sm:h-6 text-slate-400 group-hover:-translate-x-1 transition-transform shrink-0" />
      </button>

      {/* ============================================================ */}
      {/* 📋 سجل عمليات الدخول المباشر */}
      {/* ============================================================ */}
      <div className="mt-8 pt-6 border-t border-white/10">
        {/* 🧰 شريط الأدوات */}
        <div className="flex flex-wrap items-center gap-3 sm:gap-4 border-b border-white/10 pb-4 sm:pb-5 mb-4">
          <div className="flex items-center gap-2.5">
            <span className="w-9 h-9 rounded-lg bg-emerald-500/15 border border-emerald-500/20 flex items-center justify-center shrink-0">
              <CircleCheck className="w-5 h-5 text-emerald-400" />
            </span>
            <h3 className="font-bold text-base sm:text-lg text-white">
              سجل عمليات الدخول المباشر
            </h3>
          </div>

          <div className="ms-auto flex items-center gap-2 sm:gap-3 w-full sm:w-auto">
            <div className="relative flex-1 sm:flex-none sm:min-w-[220px]">
              <select
                value={selectedSessionId || ''}
                onChange={(e) => setSelectedSessionId(e.target.value || null)}
                className="glass-input px-3 py-2 text-sm"
              >
                <option value="">كل الجلسات ({records.length})</option>
                {sortedSessions.map(s => {
                  const count = sessionRecordCounts.get(s.id) || 0;
                  return (
                    <option key={s.id} value={s.id}>
                      {s.name} — {normalizeAnyDate(s.date)} ({count})
                    </option>
                  );
                })}
              </select>
            </div>

            <button
              onClick={handleClearRecords}
              disabled={records.length === 0}
              className="btn-base btn-secondary border-red-500/30 text-red-300 hover:bg-red-500/10 hover:border-red-400/40 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              <span>مسح السجلات</span>
            </button>
          </div>
        </div>

        {/* 🔍 البحث */}
        <div className="mb-4">
          <input
            type="text"
            placeholder="🔍 ابحث بالاسم أو الكود أو الوقت..."
            value={searchRecord}
            onChange={(e) => setSearchRecord(e.target.value)}
            className="glass-input mb-4"
          />
        </div>

        {/* 📊 الجدول */}
        <div className="table-container">
          <table className="glass-table min-w-[640px]">
            <thead>
              <tr>
                <th className="!text-center whitespace-nowrap">
                  <QrCode className="w-4 h-4 inline-block text-emerald-400" />
                </th>
                <th className="whitespace-nowrap">الطالب</th>
                <th className="!text-center whitespace-nowrap">الجلسة</th>
                <th className="!text-center whitespace-nowrap">الوقت</th>
                <th className="!text-center whitespace-nowrap">الحالة</th>
                {(onUpdateRecord || onDeleteRecord) && (
                  <th className="!text-center whitespace-nowrap">إجراءات</th>
                )}
              </tr>
            </thead>
            <tbody>
              {paginatedRecords.length > 0 ? paginatedRecords.map((rec) => {
                const stu = studentMap.get(rec.studentId);
                const isPresent = rec.status === 'present';
                return (
                  <tr key={rec.id}>
                    <td className="!text-center">
                      <QrCode className="w-4 h-4 text-slate-500 inline-block" />
                    </td>
                    <td className="font-semibold text-slate-100 whitespace-nowrap">
                      {stu ? (
                        <div className="flex flex-col">
                          <span>{stu.name}</span>
                          <span className="text-xs text-slate-500" dir="ltr">{rec.studentId}</span>
                        </div>
                      ) : (
                        <span className="text-slate-500">غير موجود</span>
                      )}
                    </td>
                    <td className="!text-center text-slate-400 whitespace-nowrap">{sessionNameMap.get(rec.sessionId) || '—'}</td>
                    <td className="!text-center text-slate-400 whitespace-nowrap" dir="ltr">{rec.time || '—'}</td>
                    <td className="!text-center">
                      {isPresent ? (
                        <span className="glass-badge badge-green">
                          <CircleCheck className="w-3.5 h-3.5" /> حاضر
                        </span>
                      ) : (
                        <span className="glass-badge badge-red">
                          <CircleX className="w-3.5 h-3.5" /> غائب
                        </span>
                      )}
                    </td>
                    {(onUpdateRecord || onDeleteRecord) && (
                      <td className="!text-center whitespace-nowrap">
                        <div className="flex items-center justify-center gap-1.5">
                          {onUpdateRecord && (
                            <button
                              onClick={() => handleOpenEdit(rec)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-amber-500/15 border border-amber-500/25 text-amber-300 hover:bg-amber-500/25 transition-colors text-xs font-bold"
                              title="تعديل السجل"
                            >
                              <Pencil className="w-3.5 h-3.5" /> تعديل
                            </button>
                          )}
                          {onDeleteRecord && (
                            <button
                              onClick={() => handleDeleteRecord(rec)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-red-500/15 border border-red-500/25 text-red-300 hover:bg-red-500/25 transition-colors text-xs font-bold"
                              title="حذف السجل"
                            >
                              <Trash2 className="w-3.5 h-3.5" /> حذف
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              }) : (
                <tr>
                  <td colSpan={6} className="!text-center px-4 py-12">
                    <div className="text-4xl mb-3">📭</div>
                    <p className="text-slate-400 text-sm mb-3">لا توجد سجلات لعرضها</p>
                    {searchRecord && (
                      <button
                        onClick={() => setSearchRecord('')}
                        className="px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-slate-300 hover:bg-white/10 text-xs font-bold transition-colors"
                      >
                        مسح البحث
                      </button>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* ⏳ شريط الترقيم الموحد */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 mt-4 pt-4 border-t border-white/10">
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <span className="whitespace-nowrap">عرض</span>
            <select
              value={pageSize}
              onChange={(e) => { setPageSize(Number(e.target.value)); setCurrentPage(1); }}
              className="bg-slate-800 border border-slate-600/70 rounded-lg text-slate-200 px-2 py-1.5 text-xs sm:text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
            >
              {PAGE_SIZE_OPTIONS.map(ps => (
                <option key={ps} value={ps}>{ps}</option>
              ))}
            </select>
            <span className="whitespace-nowrap">سجل من أصل {filteredRecords.length}</span>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setCurrentPage(1)}
              disabled={safeCurrentPage === 1}
              className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronsRight className="w-4 h-4" />
            </button>
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={safeCurrentPage === 1}
              className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            <span className="px-2.5 py-1.5 text-xs sm:text-sm font-bold bg-emerald-500/15 text-emerald-300 rounded-lg whitespace-nowrap">
              صفحة {safeCurrentPage} من {totalPages}
            </span>
            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={safeCurrentPage === totalPages}
              className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => setCurrentPage(totalPages)}
              disabled={safeCurrentPage === totalPages}
              className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronsLeft className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* ============================================================ */}
      {/* 📥 نافذة تصدير سجل الحضور والغياب */}
      {/* ============================================================ */}
      {createPortal(
      <AnimatePresence>
        {exportOpen && (
          <motion.div
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm"
              onClick={() => !exporting && setExportOpen(false)}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            />
            <motion.div
              className="relative w-full max-w-md rounded-2xl overflow-hidden bg-slate-900 border border-slate-700/60 shadow-2xl shadow-slate-950/50"
              initial={{ scale: 0.92, y: 28, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.95, y: 14, opacity: 0 }}
              transition={{ type: 'spring', damping: 24, stiffness: 320 }}
            >
              <div className="relative px-6 pt-6 pb-5 overflow-hidden bg-gradient-to-br from-indigo-600 via-violet-700 to-slate-900">
                <div className="absolute -top-16 -left-16 w-48 h-48 rounded-full bg-white/10 blur-2xl" />
                <div className="absolute -bottom-20 -right-10 w-40 h-40 rounded-full bg-fuchsia-500/20 blur-2xl" />
                <div className="relative flex items-center gap-3.5">
                  <div className="w-12 h-12 rounded-xl bg-white/15 backdrop-blur flex items-center justify-center shrink-0 shadow-inner">
                    <FileSpreadsheet className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-white">تصدير سجل الحضور والغياب</h3>
                    <p className="text-xs text-indigo-100/80 mt-0.5">حدد المدة الزمنية وقم بتحميل ملف Excel</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setExportOpen(false)}
                  disabled={exporting}
                  className="absolute top-4 left-4 w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors disabled:opacity-40"
                  aria-label="إغلاق"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-6 space-y-5">
                <div>
                  <p className="text-xs font-bold text-slate-300 mb-2">نوع المدة الزمنية</p>
                  <div className="grid grid-cols-2 gap-1.5 p-1.5 bg-slate-800/80 border border-slate-700/60 rounded-xl">
                    <button
                      type="button"
                      onClick={() => setExportType('single')}
                      className={`flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-bold transition-all ${
                        exportType === 'single'
                          ? 'bg-gradient-to-r from-indigo-500 to-violet-600 text-white shadow-lg shadow-indigo-600/30'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <CalendarCheck className="w-4 h-4" /> يوم واحد
                    </button>
                    <button
                      type="button"
                      onClick={() => setExportType('range')}
                      className={`flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-bold transition-all ${
                        exportType === 'range'
                          ? 'bg-gradient-to-r from-indigo-500 to-violet-600 text-white shadow-lg shadow-indigo-600/30'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <CalendarRange className="w-4 h-4" /> عدة أيام
                    </button>
                  </div>
                </div>

                <AnimatePresence mode="wait">
                  {exportType === 'single' ? (
                    <motion.div
                      key="single"
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      transition={{ duration: 0.18 }}
                    >
                      <p className="text-xs font-bold text-slate-300 mb-2">اختر اليوم من السجلات</p>
                      <select
                        value={singleDate}
                        onChange={e => setSingleDate(e.target.value)}
                        className="w-full bg-slate-800 border border-slate-600/70 text-white rounded-xl px-3.5 py-3 text-sm font-semibold focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-shadow"
                      >
                        {normalizedDateOptions.map(s => (
                          <option key={s.id} value={s.isoDate}>
                            {s.name} ({s.isoDate})
                          </option>
                        ))}
                      </select>
                    </motion.div>
                  ) : (
                    <motion.div
                      key="range"
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      transition={{ duration: 0.18 }}
                    >
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <p className="text-xs font-bold text-slate-300 mb-2">من تاريخ</p>
                          <input
                            type="date"
                            value={startDate}
                            onChange={e => setStartDate(e.target.value)}
                            className="w-full bg-slate-800 border border-slate-600/70 text-white rounded-xl px-3.5 py-3 text-sm font-semibold focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-shadow [color-scheme:dark]"
                          />
                        </div>
                        <div>
                          <p className="text-xs font-bold text-slate-300 mb-2">إلى تاريخ</p>
                          <input
                            type="date"
                            value={endDate}
                            onChange={e => setEndDate(e.target.value)}
                            className="w-full bg-slate-800 border border-slate-600/70 text-white rounded-xl px-3.5 py-3 text-sm font-semibold focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-shadow [color-scheme:dark]"
                          />
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <button
                  type="button"
                  disabled={exporting}
                  onClick={async () => {
                    setExporting(true);
                    const ok = await handleExportOfficialExcel();
                    setExporting(false);
                    if (ok) setExportOpen(false);
                  }}
                  className="w-full py-3.5 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-700 hover:from-indigo-500 hover:to-violet-600 text-white font-bold text-base flex items-center justify-center gap-2 shadow-lg shadow-indigo-700/30 hover:shadow-indigo-600/40 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {exporting ? (
                    <motion.span
                      className="w-5 h-5 rounded-full border-2 border-white/30 border-t-white inline-block"
                      animate={{ rotate: 360 }}
                      transition={{ repeat: Infinity, duration: 0.8, ease: 'linear' }}
                    />
                  ) : (
                    <Download className="w-5 h-5" />
                  )}
                  {exporting ? 'جاري تجهيز الملف...' : 'تحميل الملف'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>,
      document.body
      )}

      {createPortal(
      <AnimatePresence>
        {editingRecord && (
          <motion.div
            className="fixed inset-0 z-[110] flex items-center justify-center p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm"
              onClick={() => setEditingRecord(null)}
            />
            <motion.div
              className="relative w-full max-w-sm rounded-2xl overflow-hidden bg-slate-900 border border-slate-700/60 shadow-2xl shadow-slate-950/50"
              initial={{ scale: 0.92, y: 28, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.95, y: 14, opacity: 0 }}
              transition={{ type: 'spring', damping: 24, stiffness: 320 }}
            >
              <div className="relative px-5 pt-5 pb-4 overflow-hidden bg-gradient-to-br from-amber-600 via-orange-700 to-slate-900">
                <div className="absolute -top-16 -left-16 w-44 h-44 rounded-full bg-white/10 blur-2xl" />
                <div className="relative flex items-center gap-3">
                  <div className="w-11 h-11 rounded-xl bg-white/15 backdrop-blur flex items-center justify-center shrink-0 shadow-inner">
                    <Pencil className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white">تعديل سجل الحضور</h3>
                    <p className="text-xs text-amber-100/80 mt-0.5 truncate max-w-[200px]">{editingRecord.studentName}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setEditingRecord(null)}
                  className="absolute top-3.5 left-3.5 w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors"
                  aria-label="إغلاق"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-5 space-y-4">
                <div>
                  <p className="text-xs font-bold text-slate-300 mb-2">الحالة</p>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setEditStatus('present')}
                      className={`flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold transition-all ${
                        editStatus === 'present'
                          ? 'bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-600/30'
                          : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <CircleCheck className="w-4 h-4" /> حاضر
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditStatus('absent')}
                      className={`flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold transition-all ${
                        editStatus === 'absent'
                          ? 'bg-gradient-to-r from-red-500 to-rose-600 text-white shadow-lg shadow-red-600/30'
                          : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <CircleX className="w-4 h-4" /> غائب
                    </button>
                  </div>
                </div>

                <div>
                  <p className="text-xs font-bold text-slate-300 mb-2">وقت التسجيل</p>
                  <input
                    type="time"
                    value={editTime}
                    onChange={e => setEditTime(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-600/70 text-white rounded-xl px-3.5 py-3 text-sm font-semibold focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none transition-shadow [color-scheme:dark]"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setEditingRecord(null)}
                    className="py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-sm transition-colors"
                  >
                    إلغاء
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveEdit}
                    className="py-3 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-white font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-amber-700/30 transition-all"
                  >
                    <Check className="w-4 h-4" /> حفظ التعديل
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>,
      document.body
      )}
    </div>
  );
});