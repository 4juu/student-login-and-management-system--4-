// src/components/Admin/SendRegisterLink.tsx
import React, { useState, useMemo } from 'react';
import { Student, Stage, College } from '../../types/student';
import { TelegramConfig } from '../../types/telegram';
import {
  createBulkRegistrationLinks,
} from '../../services/tokenService';
import { flushAllPendingSaves } from '../../firebase/dataService';
import {
  sendRegistrationLinksToTelegram,
} from '../../services/telegramService';

interface SendRegisterLinkProps {
  adminUid: string;
  colleges: College[];
  stages: Stage[];
  loadStudents: (stageId: string) => Promise<Student[]>;
  telegramConfig?: TelegramConfig | null;
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
// 🔒 بادئة مختلفة لمنع التضارب مع ملف استيراد الطلاب
// ============================================================
const FILE_PREFIX = 'register_links';

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

import * as XLSX from 'xlsx-js-style';

// ============================================================
// 📁 توليد اسم الملف
// ============================================================
const getFileName = (collegeName: string, stageName: string): string => {
  const { timestamp } = getFormattedDate();
  const cleanCollege = collegeName.replace(/[^\u0600-\u06FFa-zA-Z0-9]/g, '_');
  const cleanStage = stageName.replace(/[^\u0600-\u06FFa-zA-Z0-9]/g, '_');
  return `${FILE_PREFIX}_${cleanCollege}_${cleanStage}_${timestamp}.xlsx`;
};

// ============================================================
// 📊 توليد Excel XLSX حقيقي مع تنسيقات كاملة
// ============================================================
const generateExcel = (
  links: GeneratedLink[],
  expiryDays: number
): Blob => {
  // ── بناء البيانات ──
  const data: any[][] = [];

  // الصف 1: العنوان
  data.push(['روابط تسجيل بصمة الوجه ورمز QR', '', '', '', '']);

  // الصف 2: فارغ
  data.push(['', '', '', '', '']);

  // الصف 3: عناوين الأعمدة
  data.push(['#', 'اسم الطالب', 'كود الطالب', 'رابط التسجيل', 'صلاحية الرابط']);

  // صفوف البيانات
  links.forEach((link, idx) => {
    data.push([
      idx + 1,
      link.studentName,
      link.studentCode,
      link.url,
      `${expiryDays} يوم`,
    ]);
  });

  // ── إنشاء ورقة العمل ──
  const ws = XLSX.utils.aoa_to_sheet(data);

  // ── دمج خلية العنوان ──
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 4 } }, // العنوان من A1 إلى E1
  ];

  // ── عرض الأعمدة ──
  ws['!cols'] = [
    { wch: 6 },    // #
    { wch: 30 },   // اسم الطالب
    { wch: 15 },   // كود الطالب
    { wch: 60 },   // رابط التسجيل
    { wch: 15 },   // صلاحية الرابط
  ];

  // ── ارتفاع الصفوف ──
  ws['!rows'] = [];
  ws['!rows'][0] = { hpt: 45 };  // العنوان
  ws['!rows'][1] = { hpt: 10 };  // فارغ
  ws['!rows'][2] = { hpt: 32 };  // العناوين
  for (let i = 3; i < data.length; i++) {
    ws['!rows'][i] = { hpt: 28 }; // بيانات
  }

  // ── ✅ اتجاه RTL ──
  if (!ws['!sheetView']) ws['!sheetView'] = [];
  (ws as any)['!sheetView'] = [{ RTL: true }];

  // ── 🎨 التنسيقات (Styles) ──

  // 1. خلية العنوان
  const titleStyle = {
    font: {
      name: 'Calibri',
      sz: 20,
      bold: true,
      color: { rgb: 'FFFFFF' },
    },
    fill: {
      patternType: 'solid',
      fgColor: { rgb: '4F46E5' },
    },
    alignment: {
      horizontal: 'center',
      vertical: 'center',
      readingOrder: 2, // RTL
    },
    border: {
      top: { style: 'medium', color: { rgb: '3730A3' } },
      bottom: { style: 'medium', color: { rgb: '3730A3' } },
      left: { style: 'medium', color: { rgb: '3730A3' } },
      right: { style: 'medium', color: { rgb: '3730A3' } },
    },
  };

  // 2. عناوين الأعمدة
  const headerStyle = {
    font: {
      name: 'Calibri',
      sz: 14,
      bold: true,
      color: { rgb: 'FFFFFF' },
    },
    fill: {
      patternType: 'solid',
      fgColor: { rgb: '6366F1' },
    },
    alignment: {
      horizontal: 'center',
      vertical: 'center',
      readingOrder: 2,
    },
    border: {
      top: { style: 'thin', color: { rgb: '4338CA' } },
      bottom: { style: 'thin', color: { rgb: '4338CA' } },
      left: { style: 'thin', color: { rgb: '4338CA' } },
      right: { style: 'thin', color: { rgb: '4338CA' } },
    },
  };

  // 3. خلية الرقم
  const numStyle = {
    font: {
      name: 'Calibri',
      sz: 13,
      bold: true,
      color: { rgb: '4F46E5' },
    },
    fill: {
      patternType: 'solid',
      fgColor: { rgb: 'E0E7FF' },
    },
    alignment: {
      horizontal: 'center',
      vertical: 'center',
    },
    border: {
      top: { style: 'thin', color: { rgb: 'C7D2FE' } },
      bottom: { style: 'thin', color: { rgb: 'C7D2FE' } },
      left: { style: 'thin', color: { rgb: 'C7D2FE' } },
      right: { style: 'thin', color: { rgb: 'C7D2FE' } },
    },
  };

  // 4. خلية الاسم
  const nameStyle = {
    font: {
      name: 'Calibri',
      sz: 13,
      bold: true,
      color: { rgb: '111827' },
    },
    fill: {
      patternType: 'solid',
      fgColor: { rgb: 'FFFFFF' },
    },
    alignment: {
      horizontal: 'right',
      vertical: 'center',
      readingOrder: 2,
    },
    border: {
      top: { style: 'thin', color: { rgb: 'C7D2FE' } },
      bottom: { style: 'thin', color: { rgb: 'C7D2FE' } },
      left: { style: 'thin', color: { rgb: 'C7D2FE' } },
      right: { style: 'thin', color: { rgb: 'C7D2FE' } },
    },
  };

  // 5. خلية الكود
  const codeStyle = {
    font: {
      name: 'Consolas',
      sz: 13,
      bold: true,
      color: { rgb: '059669' },
    },
    fill: {
      patternType: 'solid',
      fgColor: { rgb: 'ECFDF5' },
    },
    alignment: {
      horizontal: 'center',
      vertical: 'center',
    },
    border: {
      top: { style: 'thin', color: { rgb: 'C7D2FE' } },
      bottom: { style: 'thin', color: { rgb: 'C7D2FE' } },
      left: { style: 'thin', color: { rgb: 'C7D2FE' } },
      right: { style: 'thin', color: { rgb: 'C7D2FE' } },
    },
  };

  // 6. خلية الرابط
  const linkStyle = {
    font: {
      name: 'Consolas',
      sz: 11,
      color: { rgb: '2563EB' },
    },
    fill: {
      patternType: 'solid',
      fgColor: { rgb: 'EFF6FF' },
    },
    alignment: {
      horizontal: 'left',
      vertical: 'center',
      wrapText: true,
    },
    border: {
      top: { style: 'thin', color: { rgb: 'C7D2FE' } },
      bottom: { style: 'thin', color: { rgb: 'C7D2FE' } },
      left: { style: 'thin', color: { rgb: 'C7D2FE' } },
      right: { style: 'thin', color: { rgb: 'C7D2FE' } },
    },
  };

  // 7. خلية الصلاحية
  const expiryStyle = {
    font: {
      name: 'Calibri',
      sz: 12,
      bold: true,
      color: { rgb: 'D97706' },
    },
    fill: {
      patternType: 'solid',
      fgColor: { rgb: 'FEF3C7' },
    },
    alignment: {
      horizontal: 'center',
      vertical: 'center',
      readingOrder: 2,
    },
    border: {
      top: { style: 'thin', color: { rgb: 'C7D2FE' } },
      bottom: { style: 'thin', color: { rgb: 'C7D2FE' } },
      left: { style: 'thin', color: { rgb: 'C7D2FE' } },
      right: { style: 'thin', color: { rgb: 'C7D2FE' } },
    },
  };

  // ── تطبيق التنسيقات على الخلايا ──

  // خلية العنوان (A1)
  ws['A1'].s = titleStyle;

  // خلايا العناوين (A3 → E3)
  ['A3', 'B3', 'C3', 'D3', 'E3'].forEach(cell => {
    if (ws[cell]) ws[cell].s = headerStyle;
  });

  // خلايا البيانات
  for (let i = 0; i < links.length; i++) {
    const rowNum = i + 4; // البيانات تبدأ من الصف 4
    const numCell = `A${rowNum}`;
    const nameCell = `B${rowNum}`;
    const codeCell = `C${rowNum}`;
    const linkCell = `D${rowNum}`;
    const expiryCell = `E${rowNum}`;

    if (ws[numCell]) ws[numCell].s = numStyle;
    if (ws[nameCell]) ws[nameCell].s = nameStyle;
    if (ws[codeCell]) ws[codeCell].s = codeStyle;
    if (ws[linkCell]) ws[linkCell].s = linkStyle;
    if (ws[expiryCell]) ws[expiryCell].s = expiryStyle;
  }

  // ── تجميد الصفوف العلوية ──
  ws['!freeze'] = { xSplit: 0, ySplit: 3 };

  // ── إنشاء الـ Workbook ──
  const wb = XLSX.utils.book_new();
  wb.Workbook = {
    Views: [{ RTL: true }],
  };
  XLSX.utils.book_append_sheet(wb, ws, 'روابط التسجيل');

  // ── تحويل لـ Blob ──
  const wbout = XLSX.write(wb, {
    bookType: 'xlsx',
    type: 'array',
    cellStyles: true,
  });

  return new Blob([wbout], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
};

// ============================================================
// 🧩 المكون الرئيسي
// ============================================================

export const SendRegisterLink: React.FC<SendRegisterLinkProps> = ({
  adminUid,
  colleges,
  stages,
  loadStudents,
  telegramConfig,
  onClose,
}) => {
  const [selectedCollegeId, setSelectedCollegeId] = useState('');
  const [selectedStageId, setSelectedStageId] = useState('');
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'without-qr' | 'without-face'>('all');

  const [generatedLinks, setGeneratedLinks] = useState<GeneratedLink[]>([]);
  const [generating, setGenerating] = useState(false);
  const [showLinks, setShowLinks] = useState(false);
  const [expiryDays, setExpiryDays] = useState(30);

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
    if (selectedIds.size === 0) { alert('الرجاء اختيار طلاب'); return; }
    if (!selectedStageId) return;
    if (!window.confirm(`سيتم توليد ${selectedIds.size} رابط تسجيل. متابعة؟`)) return;

    setGenerating(true);
    try {
      // 💾 نضمن حفظ كل بيانات الطلاب قبل إنشاء الروابط
      await flushAllPendingSaves();
      const studentIds = Array.from(selectedIds);
      const links = await createBulkRegistrationLinks(adminUid, selectedStageId, studentIds, expiryDays);

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
    try {
      await navigator.clipboard.writeText(generatedLinks[index].url);
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
    } catch { alert('فشل النسخ'); }
  };

  const handleCopyAll = async () => {
    const text = generatedLinks
      .map(l => `${l.studentName} (${l.studentCode}):\n${l.url}`)
      .join('\n\n');
    try {
      await navigator.clipboard.writeText(text);
      alert(`✅ تم نسخ ${generatedLinks.length} رابط`);
    } catch { alert('فشل النسخ'); }
  };

  // ── 📥 تحميل Excel ──
const handleDownloadExcel = () => {
    const collegeName = selectedCollege?.name || 'غير_محدد';
    const stageName = selectedStage?.name || 'غير_محدد';

    // ✅ نمرر الروابط ومدة الصلاحية فقط
    const blob = generateExcel(generatedLinks, expiryDays);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = getFileName(collegeName, stageName);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleShareWhatsApp = (link: GeneratedLink) => {
    const text = encodeURIComponent(
      `مرحباً ${link.studentName} 👋\n\nرابط تسجيل بصمة الوجه ورمز QR الخاص بك:\n\n${link.url}\n\nالرابط صالح لمدة ${expiryDays} يوم.`
    );
    const a = document.createElement('a');
    a.href = `https://wa.me/?text=${text}`;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const [sendingTelegram, setSendingTelegram] = useState(false);

  const handleSendTelegram = async () => {
    if (!telegramConfig || generatedLinks.length === 0) return;
    setSendingTelegram(true);
    try {
      const result = await sendRegistrationLinksToTelegram(
        telegramConfig,
        selectedStageId,
        generatedLinks.map(l => ({ studentName: l.studentName, studentCode: l.studentCode, url: l.url })),
        selectedStage?.name || '',
        expiryDays
      );
      if (result.success) {
        alert(`✅ تم إرسال ${result.count} رابط إلى تيليغرام`);
      } else {
        alert('❌ ' + (result.error || 'فشل الإرسال'));
      }
    } catch (e: any) {
      alert('❌ فشل الإرسال: ' + (e.message || ''));
    } finally {
      setSendingTelegram(false);
    }
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
                  <strong className="text-indigo-600">{generatedLinks.length}</strong> رابط
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
              <button
                onClick={handleCopyAll}
                className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-xl transition-all hover:scale-105 flex items-center gap-1.5 shadow-md"
              >
                📋 نسخ الكل
              </button>

              <button
                onClick={handleDownloadExcel}
                className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold rounded-xl transition-all hover:scale-105 flex items-center gap-1.5 shadow-md"
              >
                📗 تحميل Excel
              </button>

              {telegramConfig?.channels[selectedStageId]?.chatId && (
                <button
                  onClick={handleSendTelegram}
                  disabled={sendingTelegram}
                  className="px-4 py-2.5 bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white text-sm font-bold rounded-xl transition-all hover:scale-105 flex items-center gap-1.5 shadow-md"
                >
                  {sendingTelegram
                    ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> جاري...</>
                    : <>📨 تيليغرام</>
                  }
                </button>
              )}

              <div className="flex-1" />

              <div className="flex items-center gap-2 bg-indigo-50 px-3 py-1.5 rounded-lg">
                <span className="text-xs text-indigo-700 font-medium">
                  ⏳ صالحة {expiryDays} يوم
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
                      className="bg-green-500 hover:bg-green-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold transition-all hover:scale-105"
                    >
                      📱 واتساب
                    </button>
                    <button
                      onClick={() => handleCopyLink(idx)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all hover:scale-105 ${
                        link.copied
                          ? 'bg-emerald-500 text-white'
                          : 'bg-blue-500 hover:bg-blue-600 text-white'
                      }`}
                    >
                      {link.copied ? '✓ تم!' : '📋 نسخ'}
                    </button>
                  </div>
                </div>
                <div className="bg-white border border-gray-300 rounded-lg px-3 py-2 text-xs font-mono text-gray-600 break-all group-hover:border-indigo-300 transition-colors" dir="ltr">
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
              <h2 className="text-xl font-bold text-gray-800">📨 إرسال روابط التسجيل</h2>
              <p className="text-sm text-gray-500 mt-1">دع الطلاب يسجلون بصمات وجوههم وQR بأنفسهم</p>
            </div>
            <button onClick={onClose} className="bg-red-500 hover:bg-red-600 text-white w-10 h-10 rounded-full font-bold text-lg transition-all hover:scale-110">✕</button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">

          {/* اختيار الكلية والمرحلة */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">🏛️ الكلية</label>
              <select
                value={selectedCollegeId}
                onChange={e => { setSelectedCollegeId(e.target.value); setSelectedStageId(''); setStudents([]); }}
                className="w-full px-3 py-2.5 border border-gray-300 rounded-xl focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
              >
                <option value="">اختر كلية...</option>
                {colleges.map(c => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">📚 المرحلة</label>
              <select
                value={selectedStageId}
                onChange={e => handleStageChange(e.target.value)}
                disabled={!selectedCollegeId}
                className="w-full px-3 py-2.5 border border-gray-300 rounded-xl disabled:bg-gray-100 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
              >
                <option value="">اختر مرحلة...</option>
                {stagesForCollege.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          </div>

          {/* مدة الصلاحية */}
          <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4">
            <label className="flex items-center justify-between text-sm font-bold text-indigo-800 mb-2">
              <span>⏳ مدة صلاحية الرابط</span>
              <span className="bg-indigo-600 text-white px-3 py-1 rounded-full text-xs">{expiryDays} يوم</span>
            </label>
            <input type="range" min="1" max="90" value={expiryDays} onChange={e => setExpiryDays(Number(e.target.value))} className="w-full accent-indigo-600 h-2" />
            <div className="flex justify-between text-xs text-indigo-500 mt-1">
              <span>1 يوم</span><span>30 يوم</span><span>90 يوم</span>
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
                  type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                  placeholder="🔍 بحث بالاسم أو الكود..."
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
                />
                <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
                  {([
                    { key: 'all' as const, label: `الكل (${students.length})` },
                    { key: 'without-qr' as const, label: `بدون QR (${students.filter(s => !s.qrCodeId).length})` },
                    { key: 'without-face' as const, label: `بدون وجه (${students.filter(s => !s.faceDescriptor).length})` },
                  ]).map(f => (
                    <button key={f.key} onClick={() => setFilterMode(f.key)}
                      className={`flex-1 py-2 rounded-lg text-xs font-bold transition ${filterMode === f.key ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                    >{f.label}</button>
                  ))}
                </div>
              </div>

              {/* تحديد الكل */}
              <div className="flex items-center justify-between bg-indigo-50 border border-indigo-200 rounded-xl p-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox"
                    checked={selectedIds.size === filteredStudents.length && filteredStudents.length > 0}
                    onChange={toggleSelectAll} className="w-5 h-5 accent-indigo-600 rounded"
                  />
                  <span className="font-bold text-indigo-800">تحديد الكل ({filteredStudents.length})</span>
                </label>
                <span className="bg-indigo-600 text-white px-3 py-1 rounded-full text-xs font-bold">
                  {selectedIds.size} محدد
                </span>
              </div>

              {/* قائمة الطلاب */}
              <div className="max-h-64 overflow-y-auto border border-gray-200 rounded-xl">
                {filteredStudents.map((s, idx) => (
                  <label key={s.id}
                    className={`flex items-center gap-3 p-3 border-b border-gray-100 cursor-pointer transition ${selectedIds.has(s.id) ? 'bg-indigo-50 hover:bg-indigo-100' : 'hover:bg-gray-50'}`}
                  >
                    <input type="checkbox" checked={selectedIds.has(s.id)} onChange={() => toggleStudent(s.id)} className="w-4 h-4 accent-indigo-600" />
                    <div className="bg-gray-200 text-gray-600 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold">{idx + 1}</div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm text-gray-800 truncate">{s.name}</p>
                      <p className="text-xs text-gray-500 font-mono">{s.code} {s.group && `• ${s.group}`}</p>
                    </div>
                    <div className="flex gap-1.5">
                      {s.qrCodeId
                        ? <span className="bg-emerald-100 text-emerald-700 text-xs px-2 py-0.5 rounded-full">🔳 QR</span>
                        : <span className="bg-red-100 text-red-500 text-xs px-2 py-0.5 rounded-full">بدون QR</span>
                      }
                      {s.faceDescriptor
                        ? <span className="bg-purple-100 text-purple-700 text-xs px-2 py-0.5 rounded-full">😊 وجه</span>
                        : <span className="bg-orange-100 text-orange-500 text-xs px-2 py-0.5 rounded-full">بدون وجه</span>
                      }
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
              {generating
                ? <><div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /> جاري التوليد...</>
                : <>🚀 توليد {selectedIds.size} رابط تسجيل</>
              }
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default SendRegisterLink;