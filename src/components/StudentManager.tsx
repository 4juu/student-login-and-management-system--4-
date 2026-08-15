import React, { useState, useRef, useMemo, useCallback, lazy, Suspense } from 'react';
import { Student } from '../types/student';
import {
  compressFaceDescriptor,
  detectDescriptorFormat,
  getCompressionStats,
  hasFaceDescriptor,
} from '../services/faceCompression';
import { Camera, CaseSensitive, ChartColumn, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, CircleCheck, ClipboardList, FileArchive, FolderOpen, Hash, IdCard, Lightbulb, LoaderCircle, Pencil, Plus, QrCode, RefreshCw, Smile, SquarePen, Trash2, TriangleAlert, Unlink, Upload, Users, Zap } from 'lucide-react';

// 🚀 نافذة تسجيل الوجه تُحمَّل عند فتحها فقط (مكتبة الوجوه ثقيلة)
const LazyFaceRegister = lazy(() =>
  import('./FaceRegister').then(m => ({ default: m.FaceRegister }))
);

interface StudentManagerProps {
  students: Student[];
  onAddStudent: (student: Student) => void;
  onAddMultipleStudents?: (students: Student[]) => void;
  onUpdateStudent?: (id: string, updates: Partial<Student>) => void;
  onDeleteStudent: (id: string) => void;
  onDeleteSelectedStudents: (ids: string[]) => void;
  onSortByName?: () => void;
  onSortByGroup?: () => void;
  onOpenProfile?: (student: Student) => void;
}

const extractQrCodeId = (raw: string): string => {
  const text = raw.trim();
  if (!text) return '';

  try {
    const url = new URL(text);
    const id = url.searchParams.get('id');
    if (id) return id.trim();
  } catch {
    // ليس رابط
  }

  return text;
};

const PAGE_SIZE_OPTIONS = [25, 50, 100, 200];
const DEFAULT_PAGE_SIZE = 50;

export const StudentManager: React.FC<StudentManagerProps> = ({
  students,
  onAddStudent,
  onAddMultipleStudents,
  onUpdateStudent,
  onDeleteStudent,
  onDeleteSelectedStudents,
  onSortByName,
  onSortByGroup,
  onOpenProfile,
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

  const [editingUniIdStudent, setEditingUniIdStudent] = useState<string | null>(null);
  const [editUniversityId, setEditUniversityId] = useState('');

  const [editingQrStudent, setEditingQrStudent] = useState<string | null>(null);
  const [editQrCodeId, setEditQrCodeId] = useState('');

  const [transferStudentId, setTransferStudentId] = useState<string | null>(null);
  const [transferGroupValue, setTransferGroupValue] = useState('');

  const [showFaceRegister, setShowFaceRegister] = useState(false);
  const [compressing, setCompressing] = useState(false);
  const [compressionProgress, setCompressionProgress] = useState({ current: 0, total: 0 });

  const [searchQuery, setSearchQuery] = useState('');
  const [groupFilter, setGroupFilter] = useState<string>('all');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

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

    if (universityId.trim() && students.some(s => s.universityId === universityId.trim())) {
      setError('هذا الرقم الجامعي مستخدم بالفعل');
      return;
    }

    const cleanQrCode = qrCodeId.trim() ? extractQrCodeId(qrCodeId) : '';

    if (cleanQrCode && students.some(s => s.qrCodeId === cleanQrCode)) {
      setError('رمز QR هذا مستخدم لطالب آخر بالفعل');
      return;
    }

    const newStudent: Student = {
      id: Date.now().toString(),
      name: name.trim(),
      code,
      createdAt: new Date().toISOString(),
      ...(group.trim() ? { group: group.trim() } : {}),
      ...(universityId.trim() ? { universityId: universityId.trim() } : {}),
      ...(cleanQrCode ? { qrCodeId: cleanQrCode } : {}),
    };

    onAddStudent(newStudent);
    setName('');
    setCode('');
    setUniversityId('');
    setQrCodeId('');
    setGroup('');
  };

  const sortGroups = useCallback((a: string, b: string): number => {
    const letterA = a.charAt(0).toUpperCase();
    const letterB = b.charAt(0).toUpperCase();
    if (letterA !== letterB) return letterA.localeCompare(letterB);
    const numA = parseInt(a.slice(1)) || 0;
    const numB = parseInt(b.slice(1)) || 0;
    return numA - numB;
  }, []);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImportLoading(true);
    setImportMessage('');
    setError('');

    try {
      const data = await file.arrayBuffer();
      const XLSX = await import('xlsx');
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

          if (cellStr.includes('http') && cellStr.includes('id=')) {
            const extracted = extractQrCodeId(cellStr);
            if (extracted && extracted !== cellStr) {
              studentQrCode = extracted;
              continue;
            }
          }

          if (/^[A-Za-z]\d+$/.test(cellStr)) {
            studentGroup = cellStr.toUpperCase();
          }
          else if (/^\d{8,15}$/.test(cellStr)) {
            studentUniId = cellStr;
          }
          else if (
            /^[A-Za-z0-9_-]{10,40}$/.test(cellStr) &&
            /[A-Za-z]/.test(cellStr) &&
            !studentQrCode
          ) {
            studentQrCode = cellStr;
          }
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
            ...(studentUniId ? { universityId: studentUniId } : {}),
            ...(studentQrCode ? { qrCodeId: studentQrCode } : {}),
          });
        }
      }

      if (parsed.length === 0) {
        setError('لم يتم العثور على طلاب في الملف. تأكد من تنسيق الملف.');
        setImportLoading(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
        return;
      }

      if (parsed.length > 50) {
        const confirmed = window.confirm(
          `تم العثور على ${parsed.length} طالب في الملف.\n\nهل تريد المتابعة بالاستيراد؟`
        );
        if (!confirmed) {
          setImportLoading(false);
          if (fileInputRef.current) fileInputRef.current.value = '';
          return;
        }
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
      const existingNames = new Set(students.map(s => s.name));

      let currentCode = startCode;
      let addedCount = 0;
      let skippedCount = 0;
      let qrLinkedCount = 0;

      const newStudentsBatch: Student[] = [];

      for (const student of parsed) {
        if (existingNames.has(student.name)) {
          skippedCount++;
          continue;
        }

        while (existingCodes.has(String(currentCode)) && currentCode <= 9999) {
          currentCode++;
        }

        if (currentCode > 9999) {
          setError('تم تجاوز الحد الأقصى للأكواد (9999)');
          break;
        }

        const uniId = student.universityId && !existingUniIds.has(student.universityId)
          ? student.universityId
          : undefined;
        if (uniId) existingUniIds.add(uniId);

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
          createdAt: new Date().toISOString(),
          ...(uniId ? { universityId: uniId } : {}),
          ...(qrCode ? { qrCodeId: qrCode } : {}),
        };

        newStudentsBatch.push(newStudent);
        existingCodes.add(String(currentCode));
        existingNames.add(student.name);
        currentCode++;
        addedCount++;
      }

      if (newStudentsBatch.length > 0) {
        if (onAddMultipleStudents) {
          onAddMultipleStudents(newStudentsBatch);
        } else {
          for (const student of newStudentsBatch) {
            onAddStudent(student);
          }
        }
      }

      setImportMessage(
        `تمت إضافة ${addedCount} طالب بنجاح` +
        (qrLinkedCount > 0 ? ` (${qrLinkedCount} مربوط برمز QR)` : '') +
        (skippedCount > 0 ? ` (تم تجاهل ${skippedCount} طالب مكرر)` : '')
      );
    } catch (err) {
      console.error(err);
      setError('حدث خطأ أثناء قراءة الملف. تأكد من نوع الملف (xlsx, xls, csv).');
    } finally {
      setImportLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const toggleSelectStudent = useCallback((id: string) => {
    setSelectedIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) newSet.delete(id);
      else newSet.add(id);
      return newSet;
    });
  }, []);

  const toggleSelectAllInPage = () => {
    const pageIds = paginatedStudents.map(s => s.id);
    const allSelected = pageIds.every(id => selectedIds.has(id));
    setSelectedIds(prev => {
      const newSet = new Set(prev);
      if (allSelected) {
        pageIds.forEach(id => newSet.delete(id));
      } else {
        pageIds.forEach(id => newSet.add(id));
      }
      return newSet;
    });
  };

  const toggleSelectAllFiltered = () => {
    const allFilteredIds = filteredStudents.map(s => s.id);
    const allSelected = allFilteredIds.every(id => selectedIds.has(id));
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(allFilteredIds));
    }
  };

  const handleDeleteSelected = () => {
    if (selectedIds.size === 0) return;

    const isAll = selectedIds.size === students.length;
    const message = isAll
      ? `سيتم حذف جميع الطلاب (${students.length})!\nهل أنت متأكد؟`
      : `هل أنت متأكد من حذف ${selectedIds.size} طالب؟`;

    if (!window.confirm(message)) return;

    onDeleteSelectedStudents(Array.from(selectedIds));
    setSelectedIds(new Set());
  };

  const startEditUniId = (student: Student) => {
    setEditingUniIdStudent(student.id);
    setEditUniversityId(student.universityId || '');
  };

  const saveEditUniId = () => {
    if (!editingUniIdStudent || !onUpdateStudent) return;

    const trimmedId = editUniversityId.trim();

    if (trimmedId && students.some(s => s.id !== editingUniIdStudent && s.universityId === trimmedId)) {
      alert('هذا الرقم الجامعي مستخدم لطالب آخر');
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

  const startEditQr = (student: Student) => {
    setEditingQrStudent(student.id);
    setEditQrCodeId(student.qrCodeId || '');
  };

  const saveEditQr = () => {
    if (!editingQrStudent || !onUpdateStudent) return;

    const cleanQr = editQrCodeId.trim() ? extractQrCodeId(editQrCodeId) : '';

    if (cleanQr && students.some(s => s.id !== editingQrStudent && s.qrCodeId === cleanQr)) {
      alert('رمز QR هذا مستخدم لطالب آخر');
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

  const removeFaceData = (student: Student) => {
    if (!onUpdateStudent) return;
    if (!window.confirm(`هل تريد حذف بصمة الوجه من ${student.name}؟`)) return;
    onUpdateStudent(student.id, { faceDescriptor: undefined, faceRegisteredAt: undefined });
  };

  /* 🆕 ضغط كل البصمات غير المضغوطة */
  const handleCompressAll = async () => {
    if (!onUpdateStudent) return;

    const uncompressedStudents = students.filter(s => {
      if (!s.faceDescriptor) return false;
      const format = detectDescriptorFormat(s.faceDescriptor);
      return format === 'normal';
    });

    if (uncompressedStudents.length === 0) {
      alert('كل البصمات مضغوطة بالفعل!');
      return;
    }

    const stats = getCompressionStats(students);

    if (!window.confirm(
      `سيتم ضغط ${uncompressedStudents.length} بصمة\n\n` +
      `توفير متوقع: ~${stats.potentialSavingsKB.toFixed(1)} KB\n` +
      `الدقة: لن تتأثر (أقل من 1%)\n\n` +
      `هل تريد المتابعة؟`
    )) return;

    setCompressing(true);
    setCompressionProgress({ current: 0, total: uncompressedStudents.length });

    try {
      let count = 0;
      for (const student of uncompressedStudents) {
        if (!student.faceDescriptor) continue;

        const compressed = compressFaceDescriptor(student.faceDescriptor);
        onUpdateStudent(student.id, {
          faceDescriptor: compressed,
          faceCompressed: true,
        });

        count++;
        setCompressionProgress({ current: count, total: uncompressedStudents.length });

        if (count % 10 === 0) {
          await new Promise(r => setTimeout(r, 50));
        }
      }

      alert(`تم ضغط ${count} بصمة بنجاح!\nتم توفير ~${stats.potentialSavingsKB.toFixed(1)} KB`);
    } catch (e) {
      console.error(e);
      alert('حدث خطأ أثناء الضغط');
    } finally {
      setCompressing(false);
      setCompressionProgress({ current: 0, total: 0 });
    }
  };

  const uniqueGroups = useMemo(() => {
    const groups = Array.from(new Set(students.map(s => s.group).filter(Boolean))) as string[];
    groups.sort(sortGroups);
    return groups;
  }, [students, sortGroups]);

  const filteredStudents = useMemo(() => {
    return students.filter(s => {
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchSearch = (
          s.name.toLowerCase().includes(q) ||
          s.code.toLowerCase().includes(q) ||
          (s.group && s.group.toLowerCase().includes(q)) ||
          (s.universityId && s.universityId.toLowerCase().includes(q)) ||
          (s.qrCodeId && s.qrCodeId.toLowerCase().includes(q))
        );
        if (!matchSearch) return false;
      }

      if (groupFilter !== 'all' && s.group !== groupFilter) return false;

      return true;
    });
  }, [students, searchQuery, groupFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredStudents.length / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);

  const paginatedStudents = useMemo(() => {
    const start = (safeCurrentPage - 1) * pageSize;
    return filteredStudents.slice(start, start + pageSize);
  }, [filteredStudents, safeCurrentPage, pageSize]);

  React.useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, groupFilter, pageSize]);

  const studentsWithUniId = students.filter(s => s.universityId).length;
  const studentsWithoutUniId = students.length - studentsWithUniId;
  const studentsWithQr = students.filter(s => s.qrCodeId).length;
  const studentsWithoutQr = students.length - studentsWithQr;

  // ✅ التعديل المهم: استخدام hasFaceDescriptor
  const studentsWithFace = students.filter(s => hasFaceDescriptor(s.faceDescriptor)).length;
  const studentsWithoutFace = students.length - studentsWithFace;

  const compressionStats = useMemo(() => getCompressionStats(students), [students]);

  const pageIds = paginatedStudents.map(s => s.id);
  const allInPageSelected = pageIds.length > 0 && pageIds.every(id => selectedIds.has(id));

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-bold text-gray-800">إدارة الطلاب</h2>
      </div>

      {students.length > 0 && studentsWithoutQr > 0 && (
        <div className="mb-3 p-3 bg-emerald-50 border border-emerald-300 rounded-lg flex items-center gap-3">
          <QrCode className="w-7 h-7 text-emerald-600" />
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

      {students.length > 0 && studentsWithoutUniId > 0 && (
        <div className="mb-4 p-3 bg-yellow-50 border border-yellow-300 rounded-lg flex items-center gap-3">
          <TriangleAlert className="w-7 h-7 text-yellow-600" />
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
              <IdCard className="w-4 h-4" /> الرقم الجامعي
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

        <div className="mt-4 p-4 bg-gradient-to-br from-emerald-50 to-teal-50 border-2 border-emerald-200 rounded-lg">
          <label className="block text-sm font-bold text-emerald-800 mb-2 flex items-center gap-2">
            <QrCode className="w-5 h-5 text-emerald-800" />
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
            <Lightbulb className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              يمكنك لصق <strong>الرابط الكامل</strong> من هوية الوزارة وسيتم استخراج الرمز تلقائياً،
              أو تركه فارغاً ليتم الربط تلقائياً عند أول مسح للهوية.
            </span>
          </p>
        </div>

        <div className="mt-4 flex justify-end">
          <button
            type="submit"
            className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-8 rounded-md transition duration-200 flex items-center gap-2"
          >
            <Plus className="w-4 h-4" /> إضافة طالب
          </button>
        </div>

        {error && (
          <div className="mt-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded-md" dir="rtl">
            {error}
          </div>
        )}
      </form>

      <div className="mb-6 p-5 bg-gradient-to-br from-blue-50 to-indigo-50 border-2 border-blue-200 rounded-lg">
        <h3 className="text-lg font-bold text-gray-800 mb-3 flex items-center gap-2">
          <FolderOpen className="w-5 h-5 text-blue-600" /> استيراد الطلاب من ملف Excel
        </h3>
        <div className="mb-4 text-sm text-gray-600 space-y-1">
          <p>اختر بادئة الكود ثم ارفع الملف. سيتم اكتشاف الحقول التالية تلقائياً:</p>
          <div className="flex flex-wrap gap-2 mt-2">
            <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs font-medium inline-flex items-center gap-1"><SquarePen className="w-3 h-3" /> الاسم</span>
            <span className="px-2 py-1 bg-indigo-100 text-indigo-800 rounded text-xs font-medium inline-flex items-center gap-1"><Users className="w-3 h-3" /> الكروب (A1, B2, ...)</span>
            <span className="px-2 py-1 bg-purple-100 text-purple-800 rounded text-xs font-medium inline-flex items-center gap-1"><IdCard className="w-3 h-3" /> الرقم الجامعي (8-15 رقم)</span>
            <span className="px-2 py-1 bg-emerald-100 text-emerald-800 rounded text-xs font-medium inline-flex items-center gap-1"><QrCode className="w-3 h-3" /> رمز QR (رابط الوزارة الكامل)</span>
          </div>
          <p className="text-xs text-emerald-700 mt-2 bg-emerald-50 p-2 rounded border border-emerald-200 flex items-start gap-1">
            <Lightbulb className="w-4 h-4 shrink-0 mt-0.5" /> <strong>نصيحة:</strong> الصق الرابط الكامل من هوية الوزارة بأي عمود، وسيتم استخراج رمز QR تلقائياً لكل طالب.
          </p>
        </div>

        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">اختر بادئة الكود:</label>
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
          <p className="text-xs text-gray-500 mt-2 flex items-center gap-1">
            <Hash className="w-3.5 h-3.5" /> الأكواد ستبدأ من: <strong>{selectedPrefix}001</strong>
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
            className={`flex-1 cursor-pointer bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-medium py-3 px-6 rounded-md transition duration-200 shadow-md flex items-center justify-center gap-2 ${
              importLoading ? 'opacity-50 cursor-not-allowed' : ''
            }`}
          >
            {importLoading ? <><LoaderCircle className="w-4 h-4 animate-spin" /> جاري المعالجة...</> : <><Upload className="w-4 h-4" /> رفع ملف Excel</>}
          </label>
        </div>

        {importMessage && (
          <div className="mt-4 p-3 bg-green-100 border border-green-400 text-green-800 rounded-md" dir="rtl">
            {importMessage}
          </div>
        )}
      </div>

      {/* ═══════════ بصمات الوجه ═══════════ */}
      {students.length > 0 && onUpdateStudent && (
        <div className="mb-6 p-5 bg-gradient-to-br from-purple-50 to-pink-50 border-2 border-purple-200 rounded-lg">
          <h3 className="text-lg font-bold text-purple-900 mb-2 flex items-center gap-2">
            <Smile className="w-5 h-5 text-purple-600" /> بصمات الوجه
            <span className="text-xs font-normal bg-purple-200 text-purple-800 px-2 py-0.5 rounded-full inline-flex items-center gap-1">
              جديد <Zap className="w-3 h-3" />
            </span>
          </h3>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
            <div className="bg-white rounded-lg p-2 text-center border border-purple-200">
              <div className="text-2xl font-bold text-purple-600">{studentsWithFace}</div>
              <div className="text-xs text-purple-700">مسجّلين</div>
            </div>
            <div className="bg-white rounded-lg p-2 text-center border border-purple-200">
              <div className="text-2xl font-bold text-gray-400">{studentsWithoutFace}</div>
              <div className="text-xs text-gray-600">بدون بصمة</div>
            </div>
            <div className="bg-white rounded-lg p-2 text-center border border-purple-200">
              <div className="text-2xl font-bold text-pink-600">
                {students.length > 0 ? Math.round((studentsWithFace / students.length) * 100) : 0}%
              </div>
              <div className="text-xs text-pink-700">نسبة الإكمال</div>
            </div>
            <div className="bg-white rounded-lg p-2 text-center border border-emerald-200">
              <div className="text-2xl font-bold text-emerald-600">
                {compressionStats.totalSizeKB < 1024
                  ? `${compressionStats.totalSizeKB.toFixed(1)}`
                  : `${(compressionStats.totalSizeKB / 1024).toFixed(2)}`
                }
              </div>
              <div className="text-xs text-emerald-700">
                {compressionStats.totalSizeKB < 1024 ? 'KB' : 'MB'} إجمالي
              </div>
            </div>
          </div>

          {studentsWithFace > 0 && (
            <div className="bg-white rounded-lg p-3 mb-3 border-2 border-purple-200 shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-bold text-gray-800 flex items-center gap-1">
                  <FileArchive className="w-4 h-4 text-purple-600" /> حالة الضغط
                </h4>
                {compressionStats.uncompressedCount > 0 && (
                  <button
                    onClick={handleCompressAll}
                    disabled={compressing}
                    className="px-3 py-1.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 disabled:opacity-50 text-white text-xs font-bold rounded-md transition shadow-sm"
                  >
                    {compressing
                      ? <><LoaderCircle className="w-4 h-4 animate-spin" /> {compressionProgress.current}/{compressionProgress.total}</>
                      : <><FileArchive className="w-4 h-4" /> ضغط {compressionStats.uncompressedCount} بصمة</>
                    }
                  </button>
                )}
              </div>

              {compressing && (
                <div className="mb-2">
                  <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                    <div
                      className="bg-gradient-to-r from-emerald-500 to-teal-500 h-2 transition-all duration-200"
                      style={{ width: `${(compressionProgress.current / compressionProgress.total) * 100}%` }}
                    />
                  </div>
                  <p className="text-xs text-gray-500 text-center mt-1">
                    جاري الضغط: {compressionProgress.current} من {compressionProgress.total}
                  </p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="flex items-center gap-2 bg-emerald-50 p-2 rounded border border-emerald-200">
                  <span className="text-emerald-600 text-xl">✓</span>
                  <div className="flex-1">
                    <div className="font-bold text-emerald-800 text-lg leading-none">
                      {compressionStats.compressedCount}
                    </div>
                    <div className="text-emerald-600 text-[10px]">مضغوطة</div>
                  </div>
                </div>
                <div className="flex items-center gap-2 bg-amber-50 p-2 rounded border border-amber-200">
                  <TriangleAlert className="w-6 h-6 text-amber-600" />
                  <div className="flex-1">
                    <div className="font-bold text-amber-800 text-lg leading-none">
                      {compressionStats.uncompressedCount}
                    </div>
                    <div className="text-amber-600 text-[10px]">غير مضغوطة</div>
                  </div>
                </div>
              </div>

              {compressionStats.uncompressedCount > 0 && (
                <div className="mt-2 text-[11px] text-gray-700 bg-gradient-to-r from-amber-50 to-yellow-50 p-2 rounded border border-amber-200 flex items-start gap-1">
                  <Lightbulb className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-500" /> يمكنك توفير <strong className="text-emerald-700">~{compressionStats.potentialSavingsKB.toFixed(1)} KB</strong> بضغط البصمات غير المضغوطة. <strong>الضغط آمن</strong> ولا يؤثر على دقة التعرف (أقل من 1%).
                </div>
              )}


            </div>
          )}

          <p className="text-xs text-purple-700 mb-3 bg-white/60 p-2 rounded flex items-start gap-1">
            <Lightbulb className="w-4 h-4 shrink-0 mt-0.5" /> <strong>كيف يعمل؟</strong> سجّل بصمة وجه كل طالب مرة واحدة (يأخذ ثانيتين فقط)، ثم يستطيع الطلاب تسجيل حضورهم بمجرد المرور قبال الكاميرا تلقائياً، بدون باركود أو كود يدوي.
          </p>

          <button
            onClick={() => setShowFaceRegister(true)}
            className="w-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white font-bold py-3 px-6 rounded-md shadow-md transition duration-200 transform active:scale-95 flex items-center justify-center gap-2"
          >
            <Camera className="w-5 h-5" /> فتح أداة التسجيل الجماعي السريع
          </button>
        </div>
      )}

      {students.length > 1 && (onSortByName || onSortByGroup) && (
        <div className="mb-4 p-4 bg-gradient-to-r from-purple-50 to-pink-50 border-2 border-purple-200 rounded-lg">
          <h3 className="text-sm font-bold text-purple-800 mb-3 flex items-center gap-2">
            <RefreshCw className="w-4 h-4 text-purple-700" /> إعادة ترتيب الطلاب
          </h3>
          <div className="flex flex-wrap gap-2">
            {onSortByName && (
              <button
                onClick={() => {
                  if (window.confirm('هل تريد ترتيب الطلاب أبجدياً حسب الأسماء؟')) {
                    onSortByName();
                  }
                }}
                className="flex-1 min-w-[140px] sm:min-w-[200px] px-4 py-2 bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-700 hover:to-purple-800 text-white font-medium rounded-md transition duration-200 shadow-md flex items-center justify-center gap-2"
              >
                <CaseSensitive className="w-4 h-4" /> ترتيب أبجدي حسب الاسم
              </button>
            )}
            {onSortByGroup && (
              <button
                onClick={() => {
                  if (window.confirm('هل تريد ترتيب الطلاب حسب الكروب ثم الاسم؟')) {
                    onSortByGroup();
                  }
                }}
                className="flex-1 min-w-[140px] sm:min-w-[200px] px-4 py-2 bg-gradient-to-r from-pink-600 to-pink-700 hover:from-pink-700 hover:to-pink-800 text-white font-medium rounded-md transition duration-200 shadow-md flex items-center justify-center gap-2"
              >
                <Users className="w-4 h-4" /> ترتيب حسب الكروب + الاسم
              </button>
            )}
          </div>
        </div>
      )}

      {students.length > 0 && (
        <div className="mb-4 grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="md:col-span-2 relative">
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="بحث بالاسم أو الكود أو الكروب أو الرقم الجامعي..."
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

          {uniqueGroups.length > 0 && (
            <select
              value={groupFilter}
              onChange={e => setGroupFilter(e.target.value)}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">جميع الكروبات</option>
              {uniqueGroups.map(g => (
                <option key={g} value={g}>
                  {g} ({students.filter(s => s.group === g).length})
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {(searchQuery || groupFilter !== 'all') && (
        <p className="text-xs text-gray-500 mb-3 flex items-center gap-1">
          <ChartColumn className="w-3.5 h-3.5 text-gray-400" /> نتائج: <strong>{filteredStudents.length}</strong> من {students.length}
        </p>
      )}

      {selectedIds.size > 0 && (
        <div className="mb-4 p-4 bg-gradient-to-r from-orange-50 to-red-50 border-2 border-orange-300 rounded-lg flex items-center justify-between flex-wrap gap-3">
          <div className="text-orange-800 font-medium flex items-center gap-1">
            <CircleCheck className="w-4 h-4" /> تم تحديد <strong>{selectedIds.size}</strong> من {students.length} طالب
          </div>
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => setSelectedIds(new Set())}
              className="px-4 py-2 bg-gray-500 hover:bg-gray-600 text-white font-medium rounded-md transition"
            >
              إلغاء التحديد
            </button>
            {filteredStudents.length > pageSize && (
              <button
                onClick={toggleSelectAllFiltered}
                className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white font-medium rounded-md transition"
                title="تحديد جميع نتائج البحث"
              >
                تحديد كل النتائج ({filteredStudents.length})
              </button>
            )}
            <button
              onClick={handleDeleteSelected}
              className="px-4 py-2 bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800 text-white font-medium rounded-md transition shadow-md flex items-center gap-2"
            >
              <Trash2 className="w-4 h-4" /> حذف المحدد ({selectedIds.size})
            </button>
          </div>
        </div>
      )}

      {filteredStudents.length > pageSize && (
        <div className="mb-3 p-3 bg-gray-50 border border-gray-200 rounded-lg flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-gray-600">عرض:</span>
            <select
              value={pageSize}
              onChange={e => setPageSize(Number(e.target.value))}
              className="px-3 py-1 border border-gray-300 rounded-md text-sm bg-white"
            >
              {PAGE_SIZE_OPTIONS.map(size => (
                <option key={size} value={size}>{size} طالب</option>
              ))}
            </select>
            <span className="text-gray-600">
              ({((safeCurrentPage - 1) * pageSize) + 1} - {Math.min(safeCurrentPage * pageSize, filteredStudents.length)} من {filteredStudents.length})
            </span>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => setCurrentPage(1)}
              disabled={safeCurrentPage === 1}
              className="px-2 py-1 bg-white border border-gray-300 rounded disabled:opacity-30 hover:bg-gray-100 text-sm"
              title="الصفحة الأولى"
            >
              <ChevronsRight className="w-4 h-4" />
            </button>
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={safeCurrentPage === 1}
              className="px-3 py-1 bg-white border border-gray-300 rounded disabled:opacity-30 hover:bg-gray-100 text-sm flex items-center gap-1"
            >
              <ChevronRight className="w-4 h-4" /> السابق
            </button>
            <span className="px-3 py-1 bg-blue-600 text-white rounded text-sm font-bold">
              {safeCurrentPage} / {totalPages}
            </span>
            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={safeCurrentPage === totalPages}
              className="px-3 py-1 bg-white border border-gray-300 rounded disabled:opacity-30 hover:bg-gray-100 text-sm flex items-center gap-1"
            >
              التالي <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => setCurrentPage(totalPages)}
              disabled={safeCurrentPage === totalPages}
              className="px-2 py-1 bg-white border border-gray-300 rounded disabled:opacity-30 hover:bg-gray-100 text-sm"
              title="الصفحة الأخيرة"
            >
              <ChevronsLeft className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-center">
                {paginatedStudents.length > 0 && (
                  <input
                    type="checkbox"
                    checked={allInPageSelected}
                    onChange={toggleSelectAllInPage}
                    className="w-5 h-5 cursor-pointer accent-blue-600"
                    title="تحديد طلاب الصفحة الحالية"
                  />
                )}
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">#</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">الرمز</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">الاسم</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">الكروب</th>
              <th className="hidden md:table-cell px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider"><span className="inline-flex items-center gap-1"><IdCard className="w-3.5 h-3.5" /> الرقم الجامعي</span></th>
              <th className="hidden sm:table-cell px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider"><span className="inline-flex items-center gap-1"><QrCode className="w-3.5 h-3.5" /> رمز QR</span></th>
              <th className="hidden sm:table-cell px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider"><span className="inline-flex items-center gap-1"><Smile className="w-3.5 h-3.5" /> الوجه</span></th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">إجراءات</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {paginatedStudents.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-6 py-8 text-center text-gray-500">
                  <div className="flex flex-col items-center gap-2">
                    <p className="font-medium">
                      {searchQuery || groupFilter !== 'all' ? 'لا توجد نتائج للبحث' : 'لا توجد طلاب مسجلين'}
                    </p>
                    {!searchQuery && groupFilter === 'all' && (
                      <p className="text-sm">ابدأ بإضافة الطلاب أو ارفع ملف Excel</p>
                    )}
                  </div>
                </td>
              </tr>
            ) : (
              paginatedStudents.map((student, index) => {
                const globalIndex = (safeCurrentPage - 1) * pageSize + index + 1;

                // ✅ التعديل المهم: استخدام hasFaceDescriptor
                const hasFace = hasFaceDescriptor(student.faceDescriptor);
                const faceFormat = hasFace ? detectDescriptorFormat(student.faceDescriptor) : null;
                const isCompressed = faceFormat === 'compressed' || faceFormat === 'base64' || faceFormat === 'multi';

                return (
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
                    <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500">
                      {globalIndex}
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap">
                      <span className="text-lg font-bold text-blue-600">{student.code}</span>
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-right">{student.name}</td>
                    <td className="px-4 py-4 whitespace-nowrap text-right">
                      {transferStudentId === student.id ? (
                        <div className="flex items-center gap-1">
                          <select
                            value={transferGroupValue}
                            onChange={e => {
                              setTransferGroupValue(e.target.value);
                              if (e.target.value !== '__custom__') {
                                // Auto-save on selecting a regular group
                                if (onUpdateStudent) {
                                  onUpdateStudent(student.id, { group: e.target.value || undefined });
                                }
                                setTransferStudentId(null);
                                setTransferGroupValue('');
                              }
                            }}
                            className="px-2 py-1 border border-blue-400 rounded text-sm"
                            autoFocus
                            onKeyDown={e => {
                              if (e.key === 'Escape') { setTransferStudentId(null); setTransferGroupValue(''); }
                            }}
                          >
                            <option value="">بدون كروب</option>
                            {uniqueGroups.filter(g => g !== student.group).map(g => (
                              <option key={g} value={g}>{g}</option>
                            ))}
                            <option value="__custom__">كروب جديد...</option>
                          </select>
                          {transferGroupValue === '__custom__' && (
                            <input
                              type="text"
                              value=""
                              onChange={e => setTransferGroupValue(e.target.value.toUpperCase())}
                              className="w-16 px-2 py-1 border border-blue-400 rounded text-sm text-center"
                              placeholder="A1"
                              autoFocus
                            />
                          )}
                          <button
                            onClick={() => {
                              if (onUpdateStudent) {
                                const val = transferGroupValue === '__custom__' ? '' : transferGroupValue;
                                onUpdateStudent(student.id, { group: val || undefined });
                              }
                              setTransferStudentId(null);
                              setTransferGroupValue('');
                            }}
                            className="px-2 py-1 bg-green-500 hover:bg-green-600 text-white rounded text-xs"
                            title="حفظ"
                          >
                            ✓
                          </button>
                          <button
                            onClick={() => { setTransferStudentId(null); setTransferGroupValue(''); }}
                            className="px-2 py-1 bg-gray-400 hover:bg-gray-500 text-white rounded text-xs"
                            title="إلغاء"
                          >
                            ×
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          {student.group ? (
                            <span className="inline-block px-3 py-1 bg-indigo-100 text-indigo-800 text-sm font-medium rounded-full">
                              {student.group}
                            </span>
                          ) : (
                            <span className="text-gray-400 text-sm">-</span>
                          )}
                          {onUpdateStudent && (
                            <button
                              onClick={() => { setTransferStudentId(student.id); setTransferGroupValue(student.group || ''); }}
                              className="text-blue-500 hover:text-blue-700 text-xs"
                              title="نقل إلى كروب آخر"
                            >
                              <RefreshCw className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      )}
                    </td>

                    <td className="hidden md:table-cell px-4 py-4 whitespace-nowrap text-right">
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
                              <Pencil className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      )}
                    </td>

                    <td className="hidden sm:table-cell px-4 py-4 whitespace-nowrap text-right">
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
                                <Pencil className="w-4 h-4" />
                              </button>
                              {student.qrCodeId && (
                                <button
                                  onClick={() => removeQrLink(student)}
                                  className="text-red-500 hover:text-red-700 text-xs"
                                  title="فك ربط QR"
                                >
                                  <Unlink className="w-4 h-4" />
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </td>

                    <td className="hidden sm:table-cell px-4 py-4 whitespace-nowrap text-center">
                      <div className="flex items-center justify-center gap-1">
                        {hasFace ? (
                          <>
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded border ${
                                isCompressed
                                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                  : 'bg-amber-50 text-amber-700 border-amber-200'
                              }`}
                              title={
                                student.faceRegisteredAt
                                  ? `سُجلت في: ${new Date(student.faceRegisteredAt).toLocaleDateString('ar-EG')}\n${
                                      faceFormat === 'multi' ? 'متعدد الزوايا (Multi)' :
                                      isCompressed ? 'مضغوطة' : 'غير مضغوطة'
                                    }`
                                  : 'مسجّلة'
                              }
                            >
                              {faceFormat === 'multi' ? <CircleCheck className="w-3.5 h-3.5" /> : isCompressed ? <><CircleCheck className="w-3.5 h-3.5" /> <FileArchive className="w-3.5 h-3.5" /></> : <><CircleCheck className="w-3.5 h-3.5" /> <TriangleAlert className="w-3.5 h-3.5" /></>}
                            </span>
                            {onUpdateStudent && (
                              <button
                                onClick={() => removeFaceData(student)}
                                className="text-red-500 hover:text-red-700 text-xs"
                                title="حذف بصمة الوجه"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </>
                        ) : (
                          <span className="text-gray-400 text-xs italic">غير مسجّلة</span>
                        )}
                      </div>
                    </td>

                    <td className="px-4 py-4 whitespace-nowrap text-right">
                      <div className="flex items-center justify-end gap-3">
                        {onOpenProfile && (
                          <button
                            onClick={() => onOpenProfile(student)}
                            className="text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1"
                            title="فتح ملف الطالب الكامل"
                          >
                            الملف <ClipboardList className="w-4 h-4" />
                          </button>
                        )}
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
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {filteredStudents.length > pageSize && (
        <div className="mt-4 p-3 bg-gray-50 border border-gray-200 rounded-lg flex items-center justify-center gap-1 flex-wrap">
          <button
            onClick={() => setCurrentPage(1)}
            disabled={safeCurrentPage === 1}
            className="px-2 py-1 bg-white border border-gray-300 rounded disabled:opacity-30 hover:bg-gray-100 text-sm flex items-center gap-1"
          >
            <ChevronsRight className="w-4 h-4" /> الأولى
          </button>
          <button
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            disabled={safeCurrentPage === 1}
            className="px-3 py-1 bg-white border border-gray-300 rounded disabled:opacity-30 hover:bg-gray-100 text-sm flex items-center gap-1"
          >
            <ChevronRight className="w-4 h-4" /> السابق
          </button>

          {Array.from({ length: Math.min(7, totalPages) }, (_, i) => {
            let pageNum: number;
            if (totalPages <= 7) {
              pageNum = i + 1;
            } else if (safeCurrentPage <= 4) {
              pageNum = i + 1;
            } else if (safeCurrentPage >= totalPages - 3) {
              pageNum = totalPages - 6 + i;
            } else {
              pageNum = safeCurrentPage - 3 + i;
            }
            return (
              <button
                key={pageNum}
                onClick={() => setCurrentPage(pageNum)}
                className={`px-3 py-1 rounded text-sm font-medium ${
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
            className="px-3 py-1 bg-white border border-gray-300 rounded disabled:opacity-30 hover:bg-gray-100 text-sm flex items-center gap-1"
          >
            التالي <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={() => setCurrentPage(totalPages)}
            disabled={safeCurrentPage === totalPages}
            className="px-2 py-1 bg-white border border-gray-300 rounded disabled:opacity-30 hover:bg-gray-100 text-sm flex items-center gap-1"
          >
            الأخيرة <ChevronsLeft className="w-4 h-4" />
          </button>
        </div>
      )}

      {showFaceRegister && onUpdateStudent && (
        <Suspense fallback={null}>
          <LazyFaceRegister
            students={students}
            onUpdateStudent={onUpdateStudent}
            onClose={() => setShowFaceRegister(false)}
          />
        </Suspense>
      )}
    </div>
  );
};