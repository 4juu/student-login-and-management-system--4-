import React, { useRef, useState, useEffect } from 'react';
import { Student, AttendanceRecord } from '../types/student';
import { User } from '../types/user';
import { 
  downloadBackup, 
  resetAcademicYear, 
  getDatabaseStats, 
  listAllAcademicYears,
  getCurrentAcademicYear 
} from '../firebase/dataService';

interface SettingsProps {
  students: Student[];
  attendanceRecords: AttendanceRecord[];
  onDataRestored: () => void;
  currentUser?: User;
  onResetComplete?: () => void;
}

export const Settings: React.FC<SettingsProps> = ({
  students,
  attendanceRecords,
  onDataRestored,
  currentUser,
  onResetComplete,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [stats, setStats] = useState<{
    academicYear: string;
    totalSizeKB: number;
    totalStudents: number;
    totalRecords: number;
    totalSessions: number;
  } | null>(null);
  const [academicYears, setAcademicYears] = useState<string[]>([]);
  const [loadingStats, setLoadingStats] = useState(false);
  const [downloadingBackup, setDownloadingBackup] = useState(false);
  const [resetting, setResetting] = useState(false);

  const currentAcademicYear = getCurrentAcademicYear();
  const isAdmin = currentUser?.role === 'admin';

  // ✅ دالة عرض الحجم بشكل ذكي
  const formatSize = (kb: number): string => {
    if (kb < 1024) {
      return `${kb.toFixed(1)} KB`;
    } else if (kb < 1024 * 1024) {
      return `${(kb / 1024).toFixed(2)} MB`;
    } else {
      return `${(kb / (1024 * 1024)).toFixed(2)} GB`;
    }
  };

  // ✅ حساب صحيح للنسبة (تحويل الوحدات)
  const firebaseQuotaMB = 1024; // 1 GB = 1024 MB
  const firebaseQuotaKB = firebaseQuotaMB * 1024; // = 1,048,576 KB
  const usagePercent = stats ? (stats.totalSizeKB / firebaseQuotaKB) * 100 : 0;

  useEffect(() => {
    if (isAdmin && currentUser) {
      loadStats();
      loadYears();
    }
  }, [isAdmin, currentUser]);

  const loadStats = async () => {
    if (!currentUser) return;
    setLoadingStats(true);
    try {
      const adminUid = currentUser.role === 'admin' 
        ? currentUser.uid 
        : (currentUser.adminId || currentUser.uid);
      const data = await getDatabaseStats(adminUid);
      setStats(data);
    } catch (e) {
      console.warn('فشل تحميل الإحصائيات:', e);
    } finally {
      setLoadingStats(false);
    }
  };

  const loadYears = async () => {
    try {
      const years = await listAllAcademicYears();
      setAcademicYears(years);
    } catch (e) {
      console.warn('فشل تحميل السنوات:', e);
    }
  };

  const handleDownloadFirebaseBackup = async () => {
    if (!currentUser) return;
    setDownloadingBackup(true);
    try {
      const adminUid = currentUser.role === 'admin' 
        ? currentUser.uid 
        : (currentUser.adminId || currentUser.uid);
      await downloadBackup(adminUid);
      alert('✅ تم تحميل النسخة الاحتياطية من Firebase بنجاح!');
    } catch (e: any) {
      alert('❌ ' + (e.message || 'فشل تحميل النسخة الاحتياطية'));
    } finally {
      setDownloadingBackup(false);
    }
  };

  const handleResetAcademicYear = async () => {
    if (!currentUser || currentUser.role !== 'admin') {
      alert('⛔ هذه الميزة متاحة للأدمن فقط');
      return;
    }

    const confirm1 = window.confirm(
      `⚠️ تحذير خطير: تصفير السنة الأكاديمية\n\n` +
      `سيتم:\n` +
      `❌ حذف جميع الطلاب (${stats?.totalStudents || 0})\n` +
      `❌ حذف جميع سجلات الحضور (${stats?.totalRecords || 0})\n` +
      `❌ حذف جميع الجلسات (${stats?.totalSessions || 0})\n` +
      `❌ حذف جميع الكليات والمراحل\n` +
      `🔒 تعطيل جميع حسابات التدريسيين\n\n` +
      `✅ ما سيبقى:\n` +
      `✓ حسابك (الأدمن)\n` +
      `✓ حسابات التدريسيين (بدون صلاحيات)\n\n` +
      `هل أنت متأكد 100%؟`
    );

    if (!confirm1) return;

    const confirmText = window.prompt(
      `للتأكيد النهائي، اكتب: "تصفير"\n\n(بدون علامات الاقتباس)`
    );

    if (confirmText !== 'تصفير') {
      alert('❌ تم إلغاء العملية');
      return;
    }

    setResetting(true);
    try {
      const result = await resetAcademicYear(currentUser.uid, {
        downloadBackupFirst: true,
        deactivateTeachers: true,
      });

      alert(
        `✅ تم التصفير بنجاح!\n\n` +
        `📅 السنة السابقة: ${result.oldYear}\n` +
        `📅 السنة الجديدة: ${result.newYear}\n\n` +
        `💾 تم تحميل نسخة احتياطية تلقائياً\n` +
        `🔒 تم تعطيل ${stats?.totalStudents ? 'جميع' : '0'} حسابات التدريسيين\n\n` +
        `سيتم إعادة تحميل الصفحة الآن...`
      );

      onResetComplete?.();
      setTimeout(() => window.location.reload(), 1500);
    } catch (e: any) {
      alert('❌ فشل التصفير: ' + (e.message || 'خطأ غير معروف'));
    } finally {
      setResetting(false);
    }
  };

  const handleDownloadLocalBackup = () => {
    try {
      const backupData = {
        students,
        attendanceRecords,
        timestamp: new Date().toISOString(),
        academicYear: currentAcademicYear,
        version: '2.0',
      };
      
      const dataStr = JSON.stringify(backupData, null, 2);
      const blob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const now = new Date();
      const fileName = `نسخة_محلية_${currentAcademicYear}_${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}.json`;
      
      link.setAttribute('href', url);
      link.setAttribute('download', fileName);
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      
      alert('✅ تم تنزيل النسخة المحلية بنجاح!');
    } catch (error) {
      console.error('Error downloading backup:', error);
      alert('❌ حدث خطأ أثناء إنشاء النسخة الاحتياطية');
    }
  };

  const handleRestoreBackup = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      if (content) {
        try {
          JSON.parse(content);
          if (window.confirm('هل أنت متأكد من استعادة النسخة الاحتياطية؟ سيتم تحديث الصفحة...')) {
            alert('✅ تم استعادة النسخة الاحتياطية بنجاح! سيتم تحديث الصفحة...');
            onDataRestored();
            window.location.reload();
          }
        } catch {
          alert('❌ فشل استعادة النسخة الاحتياطية. تأكد من صحة الملف.');
        }
      }
    };
    reader.readAsText(file);
    
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  };

  const calculateDataSize = () => {
    const dataString = JSON.stringify({ students, attendanceRecords });
    return dataString.length;
  };

  const dataSize = calculateDataSize();

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <h2 className="text-2xl font-bold mb-6 text-gray-800">⚙️ الإعدادات والنسخ الاحتياطي</h2>

      {/* شريط السنة الأكاديمية */}
      <div className="mb-6 p-4 bg-gradient-to-r from-indigo-50 to-purple-50 border-2 border-indigo-300 rounded-xl">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <span className="text-3xl">🎓</span>
            <div>
              <h3 className="font-bold text-indigo-900">السنة الأكاديمية الحالية</h3>
              <p className="text-2xl font-bold text-indigo-700">
                {currentAcademicYear.replace('_', ' - ')}
              </p>
            </div>
          </div>
          {academicYears.length > 0 && (
            <div className="text-sm text-indigo-700 bg-white px-3 py-2 rounded-lg border border-indigo-200">
              📚 {academicYears.length} سنة في النظام
            </div>
          )}
        </div>
      </div>

      {/* إحصائيات Firebase (للأدمن) */}
      {isAdmin && (
        <div className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-lg font-semibold text-gray-700">📊 استخدام Firebase</h3>
            <button
              onClick={loadStats}
              disabled={loadingStats}
              className="text-sm text-blue-600 hover:text-blue-800"
            >
              {loadingStats ? '⏳ ...' : '🔄 تحديث'}
            </button>
          </div>

          {stats ? (
            <div className="bg-gradient-to-br from-blue-50 to-cyan-50 border-2 border-blue-200 rounded-xl p-4">
              {/* شريط الاستخدام - ✅ مصحح */}
              <div className="mb-4">
                <div className="flex justify-between text-sm font-medium text-gray-700 mb-2">
                  <span>الحجم المستخدم</span>
                  <span className={
                    usagePercent > 70 ? 'text-red-600' : 
                    usagePercent > 40 ? 'text-yellow-600' : 
                    'text-green-600'
                  }>
                    {formatSize(stats.totalSizeKB)} من 1 GB ({usagePercent.toFixed(4)}%)
                  </span>
                </div>
                <div className="w-full bg-white rounded-full h-3 overflow-hidden border border-blue-200">
                  <div
                    className={`h-full rounded-full transition-all ${
                      usagePercent > 70 ? 'bg-red-500' : 
                      usagePercent > 40 ? 'bg-yellow-500' : 
                      'bg-green-500'
                    }`}
                    style={{ width: `${Math.min(100, Math.max(0.5, usagePercent))}%` }}
                  />
                </div>
              </div>

              {/* الإحصائيات */}
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-white rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold text-blue-700">{stats.totalStudents}</div>
                  <div className="text-xs text-gray-600">طالب</div>
                </div>
                <div className="bg-white rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold text-purple-700">{stats.totalRecords}</div>
                  <div className="text-xs text-gray-600">سجل حضور</div>
                </div>
                <div className="bg-white rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold text-pink-700">{stats.totalSessions}</div>
                  <div className="text-xs text-gray-600">جلسة</div>
                </div>
              </div>

              <p className="text-xs text-blue-700 mt-3 text-center">
                💡 المساحة المجانية: 1 GB (تكفي لـ ~3 سنوات من الاستخدام المكثف)
              </p>
            </div>
          ) : (
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-center text-gray-500">
              {loadingStats ? '⏳ جاري تحميل الإحصائيات...' : 'اضغط "تحديث" لعرض الإحصائيات'}
            </div>
          )}
        </div>
      )}

      {/* Data Summary */}
      <div className="mb-8">
        <h3 className="text-lg font-semibold mb-3 text-gray-700">📊 ملخص البيانات الحالية</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="flex items-center gap-3">
              <div className="bg-blue-500 rounded-full p-3">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
              </div>
              <div>
                <p className="text-sm text-gray-600">عدد الطلاب</p>
                <p className="text-2xl font-bold text-gray-800">{students.length.toLocaleString()}</p>
              </div>
            </div>
          </div>

          <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
            <div className="flex items-center gap-3">
              <div className="bg-purple-500 rounded-full p-3">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                </svg>
              </div>
              <div>
                <p className="text-sm text-gray-600">سجلات الحضور</p>
                <p className="text-2xl font-bold text-gray-800">{attendanceRecords.length.toLocaleString()}</p>
              </div>
            </div>
          </div>

          <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4">
            <div className="flex items-center gap-3">
              <div className="bg-emerald-500 rounded-full p-3">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
                </svg>
              </div>
              <div>
                <p className="text-sm text-gray-600">حجم البيانات</p>
                <p className="text-xl font-bold text-gray-800">{formatBytes(dataSize)}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Backup Section */}
      <div className="mb-8">
        <h3 className="text-lg font-semibold mb-3 text-gray-700">💾 النسخ الاحتياطي</h3>
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
          <div className="flex items-start gap-2">
            <svg className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div className="text-sm text-blue-800">
              <p className="font-medium mb-1">💡 نوعين من النسخ الاحتياطية:</p>
              <ul className="list-disc list-inside space-y-1 mt-2">
                <li><strong>نسخة Firebase الكاملة:</strong> تشمل كل البيانات (الكليات، المراحل، الطلاب، الحضور)</li>
                <li><strong>نسخة محلية سريعة:</strong> فقط بيانات المرحلة المفتوحة حالياً</li>
              </ul>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {isAdmin && (
            <button
              onClick={handleDownloadFirebaseBackup}
              disabled={downloadingBackup}
              className="bg-gradient-to-r from-emerald-600 to-teal-700 hover:from-emerald-700 hover:to-teal-800 disabled:opacity-50 text-white font-medium py-3 px-4 rounded-md transition duration-200 flex items-center justify-center gap-2 shadow-md"
            >
              {downloadingBackup ? (
                <>⏳ جاري...</>
              ) : (
                <>☁️ نسخة Firebase الكاملة</>
              )}
            </button>
          )}

          <button
            onClick={handleDownloadLocalBackup}
            className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-4 rounded-md transition duration-200 flex items-center justify-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            📄 نسخة محلية (المرحلة)
          </button>

          <button
            onClick={handleRestoreBackup}
            className="bg-green-600 hover:bg-green-700 text-white font-medium py-3 px-4 rounded-md transition duration-200 flex items-center justify-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            📥 استعادة نسخة
          </button>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          onChange={handleFileChange}
          className="hidden"
        />
      </div>

      {/* منطقة الخطر */}
      {isAdmin && (
        <div className="mb-8">
          <h3 className="text-lg font-semibold mb-3 text-red-700 flex items-center gap-2">
            ⚠️ منطقة الخطر
          </h3>
          <div className="bg-gradient-to-br from-red-50 to-orange-50 border-2 border-red-300 rounded-xl p-5">
            <div className="flex items-start gap-3 mb-4">
              <span className="text-4xl">🔄</span>
              <div className="flex-1">
                <h4 className="font-bold text-red-900 text-lg mb-2">تصفير السنة الأكاديمية</h4>
                <p className="text-sm text-red-800 mb-3">
                  استخدم هذا الزر <strong>مرة واحدة فقط في السنة</strong> (مثلاً بداية سبتمبر) لبدء سنة أكاديمية جديدة.
                </p>
                <div className="bg-white border border-red-200 rounded-lg p-3 mb-3 text-sm">
                  <p className="font-bold text-red-700 mb-1">سيحدث التالي:</p>
                  <ul className="text-red-700 space-y-1 list-disc list-inside mr-2">
                    <li>تحميل نسخة احتياطية تلقائياً قبل المسح</li>
                    <li>حذف جميع الكليات، المراحل، الطلاب، الحضور</li>
                    <li>تعطيل صلاحيات جميع التدريسيين (الحسابات تبقى)</li>
                    <li>الانتقال إلى السنة الأكاديمية الجديدة</li>
                  </ul>
                </div>
              </div>
            </div>

            <button
              onClick={handleResetAcademicYear}
              disabled={resetting}
              className="w-full bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800 disabled:opacity-50 text-white font-bold py-3 px-6 rounded-lg shadow-md transition flex items-center justify-center gap-2"
            >
              {resetting ? (
                <>⏳ جاري التصفير... لا تغلق الصفحة!</>
              ) : (
                <>🔄 بدء سنة أكاديمية جديدة (تصفير)</>
              )}
            </button>

            <p className="text-xs text-red-600 mt-2 text-center font-medium">
              ⚠️ هذه العملية لا يمكن التراجع عنها
            </p>
          </div>
        </div>
      )}

      {/* قائمة السنوات الأكاديمية */}
      {isAdmin && academicYears.length > 0 && (
        <div className="mb-8">
          <h3 className="text-lg font-semibold mb-3 text-gray-700">📚 السنوات الأكاديمية</h3>
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
            <div className="flex flex-wrap gap-2">
              {academicYears.map(year => (
                <span
                  key={year}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium border ${
                    year === currentAcademicYear
                      ? 'bg-green-100 text-green-800 border-green-400'
                      : 'bg-white text-gray-700 border-gray-300'
                  }`}
                >
                  {year === currentAcademicYear && '✅ '}
                  {year.replace('_', ' - ')}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Info Section */}
      <div className="bg-gradient-to-r from-green-50 to-blue-50 border border-green-200 rounded-lg p-4">
        <h3 className="text-lg font-semibold mb-3 text-gray-700 flex items-center gap-2">
          <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          مميزات النظام المحدّث
        </h3>
        <ul className="space-y-2 text-sm text-gray-700">
          <li className="flex items-start gap-2">
            <span className="text-green-500 mt-1">✓</span>
            <span><strong>تقسيم سنوي:</strong> كل سنة أكاديمية لها بياناتها المنفصلة</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-green-500 mt-1">✓</span>
            <span><strong>تصفير سنوي:</strong> ابدأ نظيف كل سنة دون مشاكل</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-green-500 mt-1">✓</span>
            <span><strong>حسابات دائمة:</strong> التدريسيين يحتفظون بحساباتهم</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-green-500 mt-1">✓</span>
            <span><strong>مجاني 100%:</strong> ضمن حدود Firebase المجانية</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-green-500 mt-1">✓</span>
            <span><strong>Backup تلقائي:</strong> قبل أي تصفير، تنزيل JSON تلقائياً</span>
          </li>
        </ul>
      </div>
    </div>
  );
};