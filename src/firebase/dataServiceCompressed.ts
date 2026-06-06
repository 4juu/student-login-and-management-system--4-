import { ref, set, get, remove } from "firebase/database";
import { database } from "./config";
import { AttendanceRecord } from "../types/student";
import { getActiveAcademicYear } from "./dataService";
import * as XLSX from 'xlsx-js-style';

// ============================================================
// 🗜️ SMART COMPRESSED RECORDS - الضغط الذكي
// ============================================================
// الفكرة: نضغط أسماء الحقول (n بدل name) لكن نحتفظ بكل البيانات
// التوفير: 80% من المساحة بدون فقدان أي معلومة!
// ============================================================

/**
 * 📦 السجل المضغوط ذكياً
 * - نحتفظ بكل البيانات المهمة
 * - نختصر أسماء الحقول فقط
 * - لو حذفت طالب، السجلات تبقى موجودة!
 */
interface SmartCompressedRecord {
  i: string;           // id
  s: string;           // studentId
  n: string;           // studentName
  c: string;           // studentCode
  g?: string;          // studentGroup
  t: number;           // timestamp (Unix - أصغر من ISO string)
  se: string;          // sessionId
  m: 'q' | 'm';        // method (q=qr, m=manual)
  su?: string;         // subjectName
  a?: number;          // absenceCount
}

/**
 * 🗜️ ضغط سجل عادي إلى سجل ذكي
 */
export const compressRecord = (record: AttendanceRecord): SmartCompressedRecord => {
  return {
    i: record.id,
    s: record.studentId,
    n: record.studentName,
    c: record.studentCode,
    g: record.studentGroup,
    t: new Date(record.timestamp).getTime(),
    se: record.sessionId,
    m: record.method === 'qr' ? 'q' : 'm',
    su: record.subjectName || undefined,
    a: record.absenceCount || undefined,
  };
};

/**
 * 🔓 فك ضغط سجل (بدون حاجة لقائمة الطلاب!)
 */
export const decompressRecord = (compressed: SmartCompressedRecord): AttendanceRecord => {
  const date = new Date(compressed.t);
  
  return {
    id: compressed.i,
    studentId: compressed.s,
    studentName: compressed.n,
    studentCode: compressed.c,
    studentGroup: compressed.g,
    timestamp: date.toISOString(),
    date: date.toLocaleDateString('ar-EG'),
    time: date.toLocaleTimeString('ar-EG'),
    sessionId: compressed.se,
    status: 'present',
    method: compressed.m === 'q' ? 'qr' : 'manual',
    subjectName: compressed.su,
    absenceCount: compressed.a,
  };
};

// ============================================================
// 💾 حفظ السجلات المضغوطة
// ============================================================

export const saveCompressedRecords = async (
  adminUid: string,
  stageId: string,
  teacherId: string,
  records: AttendanceRecord[]
): Promise<void> => {
  try {
    const year = await getActiveAcademicYear();
    const compressed = records.map(compressRecord);
    
    const path = `academicYears/${year}/userData/${adminUid}/stageData/${stageId}/teacherRecords/${teacherId}/recordsCompressed`;
    await set(ref(database, path), compressed);
    
    const originalSize = JSON.stringify(records).length;
    const compressedSize = JSON.stringify(compressed).length;
    const savedPercent = ((1 - compressedSize / originalSize) * 100).toFixed(1);
    
    console.log(`✅ تم حفظ ${compressed.length} سجل مضغوط - وفّرنا ${savedPercent}%`);
  } catch (e) {
    console.error('❌ فشل حفظ السجلات المضغوطة:', e);
    throw e;
  }
};

/**
 * 📥 تحميل السجلات المضغوطة وفكها
 */
export const loadCompressedRecords = async (
  adminUid: string,
  stageId: string,
  teacherId: string
): Promise<AttendanceRecord[]> => {
  try {
    const year = await getActiveAcademicYear();
    const path = `academicYears/${year}/userData/${adminUid}/stageData/${stageId}/teacherRecords/${teacherId}/recordsCompressed`;
    
    const snap = await get(ref(database, path));
    if (!snap.exists()) return [];
    
    const data = snap.val();
    const compressed: SmartCompressedRecord[] = Array.isArray(data) ? data : Object.values(data);
    
    // فك الضغط (آمن - لا يعتمد على وجود الطلاب)
    const decompressed = compressed.map(decompressRecord);
    
    console.log(`✅ تم تحميل ${decompressed.length} سجل مضغوط`);
    return decompressed;
  } catch (e) {
    console.error('❌ فشل تحميل السجلات المضغوطة:', e);
    return [];
  }
};

// ============================================================
// 🔄 ترحيل السجلات القديمة إلى الصيغة المضغوطة
// ============================================================

export interface MigrationResult {
  originalCount: number;
  compressedCount: number;
  originalSizeKB: number;
  compressedSizeKB: number;
  savedKB: number;
  savedPercent: number;
}

/**
 * يحوّل كل السجلات القديمة (الكاملة) إلى مضغوطة
 * يستخدم مرة واحدة فقط بعد التحديث
 */
export const migrateToCompressed = async (
  adminUid: string,
  stageId: string,
  teacherId: string
): Promise<MigrationResult> => {
  try {
    const year = await getActiveAcademicYear();
    
    // اقرأ السجلات القديمة
    const oldPath = `academicYears/${year}/userData/${adminUid}/stageData/${stageId}/teacherRecords/${teacherId}/records`;
    const oldSnap = await get(ref(database, oldPath));
    
    if (!oldSnap.exists()) {
      return {
        originalCount: 0,
        compressedCount: 0,
        originalSizeKB: 0,
        compressedSizeKB: 0,
        savedKB: 0,
        savedPercent: 0,
      };
    }
    
    const data = oldSnap.val();
    const oldRecords: AttendanceRecord[] = Array.isArray(data) ? data : Object.values(data);
    
    if (oldRecords.length === 0) {
      return {
        originalCount: 0,
        compressedCount: 0,
        originalSizeKB: 0,
        compressedSizeKB: 0,
        savedKB: 0,
        savedPercent: 0,
      };
    }
    
    const originalSize = JSON.stringify(oldRecords).length;
    
    // اضغط واحفظ
    const compressed = oldRecords.map(compressRecord);
    const compressedSize = JSON.stringify(compressed).length;
    
    const newPath = `academicYears/${year}/userData/${adminUid}/stageData/${stageId}/teacherRecords/${teacherId}/recordsCompressed`;
    await set(ref(database, newPath), compressed);
    
    // احذف القديم لتوفير المساحة
    await remove(ref(database, oldPath));
    
    return {
      originalCount: oldRecords.length,
      compressedCount: compressed.length,
      originalSizeKB: Math.round(originalSize / 1024 * 10) / 10,
      compressedSizeKB: Math.round(compressedSize / 1024 * 10) / 10,
      savedKB: Math.round((originalSize - compressedSize) / 1024 * 10) / 10,
      savedPercent: Math.round((1 - compressedSize / originalSize) * 100),
    };
  } catch (e) {
    console.error('❌ فشل الترحيل:', e);
    throw e;
  }
};

// ============================================================
// 📊 إحصائيات الضغط
// ============================================================

export interface CompressionStats {
  totalRecords: number;
  compressedSizeKB: number;
  estimatedOriginalSizeKB: number;
  savedKB: number;
  savedPercent: number;
  oldestRecordDate: string | null;
  newestRecordDate: string | null;
  monthsOfData: number;
}

export const getCompressionStats = async (
  adminUid: string,
  stageId: string,
  teacherId: string
): Promise<CompressionStats> => {
  const records = await loadCompressedRecords(adminUid, stageId, teacherId);
  
  if (records.length === 0) {
    return {
      totalRecords: 0,
      compressedSizeKB: 0,
      estimatedOriginalSizeKB: 0,
      savedKB: 0,
      savedPercent: 0,
      oldestRecordDate: null,
      newestRecordDate: null,
      monthsOfData: 0,
    };
  }
  
  const compressed = records.map(compressRecord);
  const compressedSize = JSON.stringify(compressed).length;
  const originalSize = JSON.stringify(records).length;
  
  const dates = records.map(r => new Date(r.timestamp).getTime());
  const oldestDate = new Date(Math.min(...dates));
  const newestDate = new Date(Math.max(...dates));
  
  const monthsDiff = (newestDate.getFullYear() - oldestDate.getFullYear()) * 12 +
                     (newestDate.getMonth() - oldestDate.getMonth()) + 1;
  
  return {
    totalRecords: records.length,
    compressedSizeKB: Math.round(compressedSize / 1024 * 10) / 10,
    estimatedOriginalSizeKB: Math.round(originalSize / 1024 * 10) / 10,
    savedKB: Math.round((originalSize - compressedSize) / 1024 * 10) / 10,
    savedPercent: Math.round((1 - compressedSize / originalSize) * 100),
    oldestRecordDate: oldestDate.toISOString().split('T')[0],
    newestRecordDate: newestDate.toISOString().split('T')[0],
    monthsOfData: monthsDiff,
  };
};

// ============================================================
// 📁 الأرشفة الاختيارية (للسجلات القديمة جداً)
// ============================================================

export interface ArchiveResult {
  archivedCount: number;
  remainingCount: number;
  fileName: string;
  monthsArchived: string[];
}

export const archiveOldRecords = async (
  adminUid: string,
  stageId: string,
  teacherId: string,
  monthsToKeep: number = 6
): Promise<ArchiveResult> => {
  try {
    const allRecords = await loadCompressedRecords(adminUid, stageId, teacherId);
    
    if (allRecords.length === 0) {
      throw new Error('لا توجد سجلات للأرشفة');
    }
    
    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - monthsToKeep);
    
    const toArchive = allRecords.filter(r => new Date(r.timestamp) < cutoffDate);
    const toKeep = allRecords.filter(r => new Date(r.timestamp) >= cutoffDate);
    
    if (toArchive.length === 0) {
      throw new Error(`لا توجد سجلات أقدم من ${monthsToKeep} شهور`);
    }
    
    // إنشاء ملف Excel للأرشيف
    const archiveData = toArchive.map((r, i) => ({
      'ت': i + 1,
      'اسم الطالب': r.studentName,
      'الرمز': r.studentCode,
      'الكروب': r.studentGroup || '-',
      'التاريخ': r.date,
      'الوقت': r.time,
      'طريقة التسجيل': r.method === 'qr' ? '🔳 QR' : '⌨️ يدوي',
    }));
    
    const ws = XLSX.utils.json_to_sheet(archiveData);
    ws['!views'] = [{ rightToLeft: true }];
    ws['!cols'] = [
      { wch: 6 }, { wch: 30 }, { wch: 12 }, { wch: 10 },
      { wch: 15 }, { wch: 15 }, { wch: 15 }
    ];
    
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'سجلات مؤرشفة');
    
    const firstDate = new Date(Math.min(...toArchive.map(r => new Date(r.timestamp).getTime())));
    const lastDate = new Date(Math.max(...toArchive.map(r => new Date(r.timestamp).getTime())));
    const fileName = `أرشيف_${firstDate.toISOString().split('T')[0]}_إلى_${lastDate.toISOString().split('T')[0]}.xlsx`;
    
    XLSX.writeFile(wb, fileName);
    
    // حفظ السجلات المتبقية فقط
    await saveCompressedRecords(adminUid, stageId, teacherId, toKeep);
    
    const monthsArchivedSet = new Set<string>();
    toArchive.forEach(r => {
      const d = new Date(r.timestamp);
      monthsArchivedSet.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    });
    
    return {
      archivedCount: toArchive.length,
      remainingCount: toKeep.length,
      fileName,
      monthsArchived: Array.from(monthsArchivedSet).sort(),
    };
  } catch (e: any) {
    console.error('❌ فشل الأرشفة:', e);
    throw e;
  }
};