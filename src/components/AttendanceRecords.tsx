import React, { useState, useMemo, useCallback } from 'react';
import { AttendanceRecord, AttendanceSession, Student } from '../types/student';
import { getCurrentAcademicYear } from '../firebase/dataService';
import { Calendar, ChartColumn, Download, GraduationCap, MapPin } from 'lucide-react';

interface AttendanceRecordsProps {
  records: AttendanceRecord[];
  sessions: AttendanceSession[];
  students?: Student[];
  onClearRecords: () => void;
}

export const AttendanceRecords: React.FC<AttendanceRecordsProps> = React.memo(({
  records,
  sessions,
  students = [],
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

  const [exportType, setExportType] = useState<'single' | 'range'>('range');
  const [startDate, setStartDate] = useState<string>(firstDate);
  const [endDate, setEndDate] = useState<string>(lastDate);
  const [singleDate, setSingleDate] = useState<string>(lastDate);

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
  const handleExportOfficialExcel = async () => {
    if (students.length === 0) {
      alert('لا يوجد طلاب مسجلين في هذه المرحلة للتصدير.');
      return;
    }

    if (sessions.length === 0) {
      alert('لا توجد أيام حضور (سجلات) مسجلة للتصدير.');
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
        return alert(`لا توجد سجلات حضور مسجلة في يوم ${singleDate}`);
      }
    } else {
      if (!startDate || !endDate) return alert('الرجاء تحديد تاريخ البدء والانتهاء');
      targetSessions = sessions.filter(s => {
        const normalized = normalizeForFilter(s.date);
        return normalized >= startDate && normalized <= endDate;
      });
      if (targetSessions.length === 0) {
        return alert('لا توجد سجلات حضور في هذه المدة الزمنية');
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
  };

  const handleClearRecords = () => {
    if (window.confirm('تحذير: هل أنت متأكد من حذف جميع سجلات الحضور لهذه المرحلة؟')) {
      onClearRecords();
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-md p-4 sm:p-6">
      {/* 🆕 شريط السنة الأكاديمية */}
      <div className="mb-3 sm:mb-4 p-2 sm:p-3 bg-indigo-50 border border-indigo-200 rounded-lg flex items-center gap-2">
        <GraduationCap className="w-7 h-7 text-indigo-600" />
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
          <ChartColumn className="w-9 h-9 sm:w-11 sm:h-11 text-green-600" />
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
              <span className="flex items-center gap-1"><Calendar className="w-4 h-4" /> مدة زمنية (من - إلى)</span>
            </label>

            <label className={`flex items-center gap-2 p-3 rounded-lg border-2 cursor-pointer transition flex-1 min-w-[140px] sm:min-w-[200px] ${exportType === 'single' ? 'border-green-600 bg-green-50 font-bold text-green-800' : 'border-gray-200 hover:bg-gray-50'}`}>
              <input
                type="radio"
                name="exportType"
                checked={exportType === 'single'}
                onChange={() => setExportType('single')}
                className="accent-green-600 w-4 h-4"
              />
              <span className="flex items-center gap-1"><MapPin className="w-4 h-4" /> يوم واحد محدد</span>
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
                {normalizedDateOptions.map(s => (
                  <option key={s.id} value={s.isoDate}>
                    {s.name} ({s.isoDate})
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <button
          onClick={handleExportOfficialExcel}
          className="w-full bg-gradient-to-r from-green-600 to-emerald-700 hover:from-green-700 hover:to-emerald-800 text-white font-bold py-2.5 sm:py-3 px-4 sm:px-6 rounded-lg transition duration-200 shadow-md flex items-center justify-center gap-2 text-sm sm:text-lg"
        >
          <Download className="w-5 h-5 sm:w-6 sm:h-6" />
          تحميل كشف الحضور والغياب الرسمي (Excel)
        </button>

        <div className="mt-3 text-xs text-gray-600 flex flex-wrap gap-4 justify-center font-medium">
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-green-500 inline-block" /> خلية خضراء للحاضر</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-red-500 inline-block" /> خلية حمراء للغائب</span>
        </div>
      </div>

      {/* ============================================================ */}
      {/* ⚙️ أدوات السجلات */}
      {/* ============================================================ */}
      <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3 border-t pt-4 sm:pt-6">

            <button
              onClick={handleClearRecords}
              disabled={records.length === 0}
              className="btn-base bg-gradient-to-r from-red-600/90 to-rose-600/90 hover:from-red-600 hover:to-rose-600 text-white disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              <span>مسح السجلات</span>
            </button>
      </div>
    </div>
  );
});