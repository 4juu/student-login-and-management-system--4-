// src/components/Admin/SendRegisterLink.tsx
import React, { useState, useMemo } from 'react';
import { Student, Stage, College } from '../../types/student';
import {
  createBulkRegistrationLinks,
} from '../../services/tokenService';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';

interface SendRegisterLinkProps {
  adminUid: string;
  colleges: College[];
  stages: Stage[];
  loadStudents: (stageId: string) => Promise<Student[]>;
  onClose: () => void;
}

interface GeneratedLink {
  studentId: string;
  studentName: string;
  studentCode: string;
  url: string;
  copied: boolean;
}

// ============================================================
// 📊 توليد ملف Excel احترافي
// ============================================================
const generateProfessionalExcel = (
  links: GeneratedLink[],
  collegeName: string,
  stageName: string,
  expiryDays: number
) => {
  const wb = XLSX.utils.book_new();

  // ── بيانات الملف ──
  const now = new Date();
  const dateStr = now.toLocaleDateString('ar-IQ', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const timeStr = now.toLocaleTimeString('ar-IQ', {
    hour: '2-digit',
    minute: '2-digit',
  });

  // ── بناء الصفوف ──
  const rows: any[][] = [];

  // صف 1: عنوان رئيسي
  rows.push(['', '', '']);
  rows.push(['روابط تسجيل بصمة الوجه ورمز QR', '', '']);

  // صف 3: معلومات
  rows.push(['', '', '']);
  rows.push([`📅 التاريخ: ${dateStr} - ${timeStr}`, '', '']);
  rows.push([`🏛️ الكلية: ${collegeName}`, '', '']);
  rows.push([`📚 المرحلة: ${stageName}`, '', '']);
  rows.push([`⏳ صلاحية الرابط: ${expiryDays} يوم`, '', '']);
  rows.push([`👥 عدد الطلاب: ${links.length}`, '', '']);

  // صف فارغ
  rows.push(['', '', '']);

  // صف العناوين (صف 10)
  const headerRowIndex = rows.length;
  rows.push(['#', 'اسم الطالب', 'كود الطالب', 'رابط التسجيل']);

  // بيانات الطلاب
  links.forEach((link, idx) => {
    rows.push([
      idx + 1,
      link.studentName,
      link.studentCode,
      link.url,
    ]);
  });

  // صف فارغ + ملاحظة
  rows.push(['', '', '', '']);
  rows.push(['', '⚠️ ملاحظة: كل رابط صالح لاستخدام واحد فقط', '', '']);
  rows.push(['', '🔒 لا تشارك هذا الملف مع غير المعنيين', '', '']);

  // ── إنشاء الورقة ──
  const ws = XLSX.utils.aoa_to_sheet(rows);

  // ── عرض الأعمدة ──
  ws['!cols'] = [
    { wch: 6 },    // #
    { wch: 35 },   // اسم الطالب
    { wch: 18 },   // كود الطالب
    { wch: 70 },   // رابط التسجيل
  ];

  // ── ارتفاع الصفوف ──
  ws['!rows'] = [];
  // العنوان الرئيسي
  ws['!rows'][1] = { hpt: 40 };
  // صفوف المعلومات
  for (let i = 3; i <= 8; i++) {
    ws['!rows'][i] = { hpt: 22 };
  }
  // صف العناوين
  ws['!rows'][headerRowIndex] = { hpt: 30 };
  // صفوف البيانات
  for (let i = headerRowIndex + 1; i < headerRowIndex + 1 + links.length; i++) {
    ws['!rows'][i] = { hpt: 28 };
  }

  // ── دمج الخلايا ──
  ws['!merges'] = [
    // العنوان الرئيسي: A2:D2
    { s: { r: 1, c: 0 }, e: { r: 1, c: 3 } },
    // معلومات
    { s: { r: 3, c: 0 }, e: { r: 3, c: 3 } },
    { s: { r: 4, c: 0 }, e: { r: 4, c: 3 } },
    { s: { r: 5, c: 0 }, e: { r: 5, c: 3 } },
    { s: { r: 6, c: 0 }, e: { r: 6, c: 3 } },
    { s: { r: 7, c: 0 }, e: { r: 7, c: 3 } },
  ];

  // ── تنسيقات الخلايا (styles) ──
  // ملاحظة: xlsx المجانية لا تدعم styles بالكامل
  // نستخدم حيلة: نضيف التنسيقات عبر XML مخصص

  // ── إضافة الورقة للملف ──
  XLSX.utils.book_append_sheet(wb, ws, 'روابط التسجيل');

  // ── حفظ الملف ──
  const fileName = `روابط_التسجيل_${collegeName}_${stageName}_${now.getTime()}.xlsx`;
  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  saveAs(blob, fileName);

  return fileName;
};

// ============================================================
// 📊 توليد ملف Excel محسّن مع ألوان (باستخدام HTML → Excel)
// ============================================================
const generateStyledExcel = (
  links: GeneratedLink[],
  collegeName: string,
  stageName: string,
  expiryDays: number
) => {
  const now = new Date();
  const dateStr = now.toLocaleDateString('ar-IQ', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const timeStr = now.toLocaleTimeString('ar-IQ', {
    hour: '2-digit',
    minute: '2-digit',
  });

  // ── HTML Table مع تنسيقات Excel ──
  const html = `
    <html xmlns:o="urn:schemas-microsoft-com:office:office"
          xmlns:x="urn:schemas-microsoft-com:office:excel"
          xmlns="http://www.w3.org/TR/REC-html40">
    <head>
      <meta charset="UTF-8">
      <!--[if gte mso 9]>
      <xml>
        <x:ExcelWorkbook>
          <x:ExcelWorksheets>
            <x:ExcelWorksheet>
              <x:Name>روابط التسجيل</x:Name>
              <x:WorksheetOptions>
                <x:DisplayRightToLeft/>
                <x:DisplayGridlines/>
              </x:WorksheetOptions>
            </x:ExcelWorksheet>
          </x:ExcelWorksheets>
        </x:ExcelWorkbook>
      </xml>
      <![endif]-->
      <style>
        @font-face {
          font-family: 'Cairo';
        }
        body {
          direction: rtl;
        }
        table {
          border-collapse: collapse;
          width: 100%;
          direction: rtl;
        }
        td, th {
          font-family: 'Calibri', 'Arial', 'Tahoma', sans-serif;
          padding: 8px 12px;
          text-align: right;
        }
        .title-row td {
          font-size: 22pt;
          font-weight: bold;
          color: #1e1b4b;
          background-color: #e0e7ff;
          text-align: center;
          padding: 16px;
          border: none;
        }
        .info-row td {
          font-size: 13pt;
          color: #374151;
          background-color: #f3f4f6;
          border: none;
          padding: 6px 16px;
        }
        .info-label {
          font-weight: bold;
          color: #4338ca;
        }
        .header-row th {
          font-size: 14pt;
          font-weight: bold;
          color: #ffffff;
          background-color: #4f46e5;
          border: 2px solid #3730a3;
          text-align: center;
          padding: 12px 8px;
        }
        .data-row td {
          font-size: 13pt;
          border: 1px solid #c7d2fe;
          padding: 10px 12px;
        }
        .data-row:nth-child(even) td {
          background-color: #eef2ff;
        }
        .data-row:nth-child(odd) td {
          background-color: #ffffff;
        }
        .num-col {
          text-align: center;
          font-weight: bold;
          color: #4f46e5;
          width: 50px;
          background-color: #e0e7ff !important;
        }
        .name-col {
          font-weight: bold;
          font-size: 14pt;
          color: #111827;
          min-width: 250px;
        }
        .code-col {
          text-align: center;
          font-family: 'Consolas', 'Courier New', monospace;
          font-size: 13pt;
          color: #059669;
          font-weight: bold;
          min-width: 120px;
          direction: ltr;
        }
        .link-col {
          font-size: 11pt;
          color: #2563eb;
          font-family: 'Consolas', 'Courier New', monospace;
          word-break: break-all;
          min-width: 450px;
          direction: ltr;
          text-align: left;
        }
        .note-row td {
          font-size: 11pt;
          color: #6b7280;
          border: none;
          background-color: #fefce8;
          padding: 8px 16px;
        }
        .separator td {
          border: none;
          height: 10px;
        }
        .stats-row td {
          font-size: 12pt;
          color: #1e40af;
          background-color: #dbeafe;
          border: none;
          font-weight: bold;
          text-align: center;
          padding: 10px;
        }
      </style>
    </head>
    <body>
      <table>
        <!-- فراغ -->
        <tr class="separator"><td colspan="4"></td></tr>
        
        <!-- العنوان الرئيسي -->
        <tr class="title-row">
          <td colspan="4">📋 روابط تسجيل بصمة الوجه ورمز QR</td>
        </tr>
        
        <!-- فراغ -->
        <tr class="separator"><td colspan="4"></td></tr>
        
        <!-- معلومات -->
        <tr class="info-row">
          <td colspan="4">
            <span class="info-label">📅 التاريخ:</span> ${dateStr} - ${timeStr}
          </td>
        </tr>
        <tr class="info-row">
          <td colspan="4">
            <span class="info-label">🏛️ الكلية:</span> ${collegeName}
          </td>
        </tr>
        <tr class="info-row">
          <td colspan="4">
            <span class="info-label">📚 المرحلة:</span> ${stageName}
          </td>
        </tr>
        <tr class="info-row">
          <td colspan="4">
            <span class="info-label">⏳ صلاحية الرابط:</span> ${expiryDays} يوم
          </td>
        </tr>
        <tr class="info-row">
          <td colspan="4">
            <span class="info-label">👥 عدد الطلاب:</span> ${links.length} طالب
          </td>
        </tr>
        
        <!-- فراغ -->
        <tr class="separator"><td colspan="4"></td></tr>
        <tr class="separator"><td colspan="4"></td></tr>
        
        <!-- عناوين الأعمدة -->
        <tr class="header-row">
          <th style="width:50px">#</th>
          <th style="width:280px">اسم الطالب</th>
          <th style="width:140px">كود الطالب</th>
          <th style="width:500px">رابط التسجيل</th>
        </tr>
        
        <!-- بيانات الطلاب -->
        ${links.map((link, idx) => `
          <tr class="data-row">
            <td class="num-col">${idx + 1}</td>
            <td class="name-col">${escapeHtml(link.studentName)}</td>
            <td class="code-col">${escapeHtml(link.studentCode)}</td>
            <td class="link-col">${escapeHtml(link.url)}</td>
          </tr>
        `).join('')}
        
        <!-- فراغ -->
        <tr class="separator"><td colspan="4"></td></tr>
        
        <!-- إحصائيات -->
        <tr class="stats-row">
          <td colspan="4">
            📊 إجمالي الروابط: ${links.length} | 
            📅 تاريخ التوليد: ${dateStr} | 
            ⏳ تنتهي بعد: ${expiryDays} يوم
          </td>
        </tr>
        
        <!-- ملاحظات -->
        <tr class="separator"><td colspan="4"></td></tr>
        <tr class="note-row">
          <td colspan="4">⚠️ ملاحظة: كل رابط صالح لاستخدام واحد فقط - يُستخدم لتسجيل بصمة الوجه وقراءة هوية الطالب</td>
        </tr>
        <tr class="note-row">
          <td colspan="4">🔒 تحذير: لا تشارك هذا الملف مع غير المعنيين - الروابط شخصية لكل طالب</td>
        </tr>
        <tr class="note-row">
          <td colspan="4">💡 تعليمات: أرسل لكل طالب الرابط الخاص به عبر واتساب أو تلغرام</td>
        </tr>
      </table>
    </body>
    </html>
  `;

  return html;
};

// ============================================================
// 📄 توليد CSV احترافي (بنفس الهيكل)
// ============================================================
const generateStyledCSV = (
  links: GeneratedLink[],
  collegeName: string,
  stageName: string,
  expiryDays: number
): string => {
  const now = new Date();
  const dateStr = now.toLocaleDateString('ar-IQ', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const timeStr = now.toLocaleTimeString('ar-IQ', {
    hour: '2-digit',
    minute: '2-digit',
  });

  const lines_csv: string[] = [];

  // BOM for UTF-8
  // العنوان
  lines_csv.push(csvRow(['', '', '', '']));
  lines_csv.push(csvRow(['روابط تسجيل بصمة الوجه ورمز QR', '', '', '']));
  lines_csv.push(csvRow(['', '', '', '']));

  // المعلومات
  lines_csv.push(csvRow([`التاريخ: ${dateStr} - ${timeStr}`, '', '', '']));
  lines_csv.push(csvRow([`الكلية: ${collegeName}`, '', '', '']));
  lines_csv.push(csvRow([`المرحلة: ${stageName}`, '', '', '']));
  lines_csv.push(csvRow([`صلاحية الرابط: ${expiryDays} يوم`, '', '', '']));
  lines_csv.push(csvRow([`عدد الطلاب: ${links.length}`, '', '', '']));
  lines_csv.push(csvRow(['', '', '', '']));

  // العناوين
  lines_csv.push(csvRow(['#', 'اسم الطالب', 'كود الطالب', 'رابط التسجيل']));

  // البيانات
  links.forEach((link, idx) => {
    lines_csv.push(csvRow([
      String(idx + 1),
      link.studentName,
      link.studentCode,
      link.url,
    ]));
  });

  // ملاحظات
  lines_csv.push(csvRow(['', '', '', '']));
  lines_csv.push(csvRow(['ملاحظة: كل رابط صالح لاستخدام واحد فقط', '', '', '']));
  lines_csv.push(csvRow(['تحذير: لا تشارك هذا الملف مع غير المعنيين', '', '', '']));

  return '\uFEFF' + lines_csv.join('\n');
};

// ── مساعدات ──

const escapeHtml = (str: string): string => {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
};

const csvRow = (cells: string[]): string => {
  return cells.map(c => `"${c.replace(/"/g, '""')}"`).join(',');
};

// ============================================================
// 🧩 المكون الرئيسي
// ============================================================

export const SendRegisterLink: React.FC<SendRegisterLinkProps> = ({
  adminUid,
  colleges,
  stages,
  loadStudents,
  onClose,
}) => {
  const [selectedCollegeId, setSelectedCollegeId] = useState<string>('');
  const [selectedStageId, setSelectedStageId] = useState<string>('');
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'without-qr' | 'without-face'>('all');

  const [generatedLinks, setGeneratedLinks] = useState<GeneratedLink[]>([]);
  const [generating, setGenerating] = useState(false);
  const [showLinks, setShowLinks] = useState(false);
  const [expiryDays, setExpiryDays] = useState(30);

  // ── أسماء الكلية والمرحلة للتصدير ──
  const selectedCollege = colleges.find(c => c.id === selectedCollegeId);
  const selectedStage = stages.find(s => s.id === selectedStageId);

  const stagesForCollege = useMemo(() =>
    stages.filter(s => s.collegeId === selectedCollegeId),
    [stages, selectedCollegeId]
  );

  const handleStageChange = async (stageId: string) => {
    setSelectedStageId(stageId);
    setStudents([]);
    setSelectedIds(new Set());

    if (!stageId) return;

    setLoading(true);
    try {
      const list = await loadStudents(stageId);
      setStudents(list);
    } catch (e) {
      console.error(e);
      alert('فشل تحميل الطلاب');
    } finally {
      setLoading(false);
    }
  };

  const filteredStudents = useMemo(() => {
    return students.filter(s => {
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        if (!s.name.toLowerCase().includes(q) && !s.code.toLowerCase().includes(q)) return false;
      }

      if (filterMode === 'without-qr' && s.qrCodeId) return false;
      if (filterMode === 'without-face' && s.faceDescriptor) return false;

      return true;
    });
  }, [students, searchQuery, filterMode]);

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredStudents.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredStudents.map(s => s.id)));
    }
  };

  const toggleStudent = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleGenerateLinks = async () => {
    if (selectedIds.size === 0) {
      alert('الرجاء اختيار طلاب');
      return;
    }

    if (!selectedStageId) return;

    if (!window.confirm(`سيتم توليد ${selectedIds.size} رابط تسجيل. متابعة؟`)) return;

    setGenerating(true);

    try {
      const studentIds = Array.from(selectedIds);
      const links = await createBulkRegistrationLinks(
        adminUid,
        selectedStageId,
        studentIds,
        expiryDays
      );

      const generated: GeneratedLink[] = links.map(link => {
        const student = students.find(s => s.id === link.studentId);
        return {
          studentId: link.studentId,
          studentName: student?.name || 'غير معروف',
          studentCode: student?.code || '',
          url: link.url,
          copied: false,
        };
      });

      generated.sort((a, b) => a.studentCode.localeCompare(b.studentCode));

      setGeneratedLinks(generated);
      setShowLinks(true);
    } catch (e: any) {
      console.error(e);
      alert('فشل توليد الروابط: ' + (e.message || ''));
    } finally {
      setGenerating(false);
    }
  };

  const handleCopyLink = async (index: number) => {
    const link = generatedLinks[index];
    try {
      await navigator.clipboard.writeText(link.url);
      setGeneratedLinks(prev => {
        const next = [...prev];
        next[index] = { ...next[index], copied: true };
        return next;
      });
      setTimeout(() => {
        setGeneratedLinks(prev => {
          const next = [...prev];
          if (next[index]) next[index] = { ...next[index], copied: false };
          return next;
        });
      }, 2000);
    } catch {
      alert('فشل النسخ');
    }
  };

  const handleCopyAll = async () => {
    const text = generatedLinks
      .map(l => `${l.studentName} (${l.studentCode}):\n${l.url}`)
      .join('\n\n');

    try {
      await navigator.clipboard.writeText(text);
      alert(`✅ تم نسخ ${generatedLinks.length} رابط`);
    } catch {
      alert('فشل النسخ');
    }
  };

  // ── 📥 تحميل Excel احترافي ──
  const handleDownloadExcel = () => {
    const collegeName = selectedCollege?.name || 'غير محدد';
    const stageName = selectedStage?.name || 'غير محدد';

    const html = generateStyledExcel(generatedLinks, collegeName, stageName, expiryDays);

    const blob = new Blob([html], {
      type: 'application/vnd.ms-excel;charset=utf-8',
    });

    const fileName = `روابط_التسجيل_${collegeName}_${stageName}_${Date.now()}.xls`;
    saveAs(blob, fileName);
  };

  // ── 📥 تحميل XLSX (بدون ألوان لكن xlsx حقيقي) ──
  const handleDownloadXLSX = () => {
    const collegeName = selectedCollege?.name || 'غير محدد';
    const stageName = selectedStage?.name || 'غير محدد';

    generateProfessionalExcel(generatedLinks, collegeName, stageName, expiryDays);
  };

  // ── 📥 تحميل CSV ──
  const handleDownloadCSV = () => {
    const collegeName = selectedCollege?.name || 'غير محدد';
    const stageName = selectedStage?.name || 'غير محدد';

    const csv = generateStyledCSV(generatedLinks, collegeName, stageName, expiryDays);

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const fileName = `روابط_التسجيل_${collegeName}_${stageName}_${Date.now()}.csv`;
    saveAs(blob, fileName);
  };

  const handleShareWhatsApp = (link: GeneratedLink) => {
    const text = encodeURIComponent(
      `مرحباً ${link.studentName} 👋\n\nرابط تسجيل بصمة الوجه ورمز QR الخاص بك:\n\n${link.url}\n\nالرابط صالح لمدة ${expiryDays} يوم.`
    );
    window.open(`https://wa.me/?text=${text}`, '_blank');
  };

  // ══════════════════════════════════════════
  // 🎨 صفحة الروابط الجاهزة
  // ══════════════════════════════════════════

  if (showLinks) {
    return (
      <div className="fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center p-4" dir="rtl">
        <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden">

          {/* Header */}
          <div className="p-5 border-b border-gray-200 bg-gradient-to-l from-indigo-50 to-purple-50">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                  📨 الروابط الجاهزة للإرسال
                </h2>
                <p className="text-sm text-gray-500 mt-1">
                  تم توليد <strong className="text-indigo-600">{generatedLinks.length}</strong> رابط
                  {selectedCollege && <> • {selectedCollege.name}</>}
                  {selectedStage && <> • {selectedStage.name}</>}
                </p>
              </div>
              <button
                onClick={onClose}
                className="bg-red-500 hover:bg-red-600 text-white w-10 h-10 rounded-full font-bold text-lg transition-all hover:scale-110"
              >
                ✕
              </button>
            </div>
          </div>

          {/* أزرار التصدير */}
          <div className="p-4 border-b border-gray-200 bg-gray-50">
            <div className="flex flex-wrap gap-2 items-center">
              {/* نسخ الكل */}
              <button
                onClick={handleCopyAll}
                className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-xl transition-all hover:scale-105 flex items-center gap-1.5 shadow-md"
              >
                📋 نسخ الكل
              </button>

              {/* Excel ملون */}
              <button
                onClick={handleDownloadExcel}
                className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold rounded-xl transition-all hover:scale-105 flex items-center gap-1.5 shadow-md"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zM6 20V4h7v5h5v11H6z"/>
                  <path d="M8 12h3l1.5 2.5L14 12h3l-3 4 3 4h-3l-1.5-2.5L11 20H8l3-4z"/>
                </svg>
                Excel ملوّن (.xls)
              </button>

              {/* XLSX */}
              <button
                onClick={handleDownloadXLSX}
                className="px-4 py-2.5 bg-green-600 hover:bg-green-700 text-white text-sm font-bold rounded-xl transition-all hover:scale-105 flex items-center gap-1.5 shadow-md"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"/>
                  <path d="M14 2v6h6M9.5 11l2.5 4-2.5 4M14.5 11l-2.5 4 2.5 4" fill="none" stroke="white" strokeWidth="1.5"/>
                </svg>
                Excel (.xlsx)
              </button>

              {/* CSV */}
              <button
                onClick={handleDownloadCSV}
                className="px-4 py-2.5 bg-amber-600 hover:bg-amber-700 text-white text-sm font-bold rounded-xl transition-all hover:scale-105 flex items-center gap-1.5 shadow-md"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zM6 20V4h7v5h5v11H6z"/>
                  <text x="7" y="17" fontSize="7" fill="white" fontWeight="bold">CSV</text>
                </svg>
                CSV
              </button>

              <div className="flex-1" />

              <div className="flex items-center gap-2 bg-indigo-50 px-3 py-1.5 rounded-lg">
                <span className="text-xs text-indigo-600">⏳</span>
                <span className="text-xs text-indigo-700 font-medium">
                  صالحة لمدة {expiryDays} يوم
                </span>
              </div>
            </div>
          </div>

          {/* قائمة الروابط */}
          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            {generatedLinks.map((link, idx) => (
              <div
                key={link.studentId}
                className="bg-gray-50 border border-gray-200 rounded-xl p-3.5 hover:bg-indigo-50/50 hover:border-indigo-200 transition-all group"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <div className="bg-indigo-100 text-indigo-700 w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm">
                      {idx + 1}
                    </div>
                    <div>
                      <p className="font-bold text-gray-800">{link.studentName}</p>
                      <p className="text-xs text-gray-500 font-mono">{link.studentCode}</p>
                    </div>
                  </div>
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => handleShareWhatsApp(link)}
                      className="bg-green-500 hover:bg-green-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold transition-all hover:scale-105 flex items-center gap-1"
                      title="مشاركة عبر واتساب"
                    >
                      📱 واتساب
                    </button>
                    <button
                      onClick={() => handleCopyLink(idx)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all hover:scale-105 flex items-center gap-1 ${
                        link.copied
                          ? 'bg-emerald-500 text-white'
                          : 'bg-blue-500 hover:bg-blue-600 text-white'
                      }`}
                    >
                      {link.copied ? '✓ تم!' : '📋 نسخ'}
                    </button>
                  </div>
                </div>
                <div
                  className="bg-white border border-gray-300 rounded-lg px-3 py-2 text-xs font-mono text-gray-600 break-all group-hover:border-indigo-300 transition-colors"
                  dir="ltr"
                >
                  {link.url}
                </div>
              </div>
            ))}
          </div>

          {/* Footer */}
          <div className="p-3 border-t border-gray-200 bg-gray-50 text-center">
            <button
              onClick={() => setShowLinks(false)}
              className="text-sm text-indigo-600 hover:text-indigo-700 font-medium hover:underline"
            >
              ← الرجوع لاختيار طلاب آخرين
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ══════════════════════════════════════════
  // 🎨 صفحة اختيار الطلاب
  // ══════════════════════════════════════════

  return (
    <div className="fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center p-4" dir="rtl">
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="p-5 border-b border-gray-200 bg-gradient-to-l from-purple-50 to-indigo-50">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                📨 إرسال روابط التسجيل
              </h2>
              <p className="text-sm text-gray-500 mt-1">
                دع الطلاب يسجلون بصمات وجوههم وQR بأنفسهم
              </p>
            </div>
            <button
              onClick={onClose}
              className="bg-red-500 hover:bg-red-600 text-white w-10 h-10 rounded-full font-bold text-lg transition-all hover:scale-110"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">

          {/* اختيار الكلية والمرحلة */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">🏛️ الكلية</label>
              <select
                value={selectedCollegeId}
                onChange={e => {
                  setSelectedCollegeId(e.target.value);
                  setSelectedStageId('');
                  setStudents([]);
                }}
                className="w-full px-3 py-2.5 border border-gray-300 rounded-xl focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 transition"
              >
                <option value="">اختر كلية...</option>
                {colleges.map(c => (
                  <option key={c.id} value={c.id}>{c.icon} {c.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">📚 المرحلة</label>
              <select
                value={selectedStageId}
                onChange={e => handleStageChange(e.target.value)}
                disabled={!selectedCollegeId}
                className="w-full px-3 py-2.5 border border-gray-300 rounded-xl disabled:bg-gray-100 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 transition"
              >
                <option value="">اختر مرحلة...</option>
                {stagesForCollege.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* مدة الصلاحية */}
          <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4">
            <label className="flex items-center justify-between text-sm font-bold text-indigo-800 mb-2">
              <span>⏳ مدة صلاحية الرابط</span>
              <span className="bg-indigo-600 text-white px-3 py-1 rounded-full text-xs">
                {expiryDays} يوم
              </span>
            </label>
            <input
              type="range"
              min="1"
              max="90"
              value={expiryDays}
              onChange={e => setExpiryDays(Number(e.target.value))}
              className="w-full accent-indigo-600 h-2"
            />
            <div className="flex justify-between text-xs text-indigo-500 mt-1">
              <span>1 يوم</span>
              <span>30 يوم</span>
              <span>90 يوم</span>
            </div>
          </div>

          {loading && (
            <div className="text-center py-8">
              <div className="inline-block w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-gray-500 mt-3">جاري تحميل الطلاب...</p>
            </div>
          )}

          {!loading && students.length > 0 && (
            <>
              {/* فلاتر */}
              <div className="space-y-2">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="🔍 بحث بالاسم أو الكود..."
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 transition"
                />

                <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
                  {[
                    { key: 'all' as const, label: `الكل (${students.length})` },
                    { key: 'without-qr' as const, label: `بدون QR (${students.filter(s => !s.qrCodeId).length})` },
                    { key: 'without-face' as const, label: `بدون وجه (${students.filter(s => !s.faceDescriptor).length})` },
                  ].map(f => (
                    <button
                      key={f.key}
                      onClick={() => setFilterMode(f.key)}
                      className={`flex-1 py-2 rounded-lg text-xs font-bold transition ${
                        filterMode === f.key
                          ? 'bg-white text-indigo-700 shadow-sm'
                          : 'text-gray-500 hover:text-gray-700'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* تحديد الكل */}
              <div className="flex items-center justify-between bg-indigo-50 border border-indigo-200 rounded-xl p-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedIds.size === filteredStudents.length && filteredStudents.length > 0}
                    onChange={toggleSelectAll}
                    className="w-5 h-5 accent-indigo-600 rounded"
                  />
                  <span className="font-bold text-indigo-800">
                    تحديد الكل ({filteredStudents.length})
                  </span>
                </label>
                <div className="flex items-center gap-2">
                  <span className="bg-indigo-600 text-white px-3 py-1 rounded-full text-xs font-bold">
                    {selectedIds.size} محدد
                  </span>
                </div>
              </div>

              {/* قائمة الطلاب */}
              <div className="max-h-64 overflow-y-auto border border-gray-200 rounded-xl">
                {filteredStudents.map((s, idx) => (
                  <label
                    key={s.id}
                    className={`flex items-center gap-3 p-3 border-b border-gray-100 cursor-pointer transition ${
                      selectedIds.has(s.id)
                        ? 'bg-indigo-50 hover:bg-indigo-100'
                        : 'hover:bg-gray-50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedIds.has(s.id)}
                      onChange={() => toggleStudent(s.id)}
                      className="w-4 h-4 accent-indigo-600"
                    />
                    <div className="bg-gray-200 text-gray-600 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold">
                      {idx + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm text-gray-800 truncate">{s.name}</p>
                      <p className="text-xs text-gray-500 font-mono">
                        {s.code} {s.group && `• ${s.group}`}
                      </p>
                    </div>
                    <div className="flex gap-1.5">
                      {s.qrCodeId ? (
                        <span className="bg-emerald-100 text-emerald-700 text-xs px-2 py-0.5 rounded-full" title="لديه QR">🔳 QR</span>
                      ) : (
                        <span className="bg-red-100 text-red-500 text-xs px-2 py-0.5 rounded-full">بدون QR</span>
                      )}
                      {s.faceDescriptor ? (
                        <span className="bg-purple-100 text-purple-700 text-xs px-2 py-0.5 rounded-full" title="لديه بصمة">😊 وجه</span>
                      ) : (
                        <span className="bg-orange-100 text-orange-500 text-xs px-2 py-0.5 rounded-full">بدون وجه</span>
                      )}
                    </div>
                  </label>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        {students.length > 0 && (
          <div className="p-4 border-t border-gray-200 bg-gradient-to-l from-purple-50 to-indigo-50">
            <button
              onClick={handleGenerateLinks}
              disabled={selectedIds.size === 0 || generating}
              className="w-full bg-gradient-to-l from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold py-3.5 rounded-xl active:scale-[0.98] transition-all shadow-lg hover:shadow-xl flex items-center justify-center gap-2 text-lg"
            >
              {generating ? (
                <>
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  جاري التوليد...
                </>
              ) : (
                <>🚀 توليد {selectedIds.size} رابط تسجيل</>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default SendRegisterLink;