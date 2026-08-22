import React, { useState, useRef, useMemo, useCallback, lazy, Suspense } from 'react';
import { Student } from '../types/student';
import {
  hasValidDescriptor,
  hasLegacyDescriptor,
  getCoveragePercent,
  isGalleryDescriptor,
} from '../services/faceAI/descriptors';
import { CaseSensitive, ChartColumn, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, CircleCheck, ClipboardList, FolderOpen, Hash, IdCard, Lightbulb, LoaderCircle, Pencil, Plus, QrCode, RefreshCw, ScanFace, Smile, SquarePen, Trash2, TriangleAlert, Unlink, Upload, Users, Zap } from 'lucide-react';

// 🚀 نافذة تسجيل بصمات الوجه (فردية وجماعية) تُحمَّل عند فتحها فقط
const LazyFaceEnroll = lazy(() =>
  import('./face/FaceEnrollModal').then(m => ({ default: m.FaceEnrollModal }))
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

export const StudentManager: React.FC<StudentManagerProps> = React.memo(({
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
  const [faceEnrollPreset, setFaceEnrollPreset] = useState<string[] | undefined>(undefined);

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

  /** فتح أداة تسجيل البصمات — لطالب واحد أو مجموعة */
  const openFaceEnroll = (presetIds?: string[]) => {
    setFaceEnrollPreset(presetIds && presetIds.length > 0 ? presetIds : undefined);
    setShowFaceRegister(true);
  };

  /* إعادة تسجيل البصمات القديمة غير المتوافقة مع المحرك الجديد */
  const reEnrollLegacy = () => {
    const legacyIds = students
      .filter(s => hasLegacyDescriptor(s.faceDescriptor))
      .map(s => s.id);
    if (legacyIds.length === 0) return;
    openFaceEnroll(legacyIds);
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

  const studentsWithFace = students.filter(s => hasValidDescriptor(s.faceDescriptor)).length;
  const studentsWithLegacy = students.filter(s => hasLegacyDescriptor(s.faceDescriptor)).length;
  const studentsWithoutFace = students.length - studentsWithFace - studentsWithLegacy;

  const pageIds = paginatedStudents.map(s => s.id);
  const allInPageSelected = pageIds.length > 0 && pageIds.every(id => selectedIds.has(id));

  return (
    <div className="glass-card rounded-xl p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-bold text-white">إدارة الطلاب</h2>
      </div>

      {students.length > 0 && studentsWithoutFace > 0 && (
        <div className="mb-4 p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg flex items-center gap-3">
          <ScanFace className="w-7 h-7 text-emerald-400" />
          <div className="flex-1">
            <p className="text-sm font-bold text-emerald-300">
              {studentsWithoutFace} طالب بدون بصمة وجه
            </p>
            <p className="text-xs text-emerald-400">
              سيتم تسجيل بصمة الوجه تلقائياً عند أول عملية تسجيل. أو يمكنك إضافتها من الملف الشخصي للطالب.
            </p>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="mb-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              اسم الطالب *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-4 py-2 border border-slate-600 bg-slate-800 text-white placeholder:text-slate-500 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="أدخل اسم الطالب"
              dir="rtl"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
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
              className="w-full px-4 py-2 border border-slate-600 bg-slate-800 text-white placeholder:text-slate-500 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent text-center text-lg font-bold"
              placeholder="1001"
              inputMode="numeric"
            />
            <p className="text-xs text-slate-400 mt-1 text-center">من 1000 إلى 9999</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              الكروب (اختياري)
            </label>
            <input
              type="text"
              value={group}
              onChange={(e) => setGroup(e.target.value.toUpperCase())}
              className="w-full px-4 py-2 border border-slate-600 bg-slate-800 text-white placeholder:text-slate-500 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent text-center"
              placeholder="A1"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2 flex items-center gap-1">
              <IdCard className="w-4 h-4" /> الرقم الجامعي
              <span className="text-xs text-blue-400">(اختياري)</span>
            </label>
            <input
              type="text"
              value={universityId}
              onChange={(e) => setUniversityId(e.target.value.replace(/\D/g, ''))}
              className="w-full px-4 py-2 border border-slate-600 bg-slate-800 text-white placeholder:text-slate-500 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent text-center font-mono"
              placeholder="8886736221"
              inputMode="numeric"
            />
            <p className="text-xs text-slate-400 mt-1 text-center">رقم الهوية الجامعية</p>
          </div>
        </div>

        <div className="mt-4 p-4 bg-gradient-to-br from-emerald-500/10 to-teal-500/10 border-2 border-emerald-500/30 rounded-lg">
          <label className="block text-sm font-bold text-emerald-300 mb-2 flex items-center gap-2">
            <QrCode className="w-5 h-5 text-emerald-300" />
            <span>رمز QR الهوية</span>
            <span className="text-xs font-normal text-emerald-300 bg-white/10 px-2 py-0.5 rounded-full">
              اختياري - للمسح السريع
            </span>
          </label>
          <input
            type="text"
            value={qrCodeId}
            onChange={(e) => setQrCodeId(e.target.value)}
            className="w-full px-4 py-2 border border-emerald-500/30 bg-slate-800 text-white placeholder:text-slate-500 rounded-md focus:ring-2 focus:ring-emerald-500 focus:border-transparent font-mono text-sm"
            placeholder="ألصق هنا: https://sis.mohesr.gov.iq/verify?id=... أو الرمز مباشرة"
            dir="ltr"
          />
          <p className="text-xs text-emerald-300 mt-2 flex items-start gap-1">
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
          <div className="mt-4 p-3 bg-red-500/10 border border-red-500/30 text-red-300 rounded-md" dir="rtl">
            {error}
          </div>
        )}
      </form>

      <div className="mb-6 p-5 bg-gradient-to-br from-blue-500/10 to-indigo-500/10 border-2 border-blue-500/30 rounded-lg">
        <h3 className="text-lg font-bold text-white mb-3 flex items-center gap-2">
          <FolderOpen className="w-5 h-5 text-blue-400" /> استيراد الطلاب من ملف Excel
        </h3>
        <div className="mb-4 text-sm text-slate-400 space-y-1">
          <p>اختر بادئة الكود ثم ارفع الملف. سيتم اكتشاف الحقول التالية تلقائياً:</p>
          <div className="flex flex-wrap gap-2 mt-2">
            <span className="px-2 py-1 bg-blue-500/15 text-blue-300 rounded text-xs font-medium inline-flex items-center gap-1"><SquarePen className="w-3 h-3" /> الاسم</span>
            <span className="px-2 py-1 bg-indigo-500/15 text-indigo-300 rounded text-xs font-medium inline-flex items-center gap-1"><Users className="w-3 h-3" /> الكروب (A1, B2, ...)</span>
            <span className="px-2 py-1 bg-purple-500/15 text-purple-300 rounded text-xs font-medium inline-flex items-center gap-1"><IdCard className="w-3 h-3" /> الرقم الجامعي (8-15 رقم)</span>
            <span className="px-2 py-1 bg-emerald-500/15 text-emerald-300 rounded text-xs font-medium inline-flex items-center gap-1"><QrCode className="w-3 h-3" /> رمز QR (رابط الوزارة الكامل)</span>
          </div>
          <p className="text-xs text-emerald-300 mt-2 bg-emerald-500/10 p-2 rounded border border-emerald-500/30 flex items-start gap-1">
            <Lightbulb className="w-4 h-4 shrink-0 mt-0.5" /> <strong>نصيحة:</strong> الصق الرابط الكامل من هوية الوزارة بأي عمود، وسيتم استخراج رمز QR تلقائياً لكل طالب.
          </p>
        </div>

        <div className="mb-4">
          <label className="block text-sm font-medium text-slate-300 mb-2">اختر بادئة الكود:</label>
          <div className="flex flex-wrap gap-2">
            {[1, 2, 3, 4, 5].map((num) => (
              <button
                key={num}
                type="button"
                onClick={() => setSelectedPrefix(num)}
                className={`w-14 h-14 rounded-lg font-bold text-lg transition duration-200 ${
                  selectedPrefix === num
                    ? 'bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-lg scale-110'
                    : 'bg-white/10 text-slate-200 border-2 border-slate-600 hover:border-blue-400'
                }`}
              >
                {num}
              </button>
            ))}
          </div>
          <p className="text-xs text-slate-400 mt-2 flex items-center gap-1">
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
          <div className="mt-4 p-3 bg-green-500/10 border border-green-500/30 text-green-300 rounded-md" dir="rtl">
            {importMessage}
          </div>
        )}
      </div>

      {/* ═══════════ بصمات الوجه ═══════════ */}
      {students.length > 0 && onUpdateStudent && (
        <div className="mb-6 p-5 bg-gradient-to-br from-purple-500/10 to-pink-500/10 border-2 border-purple-500/30 rounded-lg">
          <h3 className="text-lg font-bold text-purple-200 mb-2 flex items-center gap-2">
            <Smile className="w-5 h-5 text-purple-400" /> بصمات الوجه
            <span className="text-xs font-normal bg-purple-500/15 text-purple-300 px-2 py-0.5 rounded-full inline-flex items-center gap-1">
              جديد <Zap className="w-3 h-3" />
            </span>
          </h3>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
            <div className="bg-white/5 rounded-lg p-2 text-center border border-white/10">
              <div className="text-2xl font-bold text-emerald-300">{studentsWithFace}</div>
              <div className="text-xs text-emerald-400">بصمة صالحة</div>
            </div>
            <div className="bg-white/5 rounded-lg p-2 text-center border border-white/10">
              <div className="text-2xl font-bold text-amber-300">{studentsWithLegacy}</div>
              <div className="text-xs text-amber-400">بصمة قديمة</div>
            </div>
            <div className="bg-white/5 rounded-lg p-2 text-center border border-white/10">
              <div className="text-2xl font-bold text-slate-500">{studentsWithoutFace}</div>
              <div className="text-xs text-slate-400">بدون بصمة</div>
            </div>
            <div className="bg-white/5 rounded-lg p-2 text-center border border-white/10">
              <div className="text-2xl font-bold text-pink-300">
                {students.length > 0 ? Math.round((studentsWithFace / students.length) * 100) : 0}%
              </div>
              <div className="text-xs text-pink-400">نسبة الإكمال</div>
            </div>
          </div>

          {studentsWithLegacy > 0 && (
            <div className="mb-3 bg-gradient-to-r from-amber-500/10 to-yellow-500/10 border border-amber-500/30 rounded-lg p-3 flex items-start gap-2">
              <TriangleAlert className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
              <div className="flex-1 text-xs text-slate-300">
                <strong className="text-amber-300">{studentsWithLegacy} طالب</strong> لديهم بصمات بنظام قديم غير متوافق — أعد تسجيلها لتعمل مع المحرك الجديد.
                <button
                  onClick={reEnrollLegacy}
                  className="mr-2 px-2.5 py-1 bg-amber-500 hover:bg-amber-400 text-amber-950 rounded-md font-bold transition"
                >
                  إعادة تسجيل الآن
                </button>
              </div>
            </div>
          )}

          <p className="text-xs text-purple-300 mb-3 bg-white/5 p-2 rounded flex items-start gap-1">
            <Lightbulb className="w-4 h-4 shrink-0 mt-0.5" /> <strong>كيف يعمل؟</strong> اختر الطلاب واضغط زر الإضافة — الكاميرا تلتقط 3 عينات لكل طالب تلقائياً خلال ثوانٍ، ثم يُسجّل حضورهم بمجرد المرور أمام الكاميرا.
          </p>

          <button
            onClick={() => openFaceEnroll()}
            className="w-full relative overflow-hidden bg-gradient-to-l from-violet-600 via-purple-600 to-fuchsia-600 hover:from-violet-500 hover:via-purple-500 hover:to-fuchsia-500 text-white font-extrabold py-3.5 px-6 rounded-xl shadow-lg shadow-purple-900/40 transition duration-200 transform active:scale-[0.98] flex items-center justify-center gap-2.5"
          >
            <ScanFace className="w-6 h-6" />
            <span className="text-base">إضافة بصمات جديدة</span>
            {studentsWithLegacy + studentsWithoutFace > 0 && (
              <span className="absolute top-1 left-2 bg-yellow-400 text-yellow-900 text-[9px] px-1.5 py-0.5 rounded-full font-bold shadow">
                {studentsWithLegacy + studentsWithoutFace} بانتظار التسجيل
              </span>
            )}
          </button>
        </div>
      )}

      {students.length > 1 && (onSortByName || onSortByGroup) && (
        <div className="mb-4 p-4 bg-gradient-to-r from-purple-500/10 to-pink-500/10 border-2 border-purple-500/30 rounded-lg">
          <h3 className="text-sm font-bold text-purple-200 mb-3 flex items-center gap-2">
            <RefreshCw className="w-4 h-4 text-purple-400" /> إعادة ترتيب الطلاب
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
              className="w-full px-4 py-2 pr-10 border border-slate-600 bg-slate-800 text-white placeholder:text-slate-500 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              dir="rtl"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-400 text-xl"
              >
                ×
              </button>
            )}
          </div>

          {uniqueGroups.length > 0 && (
            <select
              value={groupFilter}
              onChange={e => setGroupFilter(e.target.value)}
              className="px-4 py-2 border border-slate-600 bg-slate-800 text-white placeholder:text-slate-500 rounded-lg focus:ring-2 focus:ring-blue-500"
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
        <p className="text-xs text-slate-400 mb-3 flex items-center gap-1">
          <ChartColumn className="w-3.5 h-3.5 text-slate-500" /> نتائج: <strong>{filteredStudents.length}</strong> من {students.length}
        </p>
      )}

      {selectedIds.size > 0 && (
        <div className="mb-4 p-4 bg-gradient-to-r from-orange-500/10 to-red-500/10 border-2 border-orange-500/30 rounded-lg flex items-center justify-between flex-wrap gap-3">
          <div className="text-orange-300 font-medium flex items-center gap-1">
            <CircleCheck className="w-4 h-4" /> تم تحديد <strong>{selectedIds.size}</strong> من {students.length} طالب
          </div>
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => setSelectedIds(new Set())}
              className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white font-medium rounded-md transition"
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
        <div className="mb-3 p-3 bg-white/5 border border-white/10 rounded-lg flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-slate-400">عرض:</span>
            <select
              value={pageSize}
              onChange={e => setPageSize(Number(e.target.value))}
              className="px-3 py-1 border border-slate-600 bg-slate-800 text-white rounded-md text-sm"
            >
              {PAGE_SIZE_OPTIONS.map(size => (
                <option key={size} value={size}>{size} طالب</option>
              ))}
            </select>
            <span className="text-slate-400">
              ({((safeCurrentPage - 1) * pageSize) + 1} - {Math.min(safeCurrentPage * pageSize, filteredStudents.length)} من {filteredStudents.length})
            </span>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => setCurrentPage(1)}
              disabled={safeCurrentPage === 1}
              className="px-2 py-1 bg-white/10 border border-white/15 rounded disabled:opacity-30 hover:bg-white/20 text-sm"
              title="الصفحة الأولى"
            >
              <ChevronsRight className="w-4 h-4" />
            </button>
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={safeCurrentPage === 1}
              className="px-3 py-1 bg-white/10 border border-white/15 rounded disabled:opacity-30 hover:bg-white/20 text-sm flex items-center gap-1"
            >
              <ChevronRight className="w-4 h-4" /> السابق
            </button>
            <span className="px-3 py-1 bg-blue-600 text-white rounded text-sm font-bold">
              {safeCurrentPage} / {totalPages}
            </span>
            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={safeCurrentPage === totalPages}
              className="px-3 py-1 bg-white/10 border border-white/15 rounded disabled:opacity-30 hover:bg-white/20 text-sm flex items-center gap-1"
            >
              التالي <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => setCurrentPage(totalPages)}
              disabled={safeCurrentPage === totalPages}
              className="px-2 py-1 bg-white/10 border border-white/15 rounded disabled:opacity-30 hover:bg-white/20 text-sm"
              title="الصفحة الأخيرة"
            >
              <ChevronsLeft className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-white/10">
          <thead className="bg-white/5">
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
              <th className="px-4 py-3 text-right text-xs font-medium text-slate-400 uppercase tracking-wider">#</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-slate-400 uppercase tracking-wider">الرمز</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-slate-400 uppercase tracking-wider">الاسم</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-slate-400 uppercase tracking-wider">الكروب</th>
              <th className="hidden md:table-cell px-4 py-3 text-right text-xs font-medium text-slate-400 uppercase tracking-wider"><span className="inline-flex items-center gap-1"><IdCard className="w-3.5 h-3.5" /> الرقم الجامعي</span></th>
              <th className="hidden sm:table-cell px-4 py-3 text-right text-xs font-medium text-slate-400 uppercase tracking-wider"><span className="inline-flex items-center gap-1"><QrCode className="w-3.5 h-3.5" /> رمز QR</span></th>
              <th className="hidden sm:table-cell px-4 py-3 text-center text-xs font-medium text-slate-400 uppercase tracking-wider"><span className="inline-flex items-center gap-1"><Smile className="w-3.5 h-3.5" /> الوجه</span></th>
              <th className="px-4 py-3 text-right text-xs font-medium text-slate-400 uppercase tracking-wider">إجراءات</th>
            </tr>
          </thead>
          <tbody className="bg-white/5 divide-y divide-white/10">
            {paginatedStudents.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-6 py-8 text-center text-slate-400">
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

                const hasFace = hasValidDescriptor(student.faceDescriptor) || hasLegacyDescriptor(student.faceDescriptor);
                const isLegacy = !hasValidDescriptor(student.faceDescriptor);

                return (
                  <tr
                    key={student.id}
                    className={`hover:bg-white/5 transition ${selectedIds.has(student.id) ? 'bg-blue-500/10' : ''}`}
                  >
                    <td className="px-4 py-4 text-center">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(student.id)}
                        onChange={() => toggleSelectStudent(student.id)}
                        className="w-5 h-5 cursor-pointer accent-blue-600"
                      />
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-sm text-slate-400">
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
                            className="px-2 py-1 border border-blue-500/40 bg-slate-800 text-white rounded text-sm"
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
                              className="w-16 px-2 py-1 border border-blue-500/40 bg-slate-800 text-white rounded text-sm text-center"
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
                            className="px-2 py-1 bg-white/10 hover:bg-white/20 text-white rounded text-xs"
                            title="إلغاء"
                          >
                            ×
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          {student.group ? (
                            <span className="inline-block px-3 py-1 bg-indigo-500/15 text-indigo-300 text-sm font-medium rounded-full">
                              {student.group}
                            </span>
                          ) : (
                            <span className="text-slate-500 text-sm">-</span>
                          )}
                          {onUpdateStudent && (
                            <button
                              onClick={() => { setTransferStudentId(student.id); setTransferGroupValue(student.group || ''); }}
                              className="text-blue-400 hover:text-blue-300 text-xs"
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
                            className="w-32 px-2 py-1 border border-blue-500/40 bg-slate-800 text-white rounded text-sm font-mono text-center"
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
                            className="px-2 py-1 bg-white/10 hover:bg-white/20 text-white rounded text-xs"
                            title="إلغاء"
                          >
                            ×
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          {student.universityId ? (
                            <span className="inline-block px-2 py-1 bg-blue-500/10 text-blue-300 text-sm font-mono rounded border border-blue-500/30">
                              {student.universityId}
                            </span>
                          ) : (
                            <span className="text-slate-500 text-xs italic">غير مضاف</span>
                          )}
                          {onUpdateStudent && (
                            <button
                              onClick={() => startEditUniId(student)}
                              className="text-blue-400 hover:text-blue-300 text-xs"
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
                            className="w-40 px-2 py-1 border border-emerald-500/40 bg-slate-800 text-white rounded text-xs font-mono text-center"
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
                            className="px-2 py-1 bg-white/10 hover:bg-white/20 text-white rounded text-xs"
                            title="إلغاء"
                          >
                            ×
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          {student.qrCodeId ? (
                            <span
                              className="inline-block px-2 py-1 bg-emerald-500/10 text-emerald-300 text-xs font-mono rounded border border-emerald-500/30 max-w-[140px] truncate"
                              dir="ltr"
                              title={student.qrCodeId}
                            >
                              {student.qrCodeId}
                            </span>
                          ) : (
                            <span className="text-slate-500 text-xs italic">غير مربوط</span>
                          )}
                          {onUpdateStudent && (
                            <>
                              <button
                                onClick={() => startEditQr(student)}
                                className="text-emerald-400 hover:text-emerald-300 text-xs"
                                title="تعديل رمز QR"
                              >
                                <Pencil className="w-4 h-4" />
                              </button>
                              {student.qrCodeId && (
                                <button
                                  onClick={() => removeQrLink(student)}
                                  className="text-red-400 hover:text-red-300 text-xs"
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
                                  isLegacy
                                    ? 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                                    : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                                }`}
                              title={
                                student.faceRegisteredAt
                                  ? `سُجلت في: ${new Date(student.faceRegisteredAt).toLocaleDateString('ar-EG')}${isLegacy ? '\nنظام قديم — تحتاج إعادة تسجيل' : ''}`
                                  : isLegacy ? 'نظام قديم — تحتاج إعادة تسجيل' : 'مسجّلة'
                              }
                            >
                              {isLegacy ? <TriangleAlert className="w-3.5 h-3.5" /> : <CircleCheck className="w-3.5 h-3.5" />}
                              {isLegacy ? 'قديمة' : 'صالحة'}
                            </span>
                            {!isLegacy && hasValidDescriptor(student.faceDescriptor) && (
                              <span className="text-[10px] text-slate-400" title={isGalleryDescriptor(student.faceDescriptor) ? `تغطية الزوايا: ${getCoveragePercent(student.faceDescriptor)}%` : 'بصمة أساسية'}>
                                {isGalleryDescriptor(student.faceDescriptor)
                                  ? `تغطية: ${getCoveragePercent(student.faceDescriptor)}%`
                                  : 'أساسية'}
                              </span>
                            )}
                            {onUpdateStudent && (
                              <button
                                onClick={() => removeFaceData(student)}
                                className="text-red-400 hover:text-red-300 text-xs"
                                title="حذف بصمة الوجه"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </>
                        ) : (
                          <span className="text-slate-500 text-xs italic">غير مسجّلة</span>
                        )}
                      </div>
                    </td>

                    <td className="px-4 py-4 whitespace-nowrap text-right">
                      <div className="flex items-center justify-end gap-3">
                        {onUpdateStudent && (
                          <button
                            onClick={() => openFaceEnroll([student.id])}
                            className="text-violet-400 hover:text-violet-300 font-medium flex items-center gap-1"
                            title="تسجيل / إعادة تسجيل بصمة الوجه لهذا الطالب"
                          >
                            بصمة <ScanFace className="w-4 h-4" />
                          </button>
                        )}
                        {onOpenProfile && (
                          <button
                            onClick={() => onOpenProfile(student)}
                            className="text-blue-400 hover:text-blue-300 font-medium flex items-center gap-1"
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
                          className="text-red-400 hover:text-red-300 font-medium"
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
        <div className="mt-4 p-3 bg-white/5 border border-white/10 rounded-lg flex items-center justify-center gap-1 flex-wrap">
          <button
            onClick={() => setCurrentPage(1)}
            disabled={safeCurrentPage === 1}
            className="px-2 py-1 bg-white/10 border border-white/15 rounded disabled:opacity-30 hover:bg-white/20 text-sm flex items-center gap-1"
          >
            <ChevronsRight className="w-4 h-4" /> الأولى
          </button>
          <button
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            disabled={safeCurrentPage === 1}
            className="px-3 py-1 bg-white/10 border border-white/15 rounded disabled:opacity-30 hover:bg-white/20 text-sm flex items-center gap-1"
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
                    : 'bg-white/10 border border-white/15 hover:bg-white/20'
                }`}
              >
                {pageNum}
              </button>
            );
          })}

          <button
            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
            disabled={safeCurrentPage === totalPages}
            className="px-3 py-1 bg-white/10 border border-white/15 rounded disabled:opacity-30 hover:bg-white/20 text-sm flex items-center gap-1"
          >
            التالي <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={() => setCurrentPage(totalPages)}
            disabled={safeCurrentPage === totalPages}
            className="px-2 py-1 bg-white/10 border border-white/15 rounded disabled:opacity-30 hover:bg-white/20 text-sm flex items-center gap-1"
          >
            الأخيرة <ChevronsLeft className="w-4 h-4" />
          </button>
        </div>
      )}

      {showFaceRegister && onUpdateStudent && (
        <Suspense fallback={
          <div className="fixed inset-0 z-[9999] bg-slate-950/95 backdrop-blur-sm flex items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              <div className="w-10 h-10 border-4 border-violet-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-slate-300 text-sm font-bold">جاري تحضير أداة التسجيل...</p>
            </div>
          </div>
        }>
          <LazyFaceEnroll
            students={students}
            onUpdateStudent={onUpdateStudent}
            initialSelectedIds={faceEnrollPreset}
            onClose={() => { setShowFaceRegister(false); setFaceEnrollPreset(undefined); }}
          />
        </Suspense>
      )}
    </div>
  );
});