import React, { useState, useRef } from 'react';
import { Student } from '../types/student';
import * as XLSX from 'xlsx';

interface StudentManagerProps {
  students: Student[];
  onAddStudent: (student: Student) => void;
  onDeleteStudent: (id: string) => void;
  onDeleteSelectedStudents: (ids: string[]) => void;
  onSortByName?: () => void;      // ✅ جديد
  onSortByGroup?: () => void;     // ✅ جديد
}

export const StudentManager: React.FC<StudentManagerProps> = ({
  students,
  onAddStudent,
  onDeleteStudent,
  onDeleteSelectedStudents,
  onSortByName,
  onSortByGroup,
}) => {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [selectedPrefix, setSelectedPrefix] = useState<number>(1);
  const [importLoading, setImportLoading] = useState(false);
  const [importMessage, setImportMessage] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
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

    const newStudent: Student = {
      id: Date.now().toString(),
      name: name.trim(),
      code,
      createdAt: new Date().toISOString(),
    };

    onAddStudent(newStudent);
    setName('');
    setCode('');
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

      const parsed: { name: string; group: string }[] = [];

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.length === 0) continue;

        let studentName = '';
        let studentGroup = '';

        for (const cell of row) {
          if (cell === null || cell === undefined) continue;
          const cellStr = String(cell).trim();
          if (!cellStr) continue;

          if (/^[A-Za-z]\d+$/.test(cellStr)) {
            studentGroup = cellStr.toUpperCase();
          } else if (/[\u0600-\u06FF]/.test(cellStr) && cellStr.length > 2) {
            if (
              !cellStr.includes('الاسم') &&
              !cellStr.includes('الكروب') &&
              !cellStr.includes('المرحلة') &&
              !cellStr.includes('العملي')
            ) {
              studentName = cellStr;
            }
          }
        }

        if (studentName && studentGroup) {
          parsed.push({ name: studentName, group: studentGroup });
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
      let currentCode = startCode;
      let addedCount = 0;
      let skippedCount = 0;

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

        const newStudent: Student = {
          id: `${Date.now()}_${addedCount}`,
          name: student.name,
          code: String(currentCode),
          group: student.group,
          createdAt: new Date().toISOString(),
        };

        onAddStudent(newStudent);
        existingCodes.add(String(currentCode));
        currentCode++;
        addedCount++;
      }

      setImportMessage(
        `✅ تمت إضافة ${addedCount} طالب بنجاح${
          skippedCount > 0 ? ` (تم تجاهل ${skippedCount} طالب مكرر)` : ''
        }`
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
    if (selectedIds.size === students.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(students.map(s => s.id)));
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

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <h2 className="text-2xl font-bold mb-4 text-gray-800">إدارة الطلاب</h2>

      <form onSubmit={handleSubmit} className="mb-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              اسم الطالب
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
              رمز الطالب (4 أرقام)
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
            <p className="text-xs text-gray-500 mt-1 text-center">
              من 1000 إلى 9999
            </p>
          </div>

          <div className="flex items-end">
            <button
              type="submit"
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-md transition duration-200"
            >
              إضافة طالب
            </button>
          </div>
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
        <p className="text-sm text-gray-600 mb-4">
          اختر بادئة الكود (الرقم الأول) ثم ارفع الملف. سيتم ترتيب الطلاب حسب الكروب والاسم تلقائياً.
        </p>

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
            🔢 الأكواد ستبدأ من: <strong>{selectedPrefix}001</strong> ثم {selectedPrefix}002, {selectedPrefix}003...
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
            className={`flex-1 text-center cursor-pointer bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-medium py-3 px-6 rounded-md transition duration: 200 shadow-md ${
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

      {/* ✅ أزرار الترتيب الجديدة */}
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
                className="flex-1 min-w-[200px] px-4 py-2 bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-700 hover:to-purple-800 text-white font-medium rounded-md transition duration-200 shadow-md flex items-center justify-center gap-2"
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
                className="flex-1 min-w-[200px] px-4 py-2 bg-gradient-to-r from-pink-600 to-pink-700 hover:from-pink-700 hover:to-pink-800 text-white font-medium rounded-md transition duration-200 shadow-md flex items-center justify-center gap-2"
              >
                👥 ترتيب حسب الكروب + الاسم
              </button>
            )}
          </div>
        </div>
      )}

      {/* شريط الحذف الجماعي */}
      {selectedIds.size > 0 && (
        <div className="mb-4 p-4 bg-gradient-to-r from-orange-50 to-red-50 border-2 border-orange-300 rounded-lg flex items-center justify-between flex-wrap gap-3">
          <div className="text-orange-800 font-medium">
            ✅ تم تحديد <strong>{selectedIds.size}</strong> من {students.length} طالب
            {selectedIds.size === students.length && (
              <span className="mr-2 text-red-700 font-bold">(الكل)</span>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setSelectedIds(new Set())}
              className="px-4 py-2 bg-gray-500 hover:bg-gray-600 text-white font-medium rounded-md transition duration-200"
            >
              إلغاء التحديد
            </button>
            <button
              onClick={handleDeleteSelected}
              className="px-4 py-2 bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800 text-white font-medium rounded-md transition duration-200 shadow-md flex items-center gap-2"
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
                {students.length > 0 && (
                  <input
                    type="checkbox"
                    checked={selectedIds.size === students.length && students.length > 0}
                    onChange={toggleSelectAll}
                    className="w-5 h-5 cursor-pointer accent-blue-600"
                    title="تحديد الكل"
                  />
                )}
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">الرمز</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">الاسم</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">الكروب</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">إجراءات</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {students.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-6 py-8 text-center text-gray-500">
                  <div className="flex flex-col items-center gap-2">
                    <p className="font-medium">لا توجد طلاب مسجلين</p>
                    <p className="text-sm">ابدأ بإضافة الطلاب باستخدام النموذج أعلاه أو ارفع ملف Excel</p>
                  </div>
                </td>
              </tr>
            ) : (
              students.map((student) => (
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
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="text-lg font-bold text-blue-600">{student.code}</span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right">{student.name}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-right">
                    {student.group ? (
                      <span className="inline-block px-3 py-1 bg-indigo-100 text-indigo-800 text-sm font-medium rounded-full">
                        {student.group}
                      </span>
                    ) : (
                      <span className="text-gray-400 text-sm">-</span>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right">
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
          <p className="text-sm text-blue-800">
            📊 <strong>إجمالي الطلاب:</strong> {students.length} طالب
            {selectedIds.size > 0 && (
              <span className="mr-3">
                | <strong>المحدد:</strong> {selectedIds.size}
              </span>
            )}
          </p>
        </div>
      )}
    </div>
  );
};