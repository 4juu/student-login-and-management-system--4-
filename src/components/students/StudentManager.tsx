import React, { useState, useRef, useMemo, useCallback, lazy, Suspense } from 'react';
import { Student } from '../../types/student';
import { useConfirm } from '../../hooks/useConfirm';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import {
  hasValidDescriptor,
  getGalleryHealthSummary,
  isGalleryDescriptor,
  pruneStaleClusters,
  migrateToV5,
} from '../../services/faceAI/descriptors';
import { StudentForm } from './StudentForm';
import { StudentImportPanel } from './StudentImportPanel';
import { BulkStudentImportModal } from './BulkStudentImportModal';
import { DuplicateNamesModal } from './DuplicateNamesModal';
import { FaceHealthPanel } from './FaceHealthPanel';
import { SortFilterPanel } from './SortFilterPanel';
import { BulkActionsBar } from './BulkActionsBar';
import { StudentTable } from './StudentTable';
import { Pagination } from './Pagination';
import { LoadingState } from '../loading/LoadingState';
import { toast } from '@/hooks/use-toast';
import { Users } from 'lucide-react';

// 🚀 نافذة تسجيل بصمات الوجه (فردية وجماعية) تُحمَّل عند فتحها فقط
const LazyFaceEnroll = lazy(() =>
  import('../face/FaceEnrollModal').then(m => ({ default: m.FaceEnrollModal }))
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

  const [showBulkImport, setShowBulkImport] = useState(false);
  const [showDuplicateFinder, setShowDuplicateFinder] = useState(false);

  const [editingUniIdStudent, setEditingUniIdStudent] = useState<string | null>(null);
  const { confirm: confirmAction, ConfirmDialog: ConfirmDialogEl } = useConfirm();
  const [editUniversityId, setEditUniversityId] = useState('');

  const [editingQrStudent, setEditingQrStudent] = useState<string | null>(null);
  const [editQrCodeId, setEditQrCodeId] = useState('');

  const [transferStudentId, setTransferStudentId] = useState<string | null>(null);
  const [transferGroupValue, setTransferGroupValue] = useState('');

  const [showFaceRegister, setShowFaceRegister] = useState(false);
  useBodyScrollLock(showFaceRegister && !!onUpdateStudent);
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

    if (students.some(s => s.name.trim() === name.trim())) {
      setError('هذا الاسم مستخدم بالفعل لطالب آخر');
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
      id: crypto.randomUUID(),
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
      const XLSX = await import('xlsx-js-style');
      const workbook = XLSX.read(data);
      const sheetName = workbook.SheetNames[0];
      const sheet = sheetName !== undefined ? workbook.Sheets[sheetName] : undefined;
      if (!sheet) {
        setError('الملف لا يحتوي على أي ورقة عمل.');
        setImportLoading(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
        return;
      }
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
          else if (/[\\u0600-\\u06FF]/.test(cellStr) && cellStr.length > 2) {
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
        const confirmed = await confirmAction({
          title: 'استيراد دفعة كبيرة',
          message: `تم العثور على ${parsed.length} طالب في الملف. هل تريد المتابعة بالاستيراد؟`,
          confirmLabel: 'متابعة',
        });
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

  const handleBulkImport = (parsedStudents: { name: string; group: string; code: string }[]) => {
    const existingCodes = new Set(students.map(s => s.code));
    const existingNames = new Set(students.map(s => s.name));

    const newStudentsBatch: Student[] = [];

    for (const student of parsedStudents) {
      if (existingNames.has(student.name)) continue;
      if (existingCodes.has(student.code)) continue;

      const newStudent: Student = {
        id: crypto.randomUUID(),
        name: student.name,
        code: student.code,
        group: student.group,
        createdAt: new Date().toISOString(),
      };

      newStudentsBatch.push(newStudent);
      existingCodes.add(student.code);
      existingNames.add(student.name);
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

  const handleDeleteSelected = async () => {
    if (selectedIds.size === 0) return;

    const isAll = selectedIds.size === students.length;
    const message = isAll
      ? `سيتم حذف جميع الطلاب (${students.length})! هل أنت متأكد؟`
      : `هل أنت متأكد من حذف ${selectedIds.size} طالب؟`;

    const ok = await confirmAction({ title: 'حذف الطلاب', message, confirmLabel: 'حذف' });
    if (!ok) return;

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
      toast({ variant: 'destructive', title: 'هذا الرقم الجامعي مستخدم لطالب آخر' });
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
      toast({ variant: 'destructive', title: 'رمز QR هذا مستخدم لطالب آخر' });
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

  const removeQrLink = async (student: Student) => {
    if (!onUpdateStudent) return;
    const ok = await confirmAction({
      title: 'فك ربط QR',
      message: `هل تريد فك ربط رمز QR من ${student.name}؟`,
      confirmLabel: 'فك الربط',
    });
    if (!ok) return;
    onUpdateStudent(student.id, { qrCodeId: undefined });
  };

  const removeFaceData = async (student: Student) => {
    if (!onUpdateStudent) return;
    const ok = await confirmAction({
      title: 'حذف بصمة الوجه',
      message: `هل تريد حذف بصمة الوجه من ${student.name}؟`,
      confirmLabel: 'حذف',
    });
    if (!ok) return;
    onUpdateStudent(student.id, { faceDescriptor: undefined, faceRegisteredAt: undefined });
  };

  /** فتح أداة تسجيل البصمات — لطالب واحد أو مجموعة */
  const openFaceEnroll = (presetIds?: string[]) => {
    setFaceEnrollPreset(presetIds && presetIds.length > 0 ? presetIds : undefined);
    setShowFaceRegister(true);
  };

  /* إعادة تسجيل الطالب بدون بصمة */
  const reEnrollNoFace = () => {
    const noFaceIds = students
      .filter(s => !hasValidDescriptor(s.faceDescriptor))
      .map(s => s.id);
    if (noFaceIds.length === 0) return;
    openFaceEnroll(noFaceIds);
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

  // تنظيف تلقائي: تقليم العناقيد القديمة + حذف اي بصمة غير متوافقة مع صيغة v5 الصارمة
  React.useEffect(() => {
    if (!onUpdateStudent) return;
    try {
      students.forEach(s => {
        const fd = s.faceDescriptor;
        if (!fd) return;
        if (isGalleryDescriptor(fd)) {
          // بصمة غير قابلة للتحليل اطلاقا (فارغة/تالفة) → حذف نهائي
          if (migrateToV5(fd) === null) {
            onUpdateStudent(s.id, { faceDescriptor: null });
            return;
          }
          const pruned = pruneStaleClusters(fd);
          if (pruned !== fd) onUpdateStudent(s.id, { faceDescriptor: pruned });
        } else {
          // اي تنسيق قديم (مصفوفة مسطحة، {descriptor}...) → حذف
          onUpdateStudent(s.id, { faceDescriptor: null });
        }
      });
    } catch (e) {
      console.warn('[student-manager] فشل تنظيف البصمات:', e);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { studentsWithoutFace, health } = useMemo(() => {
    const withFace = students.filter(s => hasValidDescriptor(s.faceDescriptor)).length;
    return {
      studentsWithoutFace: students.length - withFace,
      health: getGalleryHealthSummary(students),
    };
  }, [students]);

  const pageIds = paginatedStudents.map(s => s.id);
  const allInPageSelected = pageIds.length > 0 && pageIds.every(id => selectedIds.has(id));
  const isFiltered = !!searchQuery || groupFilter !== 'all';

  return (
    <div className="glass-card rounded-xl p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-bold text-white">إدارة الطلاب</h2>
      </div>

      <FaceHealthPanel
        variant="banner"
        studentsCount={students.length}
        studentsWithoutFace={studentsWithoutFace}
        health={health}
        canEnroll={!!onUpdateStudent}
        onReEnrollNoFace={reEnrollNoFace}
        onOpenEnroll={() => openFaceEnroll()}
      />

      <StudentForm
        name={name}
        code={code}
        group={group}
        universityId={universityId}
        qrCodeId={qrCodeId}
        error={error}
        onNameChange={setName}
        onCodeChange={setCode}
        onGroupChange={setGroup}
        onUniversityIdChange={setUniversityId}
        onQrCodeIdChange={setQrCodeId}
        onSubmit={handleSubmit}
      />

      <StudentImportPanel
        selectedPrefix={selectedPrefix}
        importLoading={importLoading}
        importMessage={importMessage}
        fileInputRef={fileInputRef}
        onPrefixSelect={setSelectedPrefix}
        onFileChange={handleFileUpload}
      />

      <div className="mb-4">
        <button
          type="button"
          onClick={() => setShowBulkImport(true)}
          className="w-full md:w-auto px-6 py-3 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-medium rounded-lg transition duration-200 shadow-md flex items-center justify-center gap-2"
        >
          <Users className="w-5 h-5" />
          استيراد جماعي (لصق أسماء)
        </button>
      </div>

      <FaceHealthPanel
        variant="health"
        studentsCount={students.length}
        studentsWithoutFace={studentsWithoutFace}
        health={health}
        canEnroll={!!onUpdateStudent}
        onReEnrollNoFace={reEnrollNoFace}
        onOpenEnroll={() => openFaceEnroll()}
      />

      <SortFilterPanel
        students={students}
        studentsCount={students.length}
        searchQuery={searchQuery}
        groupFilter={groupFilter}
        uniqueGroups={uniqueGroups}
        filteredCount={filteredStudents.length}
        onSearchChange={setSearchQuery}
        onGroupFilterChange={setGroupFilter}
        onSortByName={onSortByName}
        onSortByGroup={onSortByGroup}
        onOpenDuplicateFinder={() => setShowDuplicateFinder(true)}
        confirm={confirmAction}
      />

      <BulkActionsBar
        selectedCount={selectedIds.size}
        totalCount={students.length}
        filteredCount={filteredStudents.length}
        pageSize={pageSize}
        onCancelSelection={() => setSelectedIds(new Set())}
        onSelectAllFiltered={toggleSelectAllFiltered}
        onDeleteSelected={handleDeleteSelected}
      />

      <Pagination
        variant="top"
        currentPage={safeCurrentPage}
        totalPages={totalPages}
        pageSize={pageSize}
        totalItems={filteredStudents.length}
        setCurrentPage={setCurrentPage}
        setPageSize={setPageSize}
      />

      <StudentTable
        paginatedStudents={paginatedStudents}
        selectedIds={selectedIds}
        allInPageSelected={allInPageSelected}
        isFiltered={isFiltered}
        safeCurrentPage={safeCurrentPage}
        pageSize={pageSize}
        uniqueGroups={uniqueGroups}
        onUpdateStudent={onUpdateStudent}
        onOpenProfile={onOpenProfile}
        onDeleteStudent={onDeleteStudent}
        toggleSelectStudent={toggleSelectStudent}
        toggleSelectAllInPage={toggleSelectAllInPage}
        openFaceEnroll={openFaceEnroll}
        transferStudentId={transferStudentId}
        setTransferStudentId={setTransferStudentId}
        transferGroupValue={transferGroupValue}
        setTransferGroupValue={setTransferGroupValue}
        editingUniIdStudent={editingUniIdStudent}
        editUniversityId={editUniversityId}
        setEditUniversityId={setEditUniversityId}
        startEditUniId={startEditUniId}
        saveEditUniId={saveEditUniId}
        cancelEditUniId={cancelEditUniId}
        editingQrStudent={editingQrStudent}
        editQrCodeId={editQrCodeId}
        setEditQrCodeId={setEditQrCodeId}
        startEditQr={startEditQr}
        saveEditQr={saveEditQr}
        cancelEditQr={cancelEditQr}
        removeQrLink={removeQrLink}
        removeFaceData={removeFaceData}
      />

      <Pagination
        variant="bottom"
        currentPage={safeCurrentPage}
        totalPages={totalPages}
        pageSize={pageSize}
        totalItems={filteredStudents.length}
        setCurrentPage={setCurrentPage}
        setPageSize={setPageSize}
      />

      {showFaceRegister && onUpdateStudent && (
        <Suspense fallback={
          <div className="fixed inset-0 z-[9999] bg-slate-950/95 backdrop-blur-sm flex items-center justify-center p-4 animate-fadeIn">
            <LoadingState size="md" />
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

      {ConfirmDialogEl}

      <BulkStudentImportModal
        isOpen={showBulkImport}
        onClose={() => setShowBulkImport(false)}
        onImport={handleBulkImport}
        existingStudents={students.map(s => ({ name: s.name, code: s.code }))}
        selectedPrefix={selectedPrefix}
      />

      <DuplicateNamesModal
        isOpen={showDuplicateFinder}
        onClose={() => setShowDuplicateFinder(false)}
        students={students}
      />
    </div>
  );
});
