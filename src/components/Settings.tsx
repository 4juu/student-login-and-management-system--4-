import React, { useRef, useState, useEffect } from 'react';
import { Student, AttendanceRecord, Stage, College } from '../types/student';
import { User } from '../types/user';
import { TelegramConfig } from '../types/telegram';
import { 
  downloadBackup, 
  resetAcademicYear, 
  getDatabaseStats, 
  listAllAcademicYears,
  getCurrentAcademicYear,
  saveTelegramConfig,
  loadTelegramConfig,
  flushAllPendingSaves,
} from '../firebase/dataService';
import {
  sendTestMessage,
  verifyBotToken,
} from '../services/telegramService';
import { database } from '../firebase/config';
import { ref, set } from 'firebase/database';

interface SettingsProps {
  students: Student[];
  attendanceRecords: AttendanceRecord[];
  onDataRestored: () => void;
  currentUser?: User;
  onResetComplete?: () => void;
  stages?: Stage[];
  colleges?: College[];
  onTelegramConfigChange?: (config: TelegramConfig | null) => void;
}

export const Settings: React.FC<SettingsProps> = ({
  students,
  attendanceRecords,
  onDataRestored,
  currentUser,
  onResetComplete,
  stages = [],
  colleges = [],
  onTelegramConfigChange,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [stats, setStats] = useState<{
    academicYear: string;
    totalSizeKB: number;
    totalStudents: number;
    totalRecords: number;
    totalSessions: number;
    totalTeachers: number;
    totalFaceDescriptors: number;
  } | null>(null);
  const [academicYears, setAcademicYears] = useState<string[]>([]);
  const [loadingStats, setLoadingStats] = useState(false);
  const [downloadingBackup, setDownloadingBackup] = useState(false);
  const [resetting, setResetting] = useState(false);

  // 🤖 Telegram
  const [telegramConfig, setTelegramConfig] = useState<TelegramConfig | null>(null);
  const [telegramBotToken, setTelegramBotToken] = useState('');
  const [telegramSaving, setTelegramSaving] = useState(false);
  const [telegramMessage, setTelegramMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [botVerified, setBotVerified] = useState(false);
  const [botUsername, setBotUsername] = useState('');

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

  // 🤖 تحميل تهيئة التلغرام
  useEffect(() => {
    if (!currentUser) return;
    loadTelegramConfig(getAdminUid()).then(config => {
      if (config) {
        setTelegramConfig(config);
        setTelegramBotToken(config.botToken);
        if (config.botToken) {
          verifyBotToken(config.botToken).then(r => {
            if (r.ok) { setBotVerified(true); setBotUsername(r.username || ''); }
          });
        }
      }
    });
  }, [currentUser]);

  const getAdminUid = (): string => {
    if (!currentUser) return '';
    if (currentUser.role === 'admin') return currentUser.uid;
    return currentUser.adminId || currentUser.uid;
  };

  const handleTelegramSave = async () => {
    if (!currentUser) return;
    if (!telegramBotToken.trim()) {
      setTelegramMessage({ type: 'error', text: 'الرجاء إدخال توكن البوت' });
      return;
    }
    setTelegramSaving(true);
    setTelegramMessage(null);
    try {
      const config: TelegramConfig = telegramConfig || {
        botToken: telegramBotToken.trim(),
        channels: {},
        updatedAt: new Date().toISOString(),
      };
      config.botToken = telegramBotToken.trim();
      config.updatedAt = new Date().toISOString();
      await saveTelegramConfig(getAdminUid(), config);
      setTelegramConfig(config);
      onTelegramConfigChange?.(config);
      setTelegramMessage({ type: 'success', text: '✅ تم حفظ الإعدادات بنجاح!' });
    } catch (e: any) {
      setTelegramMessage({ type: 'error', text: '❌ فشل الحفظ: ' + (e.message || '') });
    } finally {
      setTelegramSaving(false);
    }
  };

  const handleVerifyBot = async () => {
    if (!telegramBotToken.trim()) {
      setTelegramMessage({ type: 'error', text: 'الرجاء إدخال التوكن أولاً' });
      return;
    }
    setTelegramMessage(null);
    const result = await verifyBotToken(telegramBotToken.trim());
    if (result.ok) {
      setBotVerified(true);
      setBotUsername(result.username || '');
      setTelegramMessage({ type: 'success', text: `✅ تم التحقق! البوت: @${result.username}` });
    } else {
      setBotVerified(false);
      setBotUsername('');
      setTelegramMessage({ type: 'error', text: '❌ ' + (result.error || 'توكن غير صحيح') });
    }
  };

  const channelDefaults = {
    enabled: true,
    notifyOnAttendance: false,
    notifyOnAbsence: true,
    sendDailyReport: false,
  };

  const getTelegramConfig = () => telegramConfig || {
    botToken: telegramBotToken,
    channels: {},
    updatedAt: new Date().toISOString(),
  };

  const handleChannelToggle = (stageId: string, field: keyof typeof channelDefaults, value: boolean) => {
    setTelegramConfig(prev => {
      const config = prev || getTelegramConfig();
      return {
        ...config,
        channels: {
          ...config.channels,
          [stageId]: {
            ...config.channels[stageId],
            [field]: value,
          },
        },
      };
    });
  };

  const handleChannelChatId = (stageId: string, chatId: string) => {
    setTelegramConfig(prev => {
      const config = prev || getTelegramConfig();
      const stage = stages.find(s => s.id === stageId);
      return {
        ...config,
        channels: {
          ...config.channels,
          [stageId]: {
            ...channelDefaults,
            ...config.channels[stageId],
            chatId,
            stageName: stage?.name || stageId,
          },
        },
      };
    });
  };

  const handleTestChannel = async (stageId: string) => {
    if (!telegramConfig) return;
    setTelegramMessage(null);
    const ok = await sendTestMessage(telegramConfig, stageId);
    if (ok) {
      setTelegramMessage({ type: 'success', text: '✅ تم إرسال رسالة اختبار للقناة!' });
    } else {
      setTelegramMessage({ type: 'error', text: '❌ فشل الإرسال. تأكد من Chat ID والبوت مضاف كأدمن في القناة' });
    }
  };

  const hasTelegramChanges = (): boolean => {
    if (!telegramConfig) return !!telegramBotToken.trim();
    return telegramConfig.botToken !== telegramBotToken.trim();
  };

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

  const handleRestoreBackup = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      const content = e.target?.result as string;
      if (content) {
        try {
          const backup = JSON.parse(content);
          
          if (backup.data && backup.academicYear && backup.adminUid) {
            // ✅ تنسيق نسخة Firebase الكاملة
            const confirmed = window.confirm(
              `هل أنت متأكد من استعادة النسخة الاحتياطية (${backup.academicYear})؟\n` +
              `سيتم استبدال جميع البيانات في Firebase بهذه النسخة.`
            );
            if (!confirmed) return;

            // 🔄 تصريف أي عمليات حفظ معلقة قد تكتب بيانات قديمة بعد الاستعادة
            await flushAllPendingSaves();

            // 🗑️ مسح الكاش المحلي لمنع إرجاع بيانات قديمة
            const uid = backup.adminUid;
            Object.keys(localStorage).forEach(key => {
              if (
                key.startsWith(`colleges_${uid}`) ||
                key.startsWith(`stages_${uid}`) ||
                key.startsWith(`students_${uid}_`) ||
                key.startsWith(`records_${uid}_`) ||
                key.startsWith(`sessions_${uid}_`) ||
                key.startsWith(`activeSession_${uid}_`)
              ) {
                localStorage.removeItem(key);
              }
            });

            await set(ref(database, `academicYears/${backup.academicYear}/userData/${backup.adminUid}`), backup.data);
            alert('✅ تم استعادة النسخة الاحتياطية بنجاح! سيتم تحديث الصفحة...');
            window.location.reload();
          } else if (backup.students || backup.attendanceRecords) {
            alert('⚠️ هذا التنسيق قديم (نسخة محلية). استخدم نسخة Firebase الكاملة للاستعادة.');
          } else {
            alert('❌ تنسيق ملف غير معروف');
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
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <div className="bg-white dark:bg-gray-800 rounded-lg p-3 text-center shadow-sm">
                  <div className="text-2xl font-bold text-blue-700 dark:text-blue-400">{stats.totalStudents}</div>
                  <div className="text-xs text-gray-600 dark:text-gray-400">👤 طالب</div>
                </div>
                <div className="bg-white dark:bg-gray-800 rounded-lg p-3 text-center shadow-sm">
                  <div className="text-2xl font-bold text-purple-700 dark:text-purple-400">{stats.totalRecords}</div>
                  <div className="text-xs text-gray-600 dark:text-gray-400">📝 سجل حضور</div>
                </div>
                <div className="bg-white dark:bg-gray-800 rounded-lg p-3 text-center shadow-sm">
                  <div className="text-2xl font-bold text-pink-700 dark:text-pink-400">{stats.totalSessions}</div>
                  <div className="text-xs text-gray-600 dark:text-gray-400">📋 جلسة</div>
                </div>
                <div className="bg-white dark:bg-gray-800 rounded-lg p-3 text-center shadow-sm">
                  <div className="text-2xl font-bold text-emerald-700 dark:text-emerald-400">{stats.totalTeachers}</div>
                  <div className="text-xs text-gray-600 dark:text-gray-400">👨‍🏫 مدرس</div>
                </div>
                <div className="bg-white dark:bg-gray-800 rounded-lg p-3 text-center shadow-sm">
                  <div className="text-2xl font-bold text-amber-700 dark:text-amber-400">{stats.totalFaceDescriptors}</div>
                  <div className="text-xs text-gray-600 dark:text-gray-400">😊 بصمة وجه</div>
                </div>
              </div>


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
                <p className="text-2xl font-bold text-gray-800">{(stats?.totalStudents ?? students.length).toLocaleString()}</p>
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
                <p className="text-2xl font-bold text-gray-800">{(stats?.totalRecords ?? attendanceRecords.length).toLocaleString()}</p>
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
                <p className="text-xl font-bold text-gray-800">{stats ? formatSize(stats.totalSizeKB) : formatBytes(dataSize)}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Backup Section */}
      <div className="mb-8">
        <h3 className="text-lg font-semibold mb-3 text-gray-700">💾 النسخ الاحتياطي</h3>
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

      {/* 🤖 قسم التلغرام */}
      <div className="mb-8">
        <h3 className="text-base sm:text-lg font-semibold mb-3 text-gray-700 flex items-center gap-2">
          🤖 بوت التلغرام (إشعارات الحضور)
        </h3>

        <div className="bg-gradient-to-br from-sky-50 to-blue-50 border-2 border-sky-300 rounded-xl p-4 sm:p-5 mb-4">
          <div className="flex items-start gap-2 sm:gap-3 mb-4">
            <span className="text-2xl sm:text-4xl">📢</span>
            <div className="flex-1 min-w-0">
              <h4 className="font-bold text-sky-900 text-base sm:text-lg mb-1">إعدادات البوت</h4>
              <p className="text-xs sm:text-sm text-sky-700">
                أرسل إشعارات الحضور والغياب تلقائياً إلى قنوات التلغرام لكل مادة
              </p>
            </div>
          </div>

          <div className="bg-white border border-sky-200 rounded-lg p-3 sm:p-4 mb-4">
            <label className="block text-xs sm:text-sm font-bold text-gray-700 mb-2">🔑 توكن البوت (Bot Token)</label>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={telegramBotToken}
                onChange={e => { setTelegramBotToken(e.target.value); setBotVerified(false); setTelegramMessage(null); }}
                placeholder="1234567890:ABCdefGHIjklMNOpqrsTUVwxyz"
                className="flex-1 px-3 sm:px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-sky-500 font-mono text-xs sm:text-sm"
                dir="ltr"
              />
              <button
                onClick={handleVerifyBot}
                className="bg-sky-600 hover:bg-sky-700 text-white font-medium py-2 px-4 rounded-md transition text-sm sm:text-base"
              >
                🔍 تحقق
              </button>
            </div>
            {botVerified && (
              <p className="text-xs sm:text-sm text-green-700 mt-2 font-medium">✅ البوت موثوق: @{botUsername}</p>
            )}
            <div className="mt-2 bg-gray-50 border border-gray-200 rounded-lg p-2 sm:p-3 text-[10px] sm:text-xs text-gray-600">
              <p className="font-bold mb-1">📌 كيفية الحصول على التوكن:</p>
              <ol className="list-decimal list-inside space-y-1 mr-2">
                <li>افتح <a href="https://t.me/BotFather" target="_blank" className="text-blue-600 underline">@BotFather</a> في تلغرام</li>
                <li>أرسل <code className="bg-gray-200 px-1 rounded">/newbot</code> واتبع التعليمات</li>
                <li>انسخ التوكن وألصقه هنا</li>
              </ol>
            </div>
          </div>

          {/* ربط القنوات */}
          <div className="bg-white border border-sky-200 rounded-lg p-3 sm:p-4">
            <h4 className="font-bold text-gray-700 mb-3 text-sm sm:text-base">📡 ربط القنوات حسب المادة</h4>
            <p className="text-[10px] sm:text-xs text-gray-500 mb-3">
              لكل مادة (مرحلة)، أدخل Chat ID القناة الخاصة بها
            </p>

            {stages.length === 0 ? (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-xs sm:text-sm text-yellow-700 text-center">
                ⚠️ لا توجد مراحل مضافة. أضف المراحل أولاً من صفحة إدارة الكليات.
              </div>
            ) : (
              <div className="space-y-3 max-h-80 overflow-y-auto">
                {stages.map(stage => {
                  const college = colleges.find(c => c.id === stage.collegeId);
                  const channel = telegramConfig?.channels[stage.id];
                  const chatId = channel?.chatId || '';

                  return (
                    <div key={stage.id} className="border border-gray-200 rounded-lg p-3 hover:border-sky-300 transition">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-lg shrink-0">{college?.icon || '📚'}</span>
                          <div className="min-w-0">
                            <span className="font-bold text-gray-800 text-sm sm:text-base truncate block">{stage.name}</span>
                            {college && (
                              <span className="text-[10px] sm:text-xs text-gray-500 block truncate">{college.name}</span>
                            )}
                          </div>
                        </div>
                        <label className="flex items-center gap-1 text-[10px] sm:text-xs shrink-0">
                          <input
                            type="checkbox"
                            checked={channel?.enabled ?? false}
                            onChange={e => handleChannelToggle(stage.id, 'enabled', e.target.checked)}
                            className="accent-sky-600"
                          />
                          مفعّل
                        </label>
                      </div>
                      <div className="flex flex-col sm:flex-row gap-2">
                        <input
                          type="text"
                          value={chatId}
                          onChange={e => handleChannelChatId(stage.id, e.target.value)}
                          placeholder="-1001234567890"
                          className="flex-1 px-3 py-1.5 border border-gray-300 rounded-md text-xs sm:text-sm font-mono focus:ring-2 focus:ring-sky-500"
                          dir="ltr"
                        />
                        <button
                          onClick={() => handleTestChannel(stage.id)}
                          disabled={!chatId || !telegramConfig?.botToken}
                          className="bg-green-600 hover:bg-green-700 disabled:opacity-40 text-white text-xs font-medium px-3 py-1.5 rounded-md transition"
                        >
                          📨 اختبار
                        </button>
                      </div>
                      {chatId && (
                        <div className="flex flex-wrap gap-2 sm:gap-3 mt-2 text-[10px] sm:text-xs text-gray-500">
                          <label className="flex items-center gap-1">
                            <input type="checkbox" checked={channel?.notifyOnAbsence ?? true}
                              onChange={e => handleChannelToggle(stage.id, 'notifyOnAbsence', e.target.checked)}
                              className="accent-sky-600 w-3 h-3" />
                            غياب
                          </label>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {stages.length > 0 && (
              <div className="mt-3 bg-gray-50 border border-gray-200 rounded-lg p-2 sm:p-3 text-[10px] sm:text-xs text-gray-600">
                <p className="font-bold mb-1">📌 كيفية الحصول على Chat ID:</p>
                <ol className="list-decimal list-inside space-y-1 mr-2">
                  <li>أضف البوت كأدمن في القناة</li>
                  <li>أرسل رسالة في القناة</li>
                  <li>افتح <a href="https://t.me/GetChatID_Bot" target="_blank" className="text-blue-600 underline">@GetChatID_Bot</a></li>
                  <li>انسخ الرقم (يبدأ بـ -100) وألصقه هنا</li>
                </ol>
              </div>
            )}
          </div>

          {telegramMessage && (
            <div className={`mt-3 p-3 rounded-lg text-xs sm:text-sm font-medium ${
              telegramMessage.type === 'success'
                ? 'bg-green-100 text-green-800 border border-green-300'
                : 'bg-red-100 text-red-800 border border-red-300'
            }`}>
              {telegramMessage.text}
            </div>
          )}

          <button
            onClick={handleTelegramSave}
            disabled={telegramSaving || !hasTelegramChanges()}
            className="mt-4 w-full bg-gradient-to-r from-sky-600 to-blue-700 hover:from-sky-700 hover:to-blue-800 disabled:opacity-50 text-white font-bold py-2.5 sm:py-3 px-4 sm:px-6 rounded-lg shadow-md transition flex items-center justify-center gap-2 text-sm sm:text-base"
          >
            {telegramSaving ? (
              <>⏳ جاري الحفظ...</>
            ) : (
              <>💾 حفظ إعدادات التلغرام</>
            )}
          </button>
        </div>
      </div>

    </div>
  );
};