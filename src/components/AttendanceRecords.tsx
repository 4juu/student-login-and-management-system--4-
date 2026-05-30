import React, { useState, useMemo, useCallback } from 'react';
import { AttendanceRecord, AttendanceSession, Student } from '../types/student';
import * as XLSX from 'xlsx-js-style';
import { getCurrentAcademicYear } from '../firebase/dataService';

interface AttendanceRecordsProps {
  records: AttendanceRecord[];
  sessions: AttendanceSession[];
  students?: Student[];
  activeSessionId: string | null;
  onClearRecords: () => void;
}

const PAGE_SIZE_OPTIONS = [50, 100, 200, 500];
const DEFAULT_PAGE_SIZE = 100;

export const AttendanceRecords: React.FC<AttendanceRecordsProps> = ({
  records,
  sessions,
  students = [],
  activeSessionId,
  onClearRecords,
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

  const today = new Date().toISOString().split('T')[0];
  const firstDate = sortedSessions.length > 0 ? normalizeAnyDate(sortedSessions[0].date) : today;
  const lastDate = sortedSessions.length > 0 ? normalizeAnyDate(sortedSessions[sortedSessions.length - 1].date) : today;

  const [exportType, setExportType] = useState<'single' | 'range'>('range');
  const [startDate, setStartDate] = useState<string>(firstDate);
  const [endDate, setEndDate] = useState<string>(lastDate);
  const [singleDate, setSingleDate] = useState<string>(lastDate);

  const [selectedSessionId, setSelectedSessionId] = useState<string | 'all'>(activeSessionId || 'all');

  const [searchRecord, setSearchRecord] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  const filteredRecords = useMemo(() => {
    let result = selectedSessionId === 'all'
      ? records
      : records.filter(r => r.sessionId === selectedSessionId);

    if (searchRecord.trim()) {
      const q = searchRecord.toLowerCase();
      result = result.filter(r =>
        r.studentName.toLowerCase().includes(q) ||
        r.studentCode.toLowerCase().includes(q) ||
        (r.studentGroup && r.studentGroup.toLowerCase().includes(q))
      );
    }

    return [...result].reverse();
  }, [records, selectedSessionId, searchRecord]);

  const totalPages = Math.max(1, Math.ceil(filteredRecords.length / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);

  const paginatedRecords = useMemo(() => {
    const start = (safeCurrentPage - 1) * pageSize;
    return filteredRecords.slice(start, start + pageSize);
  }, [filteredRecords, safeCurrentPage, pageSize]);

  React.useEffect(() => {
    setCurrentPage(1);
  }, [selectedSessionId, searchRecord, pageSize]);

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
  const handleExportOfficialExcel = () => {
    if (students.length === 0) {
      alert('❌ لا يوجد طلاب مسجلين في هذه المرحلة للتصدير.');
      return;
    }

    if (sessions.length === 0) {
      alert('❌ لا توجد أيام حضور (سجلات) مسجلة للتصدير.');
      return;
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
      if (!singleDate) return alert('الرجاء تحديد التاريخ');
      targetSessions = sessions.filter(s => normalizeForFilter(s.date) === singleDate);
      if (targetSessions.length === 0) {
        return alert(`❌ لا توجد سجلات حضور مسجلة في يوم ${singleDate}`);
      }
    } else {
      if (!startDate || !endDate) return alert('الرجاء تحديد تاريخ البدء والانتهاء');
      targetSessions = sessions.filter(s => {
        const normalized = normalizeForFilter(s.date);
        return normalized >= startDate && normalized <= endDate;
      });
      if (targetSessions.length === 0) {
        return alert('❌ لا توجد سجلات حضور في هذه المدة الزمنية');
      }
    }

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

    const generateStyledSheet = (orderedStudents: Student[]): XLSX.WorkSheet => {
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
          const isPresent = records.some(r => r.sessionId === session.id && r.studentId === student.id);
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
  };

  const handleClearRecords = () => {
    if (window.confirm('⚠️ تحذير: هل أنت متأكد من حذف جميع سجلات الحضور لهذه المرحلة؟')) {
      onClearRecords();
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-md p-4 sm:p-6">
      {/* 🆕 شريط السنة الأكاديمية */}
      <div className="mb-3 sm:mb-4 p-2 sm:p-3 bg-indigo-50 border border-indigo-200 rounded-lg flex items-center gap-2">
        <span className="text-2xl">🎓</span>
        <div>
          <p className="text-sm font-bold text-indigo-800">
            السنة الأكاديمية الحالية: {currentAcademicYear.replace('_', ' - ')}
          </p>
          <p className="text-xs text-indigo-600">
            جميع البيانات والسجلات تنتمي لهذه السنة
          </p>
        </div>
      </div>

      {/* ============================================================ */}
      {/* 📥 لوحة التصدير */}
      {/* ============================================================ */}
      <div className="mb-6 sm:mb-8 p-4 sm:p-6 bg-gradient-to-br from-green-50 to-emerald-50 border-2 border-green-500 rounded-xl shadow-sm">
        <div className="flex items-center gap-2 sm:gap-3 mb-3 sm:mb-4">
          <span className="text-2xl sm:text-4xl">📊</span>
          <div>
            <h3 className="text-base sm:text-xl font-bold text-gray-800">تصدير سجل الحضور والغياب الرسمي (Excel)</h3>
          </div>
        </div>

        <div className="bg-white p-3 sm:p-4 rounded-lg border border-green-200 mb-3 sm:mb-4">
          <label className="block text-xs sm:text-sm font-bold text-gray-700 mb-2 sm:mb-3">اختر المدة الزمنية للتصدير:</label>

          <div className="flex flex-col sm:flex-row gap-2 sm:gap-6 mb-3 sm:mb-4">
            <label className={`flex items-center gap-2 p-3 rounded-lg border-2 cursor-pointer transition flex-1 min-w-[140px] sm:min-w-[200px] ${exportType === 'range' ? 'border-green-600 bg-green-50 font-bold text-green-800' : 'border-gray-200 hover:bg-gray-50'}`}>
              <input
                type="radio"
                name="exportType"
                checked={exportType === 'range'}
                onChange={() => setExportType('range')}
                className="accent-green-600 w-4 h-4"
              />
              <span>📅 مدة زمنية (من - إلى)</span>
            </label>

            <label className={`flex items-center gap-2 p-3 rounded-lg border-2 cursor-pointer transition flex-1 min-w-[140px] sm:min-w-[200px] ${exportType === 'single' ? 'border-green-600 bg-green-50 font-bold text-green-800' : 'border-gray-200 hover:bg-gray-50'}`}>
              <input
                type="radio"
                name="exportType"
                checked={exportType === 'single'}
                onChange={() => setExportType('single')}
                className="accent-green-600 w-4 h-4"
              />
              <span>📍 يوم واحد محدد</span>
            </label>
          </div>

          {exportType === 'range' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-3 bg-green-50/30 rounded-md border border-green-100">
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1">من تاريخ:</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={e => setStartDate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-green-500 font-bold text-gray-800"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1">إلى تاريخ:</label>
                <input
                  type="date"
                  value={endDate}
                  onChange={e => setEndDate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-green-500 font-bold text-gray-800"
                />
              </div>
            </div>
          ) : (
            <div className="p-3 bg-green-50/30 rounded-md border border-green-100 max-w-md">
              <select
                value={singleDate}
                onChange={e => setSingleDate(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-green-500 font-bold text-gray-800"
              >
                {[...sessions].reverse().map(s => {
                  const arabicNumbers = '٠١٢٣٤٥٦٧٨٩';
                  const englishNumbers = '0123456789';
                  let normalized = s.date.replace(/[٠-٩]/g, (d) => englishNumbers[arabicNumbers.indexOf(d)]);
                  normalized = normalized.replace(/[‏‎\u200E\u200F]/g, '').trim();

                  let isoDate = normalized;
                  const slashMatch = normalized.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
                  if (slashMatch) {
                    const [, day, month, year] = slashMatch;
                    isoDate = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
                  }

                  return (
                    <option key={s.id} value={isoDate}>
                      {s.name} ({isoDate})
                    </option>
                  );
                })}
              </select>
            </div>
          )}
        </div>

        <button
          onClick={handleExportOfficialExcel}
          className="w-full bg-gradient-to-r from-green-600 to-emerald-700 hover:from-green-700 hover:to-emerald-800 text-white font-bold py-2.5 sm:py-3 px-4 sm:px-6 rounded-lg transition duration-200 shadow-md flex items-center justify-center gap-2 text-sm sm:text-lg"
        >
          <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          📥 تحميل كشف الحضور والغياب الرسمي (Excel)
        </button>

        <div className="mt-3 text-xs text-gray-600 flex flex-wrap gap-4 justify-center font-medium">
          <span>🟢 خلية خضراء للحاضر</span>
          <span>🔴 خلية حمراء للغائب</span>
        </div>
      </div>

      {/* ============================================================ */}
      {/* 📋 جدول العرض المباشر مع Pagination */}
      {/* ============================================================ */}
      <div className="border-t pt-4 sm:pt-6">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 sm:gap-4 mb-3 sm:mb-4">
          <div>
            <h2 className="text-base sm:text-xl font-bold text-gray-800">سجل عمليات الدخول المباشر</h2>
            <p className="text-xs text-gray-500 mt-1">
              📊 إجمالي: {records.length} سجل
              {filteredRecords.length !== records.length && (
                <span className="text-blue-600"> | نتائج الفلتر: {filteredRecords.length}</span>
              )}
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 flex-wrap">
            {sessions.length > 0 && (
              <select
                value={selectedSessionId}
                onChange={(e) => setSelectedSessionId(e.target.value)}
                className="px-2 sm:px-3 py-1.5 border border-gray-300 rounded-md text-xs sm:text-sm font-medium"
              >
                <option value="all">جميع الأيام ({records.length})</option>
                {sessions.map((session) => {
                  const sessRecords = records.filter(r => r.sessionId === session.id).length;
                  return (
                    <option key={session.id} value={session.id}>
                      {session.name} ({sessRecords})
                    </option>
                  );
                })}
              </select>
            )}

            <button
              onClick={handleClearRecords}
              disabled={records.length === 0}
              className="bg-red-100 hover:bg-red-200 text-red-700 disabled:opacity-50 text-xs sm:text-sm font-medium py-1.5 px-2 sm:px-3 rounded-md transition"
            >
              مسح السجلات
            </button>
          </div>
        </div>

        {records.length > 10 && (
          <div className="mb-3 relative">
            <input
              type="text"
              value={searchRecord}
              onChange={e => setSearchRecord(e.target.value)}
              placeholder="🔍 بحث بالاسم أو الرمز أو الكروب..."
              className="w-full px-4 py-2 pr-10 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              dir="rtl"
            />
            {searchRecord && (
              <button
                onClick={() => setSearchRecord('')}
                className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xl"
              >
                ×
              </button>
            )}
          </div>
        )}

        {filteredRecords.length > pageSize && (
          <div className="mb-3 p-2 sm:p-3 bg-gray-50 border border-gray-200 rounded-lg flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2">
            <div className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm">
              <span className="text-gray-600">عرض:</span>
              <select
                value={pageSize}
                onChange={e => setPageSize(Number(e.target.value))}
                className="px-2 sm:px-3 py-1 border border-gray-300 rounded-md text-xs sm:text-sm bg-white"
              >
                {PAGE_SIZE_OPTIONS.map(size => (
                  <option key={size} value={size}>{size} سجل</option>
                ))}
              </select>
              <span className="text-gray-600 hidden xs:inline">
                ({((safeCurrentPage - 1) * pageSize) + 1} - {Math.min(safeCurrentPage * pageSize, filteredRecords.length)} من {filteredRecords.length})
              </span>
            </div>

            <div className="flex items-center gap-1 justify-center sm:justify-end">
              <button
                onClick={() => setCurrentPage(1)}
                disabled={safeCurrentPage === 1}
                className="px-1.5 sm:px-2 py-1 bg-white border border-gray-300 rounded disabled:opacity-30 hover:bg-gray-100 text-xs sm:text-sm"
              >
                ⏮
              </button>
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={safeCurrentPage === 1}
                className="px-2 sm:px-3 py-1 bg-white border border-gray-300 rounded disabled:opacity-30 hover:bg-gray-100 text-xs sm:text-sm"
              >
                ←
              </button>
              <span className="px-2 sm:px-3 py-1 bg-blue-600 text-white rounded text-xs sm:text-sm font-bold">
                {safeCurrentPage} / {totalPages}
              </span>
              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={safeCurrentPage === totalPages}
                className="px-2 sm:px-3 py-1 bg-white border border-gray-300 rounded disabled:opacity-30 hover:bg-gray-100 text-xs sm:text-sm"
              >
                →
              </button>
              <button
                onClick={() => setCurrentPage(totalPages)}
                disabled={safeCurrentPage === totalPages}
                className="px-1.5 sm:px-2 py-1 bg-white border border-gray-300 rounded disabled:opacity-30 hover:bg-gray-100 text-xs sm:text-sm"
              >
                ⏭
              </button>
            </div>
          </div>
        )}

          <div className="overflow-x-auto max-h-[400px] sm:max-h-[500px] overflow-y-auto border rounded-lg">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50 sticky top-0">
              <tr>
                <th className="px-3 sm:px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">#</th>
                <th className="px-3 sm:px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">الرمز</th>
                <th className="px-3 sm:px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">الاسم</th>
                <th className="px-3 sm:px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">الكروب</th>
                <th className="px-3 sm:px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">التاريخ والوقت</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {paginatedRecords.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 sm:px-6 py-8 text-center text-gray-500 text-sm font-medium">
                    {searchRecord || selectedSessionId !== 'all'
                      ? '🔍 لا توجد نتائج مطابقة'
                      : 'لا توجد سجلات حضور مدخلة'}
                  </td>
                </tr>
              ) : (
                paginatedRecords.map((record, index) => {
                  const globalIndex = filteredRecords.length - ((safeCurrentPage - 1) * pageSize + index);
                  return (
                    <tr key={record.id} className="hover:bg-gray-50">
                      <td className="px-3 sm:px-6 py-3 text-sm text-gray-500">{globalIndex}</td>
                      <td className="px-3 sm:px-6 py-3">
                        <span className="px-2 py-1 rounded-full text-xs font-bold bg-blue-100 text-blue-800">
                          {record.studentCode}
                        </span>
                      </td>
                      <td className="px-3 sm:px-6 py-3 font-medium text-gray-900 text-sm">{record.studentName}</td>
                      <td className="px-3 sm:px-6 py-3 text-sm text-gray-600">{record.studentGroup || '-'}</td>
                      <td className="px-3 sm:px-6 py-3 text-xs text-gray-500">
                        {record.date} - {record.time}
                        {record.method === 'qr' && (
                          <span className="mr-2 inline-block px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded text-[10px] font-bold">
                            🔳 QR
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {filteredRecords.length > pageSize && (
          <div className="mt-3 p-2 sm:p-3 bg-gray-50 border border-gray-200 rounded-lg flex items-center justify-center gap-1 flex-wrap">
            <button
              onClick={() => setCurrentPage(1)}
              disabled={safeCurrentPage === 1}
              className="px-1.5 sm:px-2 py-1 bg-white border border-gray-300 rounded disabled:opacity-30 hover:bg-gray-100 text-xs sm:text-sm"
            >
              <span className="hidden sm:inline">⏮ الأولى</span>
              <span className="sm:hidden">⏮</span>
            </button>
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={safeCurrentPage === 1}
              className="px-2 sm:px-3 py-1 bg-white border border-gray-300 rounded disabled:opacity-30 hover:bg-gray-100 text-xs sm:text-sm"
            >
              <span className="hidden sm:inline">← السابق</span>
              <span className="sm:hidden">←</span>
            </button>

            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              let pageNum: number;
              if (totalPages <= 5) {
                pageNum = i + 1;
              } else if (safeCurrentPage <= 3) {
                pageNum = i + 1;
              } else if (safeCurrentPage >= totalPages - 2) {
                pageNum = totalPages - 4 + i;
              } else {
                pageNum = safeCurrentPage - 2 + i;
              }
              return (
                <button
                  key={pageNum}
                  onClick={() => setCurrentPage(pageNum)}
                  className={`px-2 sm:px-3 py-1 rounded text-xs sm:text-sm font-medium ${
                    pageNum === safeCurrentPage
                      ? 'bg-blue-600 text-white'
                      : 'bg-white border border-gray-300 hover:bg-gray-100'
                  }`}
                >
                  {pageNum}
                </button>
              );
            })}

            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={safeCurrentPage === totalPages}
              className="px-2 sm:px-3 py-1 bg-white border border-gray-300 rounded disabled:opacity-30 hover:bg-gray-100 text-xs sm:text-sm"
            >
              <span className="hidden sm:inline">التالي →</span>
              <span className="sm:hidden">→</span>
            </button>
            <button
              onClick={() => setCurrentPage(totalPages)}
              disabled={safeCurrentPage === totalPages}
              className="px-1.5 sm:px-2 py-1 bg-white border border-gray-300 rounded disabled:opacity-30 hover:bg-gray-100 text-xs sm:text-sm"
            >
              <span className="hidden sm:inline">الأخيرة ⏭</span>
              <span className="sm:hidden">⏭</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};