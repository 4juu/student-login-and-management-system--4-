import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Student, AttendanceRecord, Stage, College } from '../types/student';
import { User } from '../types/user';
import { TelegramConfig } from '../types/telegram';
import {
  resetAcademicYear, 
  getDatabaseStats, 
  listAllAcademicYears,
  getCurrentAcademicYear,
  getNextAcademicYear,
  isValidAcademicYearFormat,
  saveTelegramConfig,
  loadTelegramConfig,
  saveSystemTitle,
} from '../firebase/dataService';
import {
  sendTestMessage,
  verifyBotToken,
} from '../services/telegramService';
import { Bot, CalendarDays, ChartColumn, CircleCheck, ClipboardList, GraduationCap, Info, KeyRound, Landmark, Library, LoaderCircle, Megaphone, RefreshCw, Save, Search, Send, Settings as SettingsIcon, Smile, SquarePen, TriangleAlert, User as UserIcon } from 'lucide-react';

interface SettingsProps {
  students: Student[];
  attendanceRecords: AttendanceRecord[];
  currentUser?: User;
  onResetComplete?: () => void;
  stages?: Stage[];
  colleges?: College[];
  onTelegramConfigChange?: (config: TelegramConfig | null) => void;
  systemTitle?: string;
  onSystemTitleChange?: (title: string) => void;
}

export const Settings: React.FC<SettingsProps> = ({
  currentUser,
  onResetComplete,
  stages = [],
  colleges = [],
  onTelegramConfigChange,
  systemTitle = '',
  onSystemTitleChange,
}) => {
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
  const [resetting, setResetting] = useState(false);
  const [newYearDraft, setNewYearDraft] = useState(getNextAcademicYear(getCurrentAcademicYear()));
  const [resetDialog, setResetDialog] = useState<
    | { type: 'confirm' }
    | { type: 'success'; oldYear: string; newYear: string }
    | { type: 'error'; message: string }
    | null
  >(null);
  const [resetTypedConfirm, setResetTypedConfirm] = useState('');

  // 🏛️ عنوان النظام (للأدمن الرئيسي فقط)
  const [systemTitleDraft, setSystemTitleDraft] = useState(systemTitle);
  const [systemTitleSaving, setSystemTitleSaving] = useState(false);
  const [systemTitleMessage, setSystemTitleMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // 🤖 Telegram
  const [telegramConfig, setTelegramConfig] = useState<TelegramConfig | null>(null);
  const [telegramBotToken, setTelegramBotToken] = useState('');
  const [telegramSaving, setTelegramSaving] = useState(false);
  const [telegramMessage, setTelegramMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [botVerified, setBotVerified] = useState(false);
  const [botUsername, setBotUsername] = useState('');

  const currentAcademicYear = getCurrentAcademicYear();
  const isAdmin = currentUser?.role === 'admin';

  const handleSystemTitleSave = async () => {
    const title = systemTitleDraft.trim();
    if (!title) {
      setSystemTitleMessage({ type: 'error', text: 'الرجاء إدخال عنوان النظام' });
      return;
    }
    setSystemTitleSaving(true);
    setSystemTitleMessage(null);
    try {
      await saveSystemTitle(title);
      onSystemTitleChange?.(title);
      setSystemTitleMessage({ type: 'success', text: 'تم حفظ عنوان النظام بنجاح' });
    } catch {
      setSystemTitleMessage({ type: 'error', text: 'فشل حفظ العنوان، حاول مجدداً' });
    } finally {
      setSystemTitleSaving(false);
    }
  };

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
      setTelegramMessage({ type: 'success', text: 'تم حفظ الإعدادات بنجاح!' });
    } catch (e: any) {
      setTelegramMessage({ type: 'error', text: 'فشل الحفظ: ' + (e.message || '') });
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
      setTelegramMessage({ type: 'success', text: `تم التحقق! البوت: @${result.username}` });
    } else {
      setBotVerified(false);
      setBotUsername('');
      setTelegramMessage({ type: 'error', text: (result.error || 'توكن غير صحيح') });
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
      setTelegramMessage({ type: 'success', text: 'تم إرسال رسالة اختبار للقناة!' });
    } else {
      setTelegramMessage({ type: 'error', text: 'فشل الإرسال. تأكد من Chat ID والبوت مضاف كأدمن في القناة' });
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

  const handleResetAcademicYear = () => {
    if (!currentUser || currentUser.role !== 'admin') return;

    const targetYear = newYearDraft.trim();

    if (!isValidAcademicYearFormat(targetYear)) {
      setResetDialog({ type: 'error', message: 'صيغة السنة غير صحيحة. مثال صحيح: 2025_2026' });
      return;
    }

    if (targetYear === currentAcademicYear) {
      setResetDialog({ type: 'error', message: 'يجب أن تختلف السنة الجديدة عن السنة الحالية' });
      return;
    }

    setResetTypedConfirm('');
    setResetDialog({ type: 'confirm' });
  };

  const confirmReset = async () => {
    if (!currentUser) return;
    setResetDialog(null);
    setResetting(true);
    try {
      const result = await resetAcademicYear(currentUser.uid, {
        newYear: newYearDraft.trim(),
      });

      setResetDialog({ type: 'success', oldYear: result.oldYear, newYear: result.newYear });
      onResetComplete?.();
    } catch (e: any) {
      setResetDialog({ type: 'error', message: (e.message || 'خطأ غير معروف') });
    } finally {
      setResetting(false);
    }
  };

  const closeResetDialog = () => {
    if (resetDialog?.type === 'success') {
      window.location.reload();
      return;
    }
    setResetDialog(null);
  };


  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <h2 className="text-2xl font-bold mb-6 text-gray-800 flex items-center gap-2"><SettingsIcon className="w-6 h-6" /> الإعدادات</h2>

      {/* شريط السنة الأكاديمية */}
      <div className="mb-6 p-4 bg-gradient-to-r from-indigo-50 to-purple-50 border-2 border-indigo-300 rounded-xl">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <GraduationCap className="w-9 h-9 text-indigo-600 shrink-0" />
            <div>
              <h3 className="font-bold text-indigo-900">السنة الأكاديمية الحالية</h3>
              <p className="text-2xl font-bold text-indigo-700">
                {currentAcademicYear.replace('_', ' - ')}
              </p>
            </div>
          </div>
          {academicYears.length > 0 && (
            <div className="text-sm text-indigo-700 bg-white px-3 py-2 rounded-lg border border-indigo-200 flex items-center gap-1.5">
              <Library className="w-4 h-4" /> {academicYears.length} سنة في النظام
            </div>
          )}
        </div>
      </div>

      {/* 🏛️ هوية النظام - للأدمن الرئيسي فقط */}
      {isAdmin && (
        <div className="mb-6 p-4 bg-gradient-to-r from-blue-50 to-cyan-50 border-2 border-blue-300 rounded-xl">
          <div className="flex items-center gap-3 mb-3">
            <Landmark className="w-9 h-9 text-blue-700 shrink-0" />
            <div>
              <h3 className="font-bold text-blue-900">هوية النظام</h3>
              <p className="text-sm text-blue-700">العنوان الظاهر في الترويسة الرسمية أعلى الموقع</p>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              value={systemTitleDraft}
              onChange={(e) => setSystemTitleDraft(e.target.value)}
              placeholder="نظام إدارة الحضور الجامعي"
              className="glass-input flex-1"
              maxLength={60}
            />
            <button
              onClick={handleSystemTitleSave}
              disabled={systemTitleSaving}
              className="btn-base btn-primary shrink-0 flex items-center justify-center gap-2"
            >
              {systemTitleSaving ? <><LoaderCircle className="w-4 h-4 animate-spin" /> جاري الحفظ...</> : <><Save className="w-4 h-4" /> حفظ العنوان</>}
            </button>
          </div>
          {systemTitleMessage && (
            <p className={`mt-2 text-sm ${systemTitleMessage.type === 'success' ? 'text-green-700' : 'text-red-600'}`}>
              {systemTitleMessage.text}
            </p>
          )}
        </div>
      )}

      {/* إحصائيات Firebase (للأدمن) */}
      {isAdmin && (
        <div className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-lg font-semibold text-gray-700 flex items-center gap-2"><ChartColumn className="w-5 h-5" /> استخدام Firebase</h3>
            <button
              onClick={loadStats}
              disabled={loadingStats}
              className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1.5"
            >
              {loadingStats ? <><LoaderCircle className="w-4 h-4 animate-spin" /> ...</> : <><RefreshCw className="w-4 h-4" /> تحديث</>}
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
                  <div className="text-xs text-gray-600 dark:text-gray-400 flex items-center justify-center gap-1"><UserIcon className="w-3.5 h-3.5" /> طالب</div>
                </div>
                <div className="bg-white dark:bg-gray-800 rounded-lg p-3 text-center shadow-sm">
                  <div className="text-2xl font-bold text-purple-700 dark:text-purple-400">{stats.totalRecords}</div>
                  <div className="text-xs text-gray-600 dark:text-gray-400 flex items-center justify-center gap-1"><SquarePen className="w-3.5 h-3.5" /> سجل حضور</div>
                </div>
                <div className="bg-white dark:bg-gray-800 rounded-lg p-3 text-center shadow-sm">
                  <div className="text-2xl font-bold text-pink-700 dark:text-pink-400">{stats.totalSessions}</div>
                  <div className="text-xs text-gray-600 dark:text-gray-400 flex items-center justify-center gap-1"><ClipboardList className="w-3.5 h-3.5" /> جلسة</div>
                </div>
                <div className="bg-white dark:bg-gray-800 rounded-lg p-3 text-center shadow-sm">
                  <div className="text-2xl font-bold text-emerald-700 dark:text-emerald-400">{stats.totalTeachers}</div>
                  <div className="text-xs text-gray-600 dark:text-gray-400 flex items-center justify-center gap-1"><GraduationCap className="w-3.5 h-3.5" /> مدرس</div>
                </div>
                <div className="bg-white dark:bg-gray-800 rounded-lg p-3 text-center shadow-sm">
                  <div className="text-2xl font-bold text-amber-700 dark:text-amber-400">{stats.totalFaceDescriptors}</div>
                  <div className="text-xs text-gray-600 dark:text-gray-400 flex items-center justify-center gap-1"><Smile className="w-3.5 h-3.5" /> بصمة وجه</div>
                </div>
              </div>


            </div>
          ) : (
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-center text-gray-500 flex items-center justify-center gap-2">
              {loadingStats ? <><LoaderCircle className="w-4 h-4 animate-spin" /> جاري تحميل الإحصائيات...</> : 'اضغط "تحديث" لعرض الإحصائيات'}
            </div>
          )}
        </div>
      )}



      {/* منطقة الخطر */}
      {isAdmin && (
        <div className="mb-8">
          <h3 className="text-lg font-semibold mb-3 text-red-700 flex items-center gap-2">
            <TriangleAlert className="w-5 h-5" /> منطقة الخطر
          </h3>
          <div className="bg-gradient-to-br from-red-50 to-orange-50 border-2 border-red-300 rounded-xl p-5">
            <div className="flex items-start gap-3 mb-4">
              <RefreshCw className="w-10 h-10 text-red-600 shrink-0" />
              <div className="flex-1">
                <h4 className="font-bold text-red-900 text-lg mb-2">بدء سنة أكاديمية جديدة</h4>
                <div className="bg-white border border-red-200 rounded-lg p-3 text-sm">
                  <p className="text-red-700 flex items-start gap-2">
                    <TriangleAlert className="w-4 h-4 shrink-0 mt-0.5" />
                    ملاحظة: سيتم حذف جميع الطلاب وسجلات الحضور فقط، وتبقى الكليات والمراحل والتدريسيون.
                  </p>
                </div>
              </div>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-bold text-red-800 mb-2 flex items-center gap-1.5">
                <CalendarDays className="w-4 h-4" /> السنة الجديدة (قابلة للتعديل)
              </label>
              <input
                type="text"
                value={newYearDraft}
                onChange={(e) => setNewYearDraft(e.target.value)}
                placeholder={getNextAcademicYear(currentAcademicYear)}
                dir="ltr"
                className="w-full px-3 sm:px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-red-500 font-mono text-sm text-center"
              />
              <p className="text-xs text-red-600 mt-1.5">الصيغة: 2025_2026</p>
            </div>

            <button
              onClick={handleResetAcademicYear}
              disabled={resetting}
              className="w-full bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800 disabled:opacity-50 text-white font-bold py-3 px-6 rounded-lg shadow-md transition flex items-center justify-center gap-2"
            >
              {resetting ? (
                <><LoaderCircle className="w-5 h-5 animate-spin" /> جاري البدء... لا تغلق الصفحة!</>
              ) : (
                <><RefreshCw className="w-5 h-5" /> بدء سنة أكاديمية جديدة</>
              )}
            </button>

            <p className="text-xs text-red-600 mt-2 text-center font-medium flex items-center justify-center gap-1.5">
              <TriangleAlert className="w-3.5 h-3.5" /> هذه العملية لا يمكن التراجع عنها
            </p>
          </div>
        </div>
      )}

      {/* قائمة السنوات الأكاديمية */}
      {isAdmin && academicYears.length > 0 && (
        <div className="mb-8">
          <h3 className="text-lg font-semibold mb-3 text-gray-700 flex items-center gap-2"><Library className="w-5 h-5" /> السنوات الأكاديمية</h3>
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
                  {year === currentAcademicYear && <CircleCheck className="w-4 h-4 text-green-600 inline-block align-middle ml-1" />}
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
          <Bot className="w-5 h-5" /> بوت التلغرام (إشعارات الحضور)
        </h3>

        <div className="bg-gradient-to-br from-sky-50 to-blue-50 border-2 border-sky-300 rounded-xl p-4 sm:p-5 mb-4">
          <div className="flex items-start gap-2 sm:gap-3 mb-4">
            <Megaphone className="w-8 h-8 sm:w-10 sm:h-10 text-sky-600 shrink-0" />
            <div className="flex-1 min-w-0">
              <h4 className="font-bold text-sky-900 text-base sm:text-lg mb-1">إعدادات البوت</h4>
              <p className="text-xs sm:text-sm text-sky-700">
                أرسل إشعارات الحضور والغياب تلقائياً إلى قنوات التلغرام لكل مادة
              </p>
            </div>
          </div>

          <div className="bg-white border border-sky-200 rounded-lg p-3 sm:p-4 mb-4">
            <label className="block text-xs sm:text-sm font-bold text-gray-700 mb-2 flex items-center gap-1.5"><KeyRound className="w-4 h-4" /> توكن البوت (Bot Token)</label>
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
                className="bg-sky-600 hover:bg-sky-700 text-white font-medium py-2 px-4 rounded-md transition text-sm sm:text-base flex items-center justify-center gap-2"
              >
                <Search className="w-4 h-4" /> تحقق
              </button>
            </div>
            {botVerified && (
              <p className="text-xs sm:text-sm text-green-700 mt-2 font-medium flex items-center gap-1.5"><CircleCheck className="w-4 h-4" /> البوت موثوق: @{botUsername}</p>
            )}
            <div className="mt-2 bg-gray-50 border border-gray-200 rounded-lg p-2 sm:p-3 text-[10px] sm:text-xs text-gray-600">
              <p className="font-bold mb-1 flex items-center gap-1.5"><Info className="w-4 h-4" /> كيفية الحصول على التوكن:</p>
              <ol className="list-decimal list-inside space-y-1 mr-2">
                <li>افتح <a href="https://t.me/BotFather" target="_blank" className="text-blue-600 underline">@BotFather</a> في تلغرام</li>
                <li>أرسل <code className="bg-gray-200 px-1 rounded">/newbot</code> واتبع التعليمات</li>
                <li>انسخ التوكن وألصقه هنا</li>
              </ol>
            </div>
          </div>

          {/* ربط القنوات */}
          <div className="bg-white border border-sky-200 rounded-lg p-3 sm:p-4">
            <h4 className="font-bold text-gray-700 mb-3 text-sm sm:text-base flex items-center gap-2"><Megaphone className="w-4 h-4 text-sky-600" /> ربط القنوات حسب المادة</h4>
            <p className="text-[10px] sm:text-xs text-gray-500 mb-3">
              لكل مادة (مرحلة)، أدخل Chat ID القناة الخاصة بها
            </p>

            {stages.length === 0 ? (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-xs sm:text-sm text-yellow-700 text-center flex items-center justify-center gap-2">
                <TriangleAlert className="w-4 h-4 shrink-0" /> لا توجد مراحل مضافة. أضف المراحل أولاً من صفحة إدارة الكليات.
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
                          <span className="text-lg shrink-0">{college?.icon || <Library className="w-4 h-4" />}</span>
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
                          className="bg-green-600 hover:bg-green-700 disabled:opacity-40 text-white text-xs font-medium px-3 py-1.5 rounded-md transition flex items-center gap-1.5"
                        >
                          <Send className="w-3.5 h-3.5" /> اختبار
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
                <p className="font-bold mb-1 flex items-center gap-1.5"><Info className="w-4 h-4" /> كيفية الحصول على Chat ID:</p>
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
              <><LoaderCircle className="w-5 h-5 animate-spin" /> جاري الحفظ...</>
            ) : (
              <><Save className="w-5 h-5" /> حفظ إعدادات التلغرام</>
            )}
          </button>
        </div>
      </div>

      {/* 📋 نافذة تأكيد داخلية (بدل window.confirm/prompt التي تتجمد على الجوال) */}
      {resetDialog && createPortal(
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4"
          onClick={() => resetDialog.type !== 'success' && setResetDialog(null)}
        >
          <div
            className="modal-panel bg-white rounded-xl shadow-2xl max-w-sm w-full overflow-y-auto p-6 text-center"
            onClick={e => e.stopPropagation()}
            dir="rtl"
          >
            {resetDialog.type === 'confirm' && (
              <>
                <h3 className="text-lg font-bold text-gray-800 mb-2">تحذير خطير</h3>
                <p className="text-sm text-gray-600 mb-4 whitespace-pre-line text-right">
                  {`السنة الجديدة: ${newYearDraft}\n\n` +
                   `سيتم حذف جميع الطلاب وسجلات الحضور والجلسات\n` +
                   `سيتم تعطيل صلاحيات جميع التدريسيين (الحسابات تبقى)\n\n` +
                   `ما سيبقى:\n` +
                   `الكليات والمراحل كما هي\n` +
                   `حسابك (الأدمن) وحسابات التدريسيين`}
                </p>
                <label className="block text-xs font-bold text-gray-700 mb-2 text-right">
                  للتأكيد النهائي، اكتب: "تصفير"
                </label>
                <input
                  type="text"
                  value={resetTypedConfirm}
                  onChange={e => setResetTypedConfirm(e.target.value)}
                  placeholder="تصفير"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-red-500 text-sm text-center mb-4"
                />
                <div className="flex gap-2">
                  <button
                    onClick={confirmReset}
                    disabled={resetTypedConfirm !== 'تصفير' || resetting}
                    className="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-bold py-3 px-4 rounded-lg transition"
                  >
                    {resetting ? 'جاري التنفيذ...' : 'تأكيد التنفيذ'}
                  </button>
                  <button
                    onClick={() => setResetDialog(null)}
                    className="bg-gray-200 hover:bg-gray-300 text-gray-700 font-medium py-3 px-4 rounded-lg transition"
                  >
                    إلغاء
                  </button>
                </div>
              </>
            )}

            {resetDialog.type === 'success' && (
              <>
                <h3 className="text-lg font-bold text-green-700 mb-2">تم بدء السنة الجديدة بنجاح!</h3>
                <p className="text-sm text-gray-600 mb-6 whitespace-pre-line text-right">
                  {`السنة السابقة: ${resetDialog.oldYear}\n` +
                   `السنة الجديدة: ${resetDialog.newYear}\n\n` +
                   `تم حذف الطلاب وسجلات الحضور\n` +
                   `تم تعطيل صلاحيات التدريسيين`}
                </p>
                <button
                  onClick={closeResetDialog}
                  className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-4 rounded-lg transition"
                >
                  إعادة تحميل الصفحة
                </button>
              </>
            )}

            {resetDialog.type === 'error' && (
              <>
                <h3 className="text-lg font-bold text-red-700 mb-2">فشل العملية</h3>
                <p className="text-sm text-gray-600 mb-6 whitespace-pre-line">{resetDialog.message}</p>
                <button
                  onClick={() => setResetDialog(null)}
                  className="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-4 rounded-lg transition"
                >
                  إغلاق
                </button>
              </>
            )}
          </div>
        </div>,
        document.body
      )}

    </div>
  );
};