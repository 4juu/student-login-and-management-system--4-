import React, { useState, useRef } from 'react';
import { Student } from '../types/student';
import * as XLSX from 'xlsx';

interface StudentManagerProps {
  students: Student[];
  onAddStudent: (student: Student) => void;
  onUpdateStudent?: (id: string, updates: Partial<Student>) => void;
  onDeleteStudent: (id: string) => void;
  onDeleteSelectedStudents: (ids: string[]) => void;
  onSortByName?: () => void;
  onSortByGroup?: () => void;
}

// ✅ دالة استخراج رمز QR (من رابط الوزارة أو من النص الخام)
const extractQrCodeId = (raw: string): string => {
  const text = raw.trim();
  if (!text) return '';

  // إذا رابط
  try {
    const url = new URL(text);
    const id = url.searchParams.get('id');
    if (id) return id.trim();
  } catch {
    // ليس رابط، تجاهل
  }

  // نص خام
  return text;
};

export const StudentManager: React.FC<StudentManagerProps> = ({
  students,
  onAddStudent,
  onUpdateStudent,
  onDeleteStudent,
  onDeleteSelectedStudents,
  onSortByName,
  onSortByGroup,
}) => {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [universityId, setUniversityId] = useState('');
  const [qrCodeId, setQrCodeId] = useState('');
  const [group, setGroup] = useState('');
  const [error, setError] = useState('');
  const [selectedPrefix, setSelectedPrefix] = useState<number>(1);
  const [importLoading, setImportLoading] = useState(false);
  const [importMessage, setImportMessage] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // تعديل الرقم الجامعي
  const [editingUniIdStudent, setEditingUniIdStudent] = useState<string | null>(null);
  const [editUniversityId, setEditUniversityId] = useState('');

  // تعديل رمز QR
  const [editingQrStudent, setEditingQrStudent] = useState<string | null>(null);
  const [editQrCodeId, setEditQrCodeId] = useState('');

  const [searchQuery, setSearchQuery] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!/^\d{4}$/.test(code)) {
      setError('الرمز يجب أن يكون 4 أرقام بالضبط (من 1000 إلى 9999)');
      return;
    }

    const codeNum = parseInt(code);
    if (codeNum < 1000 || codeNum > 9999) {
      setError('الرمز يجب أن يكون بين 1000 و 9999');
      return;
    }

    if (students.some(s => s.code === code)) {
      setError('هذا الرمز مستخدم بالفعل');
      return;
    }

    if (!name.trim()) {
      setError('الرجاء إدخال اسم الطالب');
      return;
    }

    // تحقق من تكرار الرقم الجامعي
    if (universityId.trim() && students.some(s => s.universityId === universityId.trim())) {
      setError('هذا الرقم الجامعي مستخدم بالفعل');
      return;
    }

    // ✅ استخراج رمز QR (يدعم اللصق المباشر للرابط)
    const cleanQrCode = qrCodeId.trim() ? extractQrCodeId(qrCodeId) : '';

    // تحقق من تكرار رمز QR
    if (cleanQrCode && students.some(s => s.qrCodeId === cleanQrCode)) {
      setError('رمز QR هذا مستخدم لطالب آخر بالفعل');
      return;
    }

    const newStudent: Student = {
      id: Date.now().toString(),
      name: name.trim(),
      code,
      group: group.trim() || undefined,
      universityId: universityId.trim() || undefined,
      qrCodeId: cleanQrCode || undefined,
      createdAt: new Date().toISOString(),
    };

    onAddStudent(newStudent);
    setName('');
    setCode('');
    setUniversityId('');
    setQrCodeId('');
    setGroup('');
  };

  const sortGroups = (a: string, b: string): number => {
    const letterA = a.charAt(0).toUpperCase();
    const letterB = b.charAt(0).toUpperCase();
    if (letterA !== letterB) return letterA.localeCompare(letterB);
    const numA = parseInt(a.slice(1)) || 0;
    const numB = parseInt(b.slice(1)) || 0;
    return numA - numB;
  };

const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
  const file = e.target.files?.[0];
  if (!file) return;

  setImportLoading(true);
  setImportMessage('');
  setError('');

  try {
    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });

    const parsed: {
      name: string;
      group: string;
      universityId?: string;
      qrCodeId?: string;
    }[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length === 0) continue;

      let studentName = '';
      let studentGroup = '';
      let studentUniId = '';
      let studentQrCode = '';

      for (const cell of row) {
        if (cell === null || cell === undefined) continue;
        const cellStr = String(cell).trim();
        if (!cellStr) continue;

        // ✅ كشف رابط الوزارة أو أي رابط فيه ?id=
        if (cellStr.includes('http') && cellStr.includes('id=')) {
          const extracted = extractQrCodeId(cellStr);
          if (extracted && extracted !== cellStr) {
            studentQrCode = extracted;
            continue;
          }
        }

        // ✅ كروب (حرف + أرقام)
        if (/^[A-Za-z]\d+$/.test(cellStr)) {
          studentGroup = cellStr.toUpperCase();
        }
        // ✅ رقم جامعي (8-15 رقم متتالي)
        else if (/^\d{8,15}$/.test(cellStr)) {
          studentUniId = cellStr;
        }
        // ✅ رمز QR (نص لاتيني/أرقام بطول 10-30 بدون مسافات وليس رقم خالص)
        else if (
          /^[A-Za-z0-9_-]{10,40}$/.test(cellStr) &&
          /[A-Za-z]/.test(cellStr) &&
          !studentQrCode
        ) {
          studentQrCode = cellStr;
        }
        // ✅ اسم عربي
        else if (/[\u0600-\u06FF]/.test(cellStr) && cellStr.length > 2) {
          if (
            !cellStr.includes('الاسم') &&
            !cellStr.includes('الكروب') &&
            !cellStr.includes('المرحلة') &&
            !cellStr.includes('العملي') &&
            !cellStr.includes('الرقم') &&
            !cellStr.includes('رابط') &&
            !cellStr.includes('باركود') &&
            !cellStr.includes('QR')
          ) {
            studentName = cellStr;
          }
        }
      }

      if (studentName && studentGroup) {
        parsed.push({
          name: studentName,
          group: studentGroup,
          universityId: studentUniId || undefined,
          qrCodeId: studentQrCode || undefined,
        });
      }
    }

    if (parsed.length === 0) {
      setError('❌ لم يتم العثور على طلاب في الملف. تأكد من تنسيق الملف.');
      setImportLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    parsed.sort((a, b) => {
      const groupCompare = sortGroups(a.group, b.group);
      if (groupCompare !== 0) return groupCompare;
      return a.name.localeCompare(b.name, 'ar');
    });

    const startCode = selectedPrefix * 1000 + 1;
    const existingCodes = new Set(students.map(s => s.code));
    const existingUniIds = new Set(students.map(s => s.universityId).filter(Boolean));
    const existingQrCodes = new Set(students.map(s => s.qrCodeId).filter(Boolean));
    let currentCode = startCode;
    let addedCount = 0;
    let skippedCount = 0;
    let qrLinkedCount = 0;

    for (const student of parsed) {
      if (students.some(s => s.name === student.name)) {
        skippedCount++;
        continue;
      }

      while (existingCodes.has(String(currentCode)) && currentCode <= 9999) {
        currentCode++;
      }

      if (currentCode > 9999) {
        setError('⚠️ تم تجاوز الحد الأقصى للأكواد (9999)');
        break;
      }

      // ✅ تجنب تكرار الرقم الجامعي
      const uniId = student.universityId && !existingUniIds.has(student.universityId)
        ? student.universityId
        : undefined;
      if (uniId) existingUniIds.add(uniId);

      // ✅ تجنب تكرار رمز QR
      const qrCode = student.qrCodeId && !existingQrCodes.has(student.qrCodeId)
        ? student.qrCodeId
        : undefined;
      if (qrCode) {
        existingQrCodes.add(qrCode);
        qrLinkedCount++;
      }

      const newStudent: Student = {
        id: `${Date.now()}_${addedCount}`,
        name: student.name,
        code: String(currentCode),
        group: student.group,
        universityId: uniId,
        qrCodeId: qrCode,
        createdAt: new Date().toISOString(),
      };

      onAddStudent(newStudent);
      existingCodes.add(String(currentCode));
      currentCode++;
      addedCount++;
    }

    setImportMessage(
      `✅ تمت إضافة ${addedCount} طالب بنجاح` +
      (qrLinkedCount > 0 ? ` (🔳 ${qrLinkedCount} مربوط برمز QR)` : '') +
      (skippedCount > 0 ? ` (⚠️ تم تجاهل ${skippedCount} طالب مكرر)` : '')
    );
  } catch (err) {
    console.error(err);
    setError('❌ حدث خطأ أثناء قراءة الملف. تأكد من نوع الملف (xlsx, xls, csv).');
  } finally {
    setImportLoading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }
};

  const toggleSelectStudent = (id: string) => {
    setSelectedIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) newSet.delete(id);
      else newSet.add(id);
      return newSet;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredStudents.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredStudents.map(s => s.id)));
    }
  };

  const handleDeleteSelected = () => {
    if (selectedIds.size === 0) return;

    const isAll = selectedIds.size === students.length;
    const message = isAll
      ? `⚠️ سيتم حذف جميع الطلاب (${students.length})!\nهل أنت متأكد؟`
      : `⚠️ هل أنت متأكد من حذف ${selectedIds.size} طالب؟`;

    if (!window.confirm(message)) return;

    onDeleteSelectedStudents(Array.from(selectedIds));
    setSelectedIds(new Set());
  };

  // === تعديل الرقم الجامعي ===
  const startEditUniId = (student: Student) => {
    setEditingUniIdStudent(student.id);
    setEditUniversityId(student.universityId || '');
  };

  const saveEditUniId = () => {
    if (!editingUniIdStudent || !onUpdateStudent) return;

    const trimmedId = editUniversityId.trim();

    if (trimmedId && students.some(s => s.id !== editingUniIdStudent && s.universityId === trimmedId)) {
      alert('❌ هذا الرقم الجامعي مستخدم لطالب آخر');
      return;
    }

    onUpdateStudent(editingUniIdStudent, { universityId: trimmedId || undefined });
    setEditingUniIdStudent(null);
    setEditUniversityId('');
  };

  const cancelEditUniId = () => {
    setEditingUniIdStudent(null);
    setEditUniversityId('');
  };

  // === تعديل رمز QR ===
  const startEditQr = (student: Student) => {
    setEditingQrStudent(student.id);
    setEditQrCodeId(student.qrCodeId || '');
  };

  const saveEditQr = () => {
    if (!editingQrStudent || !onUpdateStudent) return;

    const cleanQr = editQrCodeId.trim() ? extractQrCodeId(editQrCodeId) : '';

    if (cleanQr && students.some(s => s.id !== editingQrStudent && s.qrCodeId === cleanQr)) {
      alert('❌ رمز QR هذا مستخدم لطالب آخر');
      return;
    }

    onUpdateStudent(editingQrStudent, { qrCodeId: cleanQr || undefined });
    setEditingQrStudent(null);
    setEditQrCodeId('');
  };

  const cancelEditQr = () => {
    setEditingQrStudent(null);
    setEditQrCodeId('');
  };

  const removeQrLink = (student: Student) => {
    if (!onUpdateStudent) return;
    if (!window.confirm(`هل تريد فك ربط رمز QR من ${student.name}؟`)) return;
    onUpdateStudent(student.id, { qrCodeId: undefined });
  };

  // فلترة الطلاب
  const filteredStudents = students.filter(s => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      s.name.toLowerCase().includes(q) ||
      s.code.toLowerCase().includes(q) ||
      (s.group && s.group.toLowerCase().includes(q)) ||
      (s.universityId && s.universityId.toLowerCase().includes(q)) ||
      (s.qrCodeId && s.qrCodeId.toLowerCase().includes(q))
    );
  });

  // إحصائيات
  const studentsWithUniId = students.filter(s => s.universityId).length;
  const studentsWithoutUniId = students.length - studentsWithUniId;
  const studentsWithQr = students.filter(s => s.qrCodeId).length;
  const studentsWithoutQr = students.length - studentsWithQr;

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <h2 className="text-2xl font-bold mb-4 text-gray-800">إدارة الطلاب</h2>

      {/* تنبيه عن رمز QR */}
      {students.length > 0 && studentsWithoutQr > 0 && (
        <div className="mb-3 p-3 bg-emerald-50 border border-emerald-300 rounded-lg flex items-center gap-3">
          <span className="text-2xl">🔳</span>
          <div className="flex-1">
            <p className="text-sm font-bold text-emerald-800">
              {studentsWithoutQr} طالب بدون ربط رمز QR
            </p>
            <p className="text-xs text-emerald-700">
              سيتم الربط تلقائياً عند أول مسح هوية. أو يمكنك إضافته يدوياً من الجدول أدناه.
            </p>
          </div>
        </div>
      )}

      {/* تنبيه عن الرقم الجامعي */}
      {students.length > 0 && studentsWithoutUniId > 0 && (
        <div className="mb-4 p-3 bg-yellow-50 border border-yellow-300 rounded-lg flex items-center gap-3">
          <span className="text-2xl">⚠️</span>
          <div className="flex-1">
            <p className="text-sm font-bold text-yellow-800">
              {studentsWithoutUniId} طالب بدون رقم جامعي
            </p>
            <p className="text-xs text-yellow-700">
              الرقم الجامعي اختياري ولا يؤثر على ميزة QR.
            </p>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="mb-6">
  {/* الصف الأول: المعلومات الأساسية */}
  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-2">
        اسم الطالب *
      </label>
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        placeholder="أدخل اسم الطالب"
        dir="rtl"
      />
    </div>

    <div>
      <label className="block text-sm font-medium text-gray-700 mb-2">
        رمز الطالب (4 أرقام) *
      </label>
      <input
        type="text"
        value={code}
        onChange={(e) => {
          const value = e.target.value.replace(/\D/g, '');
          if (value.length <= 4) setCode(value);
        }}
        maxLength={4}
        className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent text-center text-lg font-bold"
        placeholder="1001"
        inputMode="numeric"
      />
      <p className="text-xs text-gray-500 mt-1 text-center">من 1000 إلى 9999</p>
    </div>

    <div>
      <label className="block text-sm font-medium text-gray-700 mb-2">
        الكروب (اختياري)
      </label>
      <input
        type="text"
        value={group}
        onChange={(e) => setGroup(e.target.value.toUpperCase())}
        className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent text-center"
        placeholder="A1"
      />
    </div>

    <div>
      <label className="block text-sm font-medium text-gray-700 mb-2 flex items-center gap-1">
        🪪 الرقم الجامعي
        <span className="text-xs text-blue-600">(اختياري)</span>
      </label>
      <input
        type="text"
        value={universityId}
        onChange={(e) => setUniversityId(e.target.value.replace(/\D/g, ''))}
        className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent text-center font-mono"
        placeholder="8886736221"
        inputMode="numeric"
      />
      <p className="text-xs text-gray-500 mt-1 text-center">رقم الهوية الجامعية</p>
    </div>
  </div>

  {/* الصف الثاني: رمز QR (منفصل لأنه طويل) */}
  <div className="mt-4 p-4 bg-gradient-to-br from-emerald-50 to-teal-50 border-2 border-emerald-200 rounded-lg">
    <label className="block text-sm font-bold text-emerald-800 mb-2 flex items-center gap-2">
      <span className="text-xl">🔳</span>
      <span>رمز QR الهوية</span>
      <span className="text-xs font-normal text-emerald-600 bg-white px-2 py-0.5 rounded-full">
        اختياري - للمسح السريع
      </span>
    </label>
    <input
      type="text"
      value={qrCodeId}
      onChange={(e) => setQrCodeId(e.target.value)}
      className="w-full px-4 py-2 border border-emerald-300 rounded-md focus:ring-2 focus:ring-emerald-500 focus:border-transparent font-mono text-sm bg-white"
      placeholder="ألصق هنا: https://sis.mohesr.gov.iq/verify?id=... أو الرمز مباشرة"
      dir="ltr"
    />
    <p className="text-xs text-emerald-700 mt-2 flex items-start gap-1">
      <span>💡</span>
      <span>
        يمكنك لصق <strong>الرابط الكامل</strong> من هوية الوزارة وسيتم استخراج الرمز تلقائياً،
        أو تركه فارغاً ليتم الربط تلقائياً عند أول مسح للهوية.
      </span>
    </p>
  </div>

  <div className="mt-4 flex justify-end">
    <button
      type="submit"
      className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-8 rounded-md transition duration-200"
    >
      ➕ إضافة طالب
    </button>
  </div>

  {error && (
    <div className="mt-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded-md" dir="rtl">
      {error}
    </div>
  )}
</form>

      {/* قسم الاستيراد من Excel */}
      <div className="mb-6 p-5 bg-gradient-to-br from-blue-50 to-indigo-50 border-2 border-blue-200 rounded-lg">
        <h3 className="text-lg font-bold text-gray-800 mb-3 flex items-center gap-2">
          📂 استيراد الطلاب من ملف Excel
        </h3>
        <div className="mb-4 text-sm text-gray-600 space-y-1">
  <p>
    اختر بادئة الكود ثم ارفع الملف. سيتم اكتشاف الحقول التالية تلقائياً:
  </p>
  <div className="flex flex-wrap gap-2 mt-2">
    <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs font-medium">
      📝 الاسم
    </span>
    <span className="px-2 py-1 bg-indigo-100 text-indigo-800 rounded text-xs font-medium">
      👥 الكروب (A1, B2, ...)
    </span>
    <span className="px-2 py-1 bg-purple-100 text-purple-800 rounded text-xs font-medium">
      🪪 الرقم الجامعي (8-15 رقم)
    </span>
    <span className="px-2 py-1 bg-emerald-100 text-emerald-800 rounded text-xs font-medium">
      🔳 رمز QR (رابط الوزارة الكامل)
    </span>
  </div>
  <p className="text-xs text-emerald-700 mt-2 bg-emerald-50 p-2 rounded border border-emerald-200">
    💡 <strong>نصيحة:</strong> الصق الرابط الكامل من هوية الوزارة بأي عمود، وسيتم استخراج رمز QR تلقائياً لكل طالب.
  </p>
</div>

        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            اختر بادئة الكود:
          </label>
          <div className="flex flex-wrap gap-2">
            {[1, 2, 3, 4, 5].map((num) => (
              <button
                key={num}
                type="button"
                onClick={() => setSelectedPrefix(num)}
                className={`w-14 h-14 rounded-lg font-bold text-lg transition duration-200 ${
                  selectedPrefix === num
                    ? 'bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-lg scale-110'
                    : 'bg-white text-gray-700 border-2 border-gray-300 hover:border-blue-400'
                }`}
              >
                {num}
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-500 mt-2">
            🔢 الأكواد ستبدأ من: <strong>{selectedPrefix}001</strong>
          </p>
        </div>

        <div className="flex items-center gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={handleFileUpload}
            className="hidden"
            id="excel-upload"
            disabled={importLoading}
          />
          <label
            htmlFor="excel-upload"
            className={`flex-1 text-center cursor-pointer bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-medium py-3 px-6 rounded-md transition duration-200 shadow-md ${
              importLoading ? 'opacity-50 cursor-not-allowed' : ''
            }`}
          >
            {importLoading ? '⏳ جاري المعالجة...' : '📤 رفع ملف Excel'}
          </label>
        </div>

        {importMessage && (
          <div className="mt-4 p-3 bg-green-100 border border-green-400 text-green-800 rounded-md" dir="rtl">
            {importMessage}
          </div>
        )}
      </div>

      {/* أزرار الترتيب */}
      {students.length > 1 && (onSortByName || onSortByGroup) && (
        <div className="mb-4 p-4 bg-gradient-to-r from-purple-50 to-pink-50 border-2 border-purple-200 rounded-lg">
          <h3 className="text-sm font-bold text-purple-800 mb-3 flex items-center gap-2">
            🔄 إعادة ترتيب الطلاب
          </h3>
          <div className="flex flex-wrap gap-2">
            {onSortByName && (
              <button
                onClick={() => {
                  if (window.confirm('هل تريد ترتيب الطلاب أبجدياً حسب الأسماء؟')) {
                    onSortByName();
                  }
                }}
                className="flex-1 min-w-[200px] px-4 py-2 bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-700 hover:to-purple-800 text-white font-medium rounded-md transition duration-200 shadow-md"
              >
                🔤 ترتيب أبجدي حسب الاسم
              </button>
            )}
            {onSortByGroup && (
              <button
                onClick={() => {
                  if (window.confirm('هل تريد ترتيب الطلاب حسب الكروب ثم الاسم؟')) {
                    onSortByGroup();
                  }
                }}
                className="flex-1 min-w-[200px] px-4 py-2 bg-gradient-to-r from-pink-600 to-pink-700 hover:from-pink-700 hover:to-pink-800 text-white font-medium rounded-md transition duration-200 shadow-md"
              >
                👥 ترتيب حسب الكروب + الاسم
              </button>
            )}
          </div>
        </div>
      )}

      {/* شريط البحث */}
      {students.length > 5 && (
        <div className="mb-4">
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="🔍 بحث بالاسم أو الكود أو الكروب أو الرقم الجامعي أو رمز QR..."
              className="w-full px-4 py-2 pr-10 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              dir="rtl"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xl"
              >
                ×
              </button>
            )}
          </div>
          {searchQuery && (
            <p className="text-xs text-gray-500 mt-1">
              نتائج البحث: {filteredStudents.length} من {students.length}
            </p>
          )}
        </div>
      )}

      {/* شريط الحذف الجماعي */}
      {selectedIds.size > 0 && (
        <div className="mb-4 p-4 bg-gradient-to-r from-orange-50 to-red-50 border-2 border-orange-300 rounded-lg flex items-center justify-between flex-wrap gap-3">
          <div className="text-orange-800 font-medium">
            ✅ تم تحديد <strong>{selectedIds.size}</strong> من {students.length} طالب
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setSelectedIds(new Set())}
              className="px-4 py-2 bg-gray-500 hover:bg-gray-600 text-white font-medium rounded-md transition"
            >
              إلغاء التحديد
            </button>
            <button
              onClick={handleDeleteSelected}
              className="px-4 py-2 bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800 text-white font-medium rounded-md transition shadow-md"
            >
              🗑️ حذف المحدد ({selectedIds.size})
            </button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-center">
                {filteredStudents.length > 0 && (
                  <input
                    type="checkbox"
                    checked={selectedIds.size === filteredStudents.length && filteredStudents.length > 0}
                    onChange={toggleSelectAll}
                    className="w-5 h-5 cursor-pointer accent-blue-600"
                    title="تحديد الكل"
                  />
                )}
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">الرمز</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">الاسم</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">الكروب</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">🪪 الرقم الجامعي</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">🔳 رمز QR</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">إجراءات</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {filteredStudents.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-6 py-8 text-center text-gray-500">
                  <div className="flex flex-col items-center gap-2">
                    <p className="font-medium">
                      {searchQuery ? '🔍 لا توجد نتائج للبحث' : 'لا توجد طلاب مسجلين'}
                    </p>
                    {!searchQuery && (
                      <p className="text-sm">ابدأ بإضافة الطلاب أو ارفع ملف Excel</p>
                    )}
                  </div>
                </td>
              </tr>
            ) : (
              filteredStudents.map((student) => (
                <tr
                  key={student.id}
                  className={`hover:bg-gray-50 transition ${selectedIds.has(student.id) ? 'bg-blue-50' : ''}`}
                >
                  <td className="px-4 py-4 text-center">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(student.id)}
                      onChange={() => toggleSelectStudent(student.id)}
                      className="w-5 h-5 cursor-pointer accent-blue-600"
                    />
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap">
                    <span className="text-lg font-bold text-blue-600">{student.code}</span>
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap text-right">{student.name}</td>
                  <td className="px-4 py-4 whitespace-nowrap text-right">
                    {student.group ? (
                      <span className="inline-block px-3 py-1 bg-indigo-100 text-indigo-800 text-sm font-medium rounded-full">
                        {student.group}
                      </span>
                    ) : (
                      <span className="text-gray-400 text-sm">-</span>
                    )}
                  </td>

                  {/* الرقم الجامعي */}
                  <td className="px-4 py-4 whitespace-nowrap text-right">
                    {editingUniIdStudent === student.id ? (
                      <div className="flex items-center gap-1">
                        <input
                          type="text"
                          value={editUniversityId}
                          onChange={e => setEditUniversityId(e.target.value.replace(/\D/g, ''))}
                          className="w-32 px-2 py-1 border border-blue-400 rounded text-sm font-mono text-center"
                          autoFocus
                          onKeyDown={e => {
                            if (e.key === 'Enter') saveEditUniId();
                            if (e.key === 'Escape') cancelEditUniId();
                          }}
                        />
                        <button
                          onClick={saveEditUniId}
                          className="px-2 py-1 bg-green-500 hover:bg-green-600 text-white rounded text-xs"
                          title="حفظ"
                        >
                          ✓
                        </button>
                        <button
                          onClick={cancelEditUniId}
                          className="px-2 py-1 bg-gray-400 hover:bg-gray-500 text-white rounded text-xs"
                          title="إلغاء"
                        >
                          ×
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        {student.universityId ? (
                          <span className="inline-block px-2 py-1 bg-blue-50 text-blue-700 text-sm font-mono rounded border border-blue-200">
                            {student.universityId}
                          </span>
                        ) : (
                          <span className="text-gray-400 text-xs italic">غير مضاف</span>
                        )}
                        {onUpdateStudent && (
                          <button
                            onClick={() => startEditUniId(student)}
                            className="text-blue-500 hover:text-blue-700 text-xs"
                            title="تعديل الرقم الجامعي"
                          >
                            ✏️
                          </button>
                        )}
                      </div>
                    )}
                  </td>

                  {/* رمز QR */}
                  <td className="px-4 py-4 whitespace-nowrap text-right">
                    {editingQrStudent === student.id ? (
                      <div className="flex items-center gap-1">
                        <input
                          type="text"
                          value={editQrCodeId}
                          onChange={e => setEditQrCodeId(e.target.value)}
                          className="w-40 px-2 py-1 border border-emerald-400 rounded text-xs font-mono text-center"
                          dir="ltr"
                          placeholder="QR ID أو رابط"
                          autoFocus
                          onKeyDown={e => {
                            if (e.key === 'Enter') saveEditQr();
                            if (e.key === 'Escape') cancelEditQr();
                          }}
                        />
                        <button
                          onClick={saveEditQr}
                          className="px-2 py-1 bg-green-500 hover:bg-green-600 text-white rounded text-xs"
                          title="حفظ"
                        >
                          ✓
                        </button>
                        <button
                          onClick={cancelEditQr}
                          className="px-2 py-1 bg-gray-400 hover:bg-gray-500 text-white rounded text-xs"
                          title="إلغاء"
                        >
                          ×
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        {student.qrCodeId ? (
                          <span
                            className="inline-block px-2 py-1 bg-emerald-50 text-emerald-700 text-xs font-mono rounded border border-emerald-200 max-w-[140px] truncate"
                            dir="ltr"
                            title={student.qrCodeId}
                          >
                            {student.qrCodeId}
                          </span>
                        ) : (
                          <span className="text-gray-400 text-xs italic">غير مربوط</span>
                        )}
                        {onUpdateStudent && (
                          <>
                            <button
                              onClick={() => startEditQr(student)}
                              className="text-emerald-600 hover:text-emerald-800 text-xs"
                              title="تعديل رمز QR"
                            >
                              ✏️
                            </button>
                            {student.qrCodeId && (
                              <button
                                onClick={() => removeQrLink(student)}
                                className="text-red-500 hover:text-red-700 text-xs"
                                title="فك ربط QR"
                              >
                                🔓
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </td>

                  <td className="px-4 py-4 whitespace-nowrap text-right">
                    <button
                      onClick={() => {
                        if (window.confirm(`هل أنت متأكد من حذف الطالب ${student.name}؟`)) {
                          onDeleteStudent(student.id);
                        }
                      }}
                      className="text-red-600 hover:text-red-900 font-medium"
                    >
                      حذف
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {students.length > 0 && (
        <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-md">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-blue-800">
            <span>📊 <strong>إجمالي:</strong> {students.length}</span>
            <span>🔳 <strong>مربوط QR:</strong> {studentsWithQr}</span>
            {studentsWithoutQr > 0 && (
              <span className="text-emerald-700">⏳ <strong>بانتظار الربط:</strong> {studentsWithoutQr}</span>
            )}
            <span>🪪 <strong>مع رقم جامعي:</strong> {studentsWithUniId}</span>
            {studentsWithoutUniId > 0 && (
              <span className="text-yellow-700">⚠️ <strong>بدون رقم:</strong> {studentsWithoutUniId}</span>
            )}
            {selectedIds.size > 0 && (
              <span>| <strong>المحدد:</strong> {selectedIds.size}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};