import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useModalBehavior } from '../hooks/useModalBehavior';
import { Stage, College } from '../types/student';
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
  saveSystemTitle,
} from '../firebase/dataService';
import {
  sendTestMessage,
  verifyBotToken,
} from '../services/telegramService';
import { Bot, CalendarDays, ChartColumn, CircleCheck, ClipboardList, GraduationCap, Info, KeyRound, Landmark, Library, Megaphone, RefreshCw, Save, Search, Send, Settings as SettingsIcon, Smile, SquarePen, TriangleAlert, User as UserIcon } from 'lucide-react';
import { MorphingSquare } from './MorphingSquare';

interface SettingsProps {
  currentUser?: User;
  onResetComplete?: () => void;
  stages?: Stage[];
  colleges?: College[];
  onTelegramConfigChange?: (config: TelegramConfig | null) => void;
  initialTelegramConfig?: TelegramConfig | null;
  systemTitle?: string;
  onSystemTitleChange?: (title: string) => void;
}

export const Settings: React.FC<SettingsProps> = React.memo(({
  currentUser,
  onResetComplete,
  stages = [],
  colleges = [],
  onTelegramConfigChange,
  initialTelegramConfig = null,
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

  const modalBehaviorRef = useModalBehavior({
    open: !!resetDialog,
    onClose: () => { if (resetDialog?.type !== 'success') setResetDialog(null); },
  });

  // ðŸ›ï¸ Ø¹Ù†ÙˆØ§Ù† Ø§Ù„Ù†Ø¸Ø§Ù… (Ù„Ù„Ø£Ø¯Ù…Ù† Ø§Ù„Ø±Ø¦ÙŠØ³ÙŠ ÙÙ‚Ø·)
  const [systemTitleDraft, setSystemTitleDraft] = useState(systemTitle);
  const [systemTitleSaving, setSystemTitleSaving] = useState(false);
  const [systemTitleMessage, setSystemTitleMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // ðŸ¤– Telegram
  const [telegramConfig, setTelegramConfig] = useState<TelegramConfig | null>(null);
  const [telegramBotToken, setTelegramBotToken] = useState('');
  const [telegramSaving, setTelegramSaving] = useState(false);
  const [telegramMessage, setTelegramMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [botVerified, setBotVerified] = useState(false);
  const [botUsername, setBotUsername] = useState('');

  const currentAcademicYear = useMemo(() => getCurrentAcademicYear(), []);
  const isAdmin = useMemo(() => currentUser?.role === 'admin', [currentUser?.role]);

  const handleSystemTitleSave = useCallback(async () => {
    const title = systemTitleDraft.trim();
    if (!title) {
      setSystemTitleMessage({ type: 'error', text: 'Ø§Ù„Ø±Ø¬Ø§Ø¡ Ø¥Ø¯Ø®Ø§Ù„ Ø¹Ù†ÙˆØ§Ù† Ø§Ù„Ù†Ø¸Ø§Ù…' });
      return;
    }
    setSystemTitleSaving(true);
    setSystemTitleMessage(null);
    try {
      await saveSystemTitle(title);
      onSystemTitleChange?.(title);
      setSystemTitleMessage({ type: 'success', text: 'ØªÙ… Ø­ÙØ¸ Ø¹Ù†ÙˆØ§Ù† Ø§Ù„Ù†Ø¸Ø§Ù… Ø¨Ù†Ø¬Ø§Ø­' });
    } catch {
      setSystemTitleMessage({ type: 'error', text: 'ÙØ´Ù„ Ø­ÙØ¸ Ø§Ù„Ø¹Ù†ÙˆØ§Ù†ØŒ Ø­Ø§ÙˆÙ„ Ù…Ø¬Ø¯Ø¯Ø§Ù‹' });
    } finally {
      setSystemTitleSaving(false);
    }
  }, [systemTitleDraft, onSystemTitleChange]);

  // âœ… Ø¯Ø§Ù„Ø© Ø¹Ø±Ø¶ Ø§Ù„Ø­Ø¬Ù… Ø¨Ø´ÙƒÙ„ Ø°ÙƒÙŠ
  const formatSize = useCallback((kb: number): string => {
    if (kb < 1024) {
      return `${kb.toFixed(1)} KB`;
    } else if (kb < 1024 * 1024) {
      return `${(kb / 1024).toFixed(2)} MB`;
    } else {
      return `${(kb / (1024 * 1024)).toFixed(2)} GB`;
    }
  }, []);

  // âœ… Ø­Ø³Ø§Ø¨ ØµØ­ÙŠØ­ Ù„Ù„Ù†Ø³Ø¨Ø© (ØªØ­ÙˆÙŠÙ„ Ø§Ù„ÙˆØ­Ø¯Ø§Øª)
  const firebaseQuotaMB = 1024;
  const firebaseQuotaKB = firebaseQuotaMB * 1024;
  const usagePercent = useMemo(() => stats ? (stats.totalSizeKB / firebaseQuotaKB) * 100 : 0, [stats?.totalSizeKB]);

  // ðŸ¤– ØªÙ‡ÙŠØ¦Ø© Ø§Ù„ØªÙ„ØºØ±Ø§Ù… Ù…Ù† Ø§Ù„Ù…ØªØ¬Ø± (ØªÙØ­Ù…ÙŽÙ‘Ù„ Ù…Ø±Ø© ÙˆØ§Ø­Ø¯Ø© ÙÙŠ loadInitialData) â€” Ø¨Ù„Ø§ Ø¬Ù„Ø¨ Ù…ÙƒØ±Ø±
  useEffect(() => {
    if (initialTelegramConfig) {
      setTelegramConfig(initialTelegramConfig);
      setTelegramBotToken(initialTelegramConfig.botToken);
      if (initialTelegramConfig.botToken) {
        verifyBotToken(initialTelegramConfig.botToken).then(r => {
          if (r.ok) { setBotVerified(true); setBotUsername(r.username || ''); }
        });
      }
    }
  }, [initialTelegramConfig]);

  const getAdminUid = useCallback((): string => {
    if (!currentUser) return '';
    if (currentUser.role === 'admin') return currentUser.uid;
    return currentUser.adminId || currentUser.uid;
  }, [currentUser]);

  const handleTelegramSave = useCallback(async () => {
    if (!currentUser) return;
    if (!telegramBotToken.trim()) {
      setTelegramMessage({ type: 'error', text: 'Ø§Ù„Ø±Ø¬Ø§Ø¡ Ø¥Ø¯Ø®Ø§Ù„ ØªÙˆÙƒÙ† Ø§Ù„Ø¨ÙˆØª' });
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
      setTelegramMessage({ type: 'success', text: 'ØªÙ… Ø­ÙØ¸ Ø§Ù„Ø¥Ø¹Ø¯Ø§Ø¯Ø§Øª Ø¨Ù†Ø¬Ø§Ø­!' });
    } catch (e: any) {
      setTelegramMessage({ type: 'error', text: 'ÙØ´Ù„ Ø§Ù„Ø­ÙØ¸: ' + (e.message || '') });
    } finally {
      setTelegramSaving(false);
    }
  }, [currentUser, telegramBotToken, telegramConfig, getAdminUid, onTelegramConfigChange]);

  const handleVerifyBot = useCallback(async () => {
    if (!telegramBotToken.trim()) {
      setTelegramMessage({ type: 'error', text: 'Ø§Ù„Ø±Ø¬Ø§Ø¡ Ø¥Ø¯Ø®Ø§Ù„ Ø§Ù„ØªÙˆÙƒÙ† Ø£ÙˆÙ„Ø§Ù‹' });
      return;
    }
    setTelegramMessage(null);
    const result = await verifyBotToken(telegramBotToken.trim());
    if (result.ok) {
      setBotVerified(true);
      setBotUsername(result.username || '');
      setTelegramMessage({ type: 'success', text: `ØªÙ… Ø§Ù„ØªØ­Ù‚Ù‚! Ø§Ù„Ø¨ÙˆØª: @${result.username}` });
    } else {
      setBotVerified(false);
      setBotUsername('');
      setTelegramMessage({ type: 'error', text: (result.error || 'ØªÙˆÙƒÙ† ØºÙŠØ± ØµØ­ÙŠØ­') });
    }
  }, [telegramBotToken]);

  const channelDefaults = useMemo(() => ({
    enabled: true,
    notifyOnAttendance: false,
    notifyOnAbsence: true,
    sendDailyReport: false,
  }), []);

  const getTelegramConfig = useCallback(() => telegramConfig || {
    botToken: telegramBotToken,
    channels: {},
    updatedAt: new Date().toISOString(),
  }, [telegramConfig, telegramBotToken]);

  const handleChannelToggle = useCallback((stageId: string, field: keyof typeof channelDefaults, value: boolean) => {
    setTelegramConfig(prev => {
      const config = prev || getTelegramConfig();
      const existing = config.channels[stageId] ?? {
        chatId: '',
        stageName: stageId,
        ...channelDefaults,
      };
      return {
        ...config,
        channels: {
          ...config.channels,
          [stageId]: {
            ...existing,
            [field]: value,
          },
        },
      };
    });
  }, [getTelegramConfig]);

  const handleChannelChatId = useCallback((stageId: string, chatId: string) => {
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
  }, [getTelegramConfig, stages, channelDefaults]);

  const handleTestChannel = useCallback(async (stageId: string) => {
    if (!telegramConfig) return;
    setTelegramMessage(null);
    const ok = await sendTestMessage(telegramConfig, stageId);
    if (ok) {
      setTelegramMessage({ type: 'success', text: 'ØªÙ… Ø¥Ø±Ø³Ø§Ù„ Ø±Ø³Ø§Ù„Ø© Ø§Ø®ØªØ¨Ø§Ø± Ù„Ù„Ù‚Ù†Ø§Ø©!' });
    } else {
      setTelegramMessage({ type: 'error', text: 'ÙØ´Ù„ Ø§Ù„Ø¥Ø±Ø³Ø§Ù„. ØªØ£ÙƒØ¯ Ù…Ù† Chat ID ÙˆØ§Ù„Ø¨ÙˆØª Ù…Ø¶Ø§Ù ÙƒØ£Ø¯Ù…Ù† ÙÙŠ Ø§Ù„Ù‚Ù†Ø§Ø©' });
    }
  }, [telegramConfig]);

  const hasTelegramChanges = useCallback((): boolean => {
    if (!telegramConfig) return !!telegramBotToken.trim();
    return telegramConfig.botToken !== telegramBotToken.trim();
  }, [telegramConfig, telegramBotToken]);

  const loadStats = useCallback(async () => {
    if (!currentUser) return;
    setLoadingStats(true);
    try {
      const adminUid = currentUser.role === 'admin' 
        ? currentUser.uid 
        : (currentUser.adminId || currentUser.uid);
      const data = await getDatabaseStats(adminUid);
      setStats(data);
    } catch (e) {
      console.warn('ÙØ´Ù„ ØªØ­Ù…ÙŠÙ„ Ø§Ù„Ø¥Ø­ØµØ§ÙŠØ§Øª:', e);
    } finally {
      setLoadingStats(false);
    }
  }, [currentUser]);

  const loadYears = useCallback(async () => {
    try {
      const years = await listAllAcademicYears();
      setAcademicYears(years);
    } catch (e) {
      console.warn('ÙØ´Ù„ ØªØ­Ù…ÙŠÙ„ Ø§Ù„Ø³Ù†ÙˆØ§Øª:', e);
    }
  }, []);

  // âœ… Ù‚Ø±Ø§Ø¡Ø© ÙÙ‡Ø±Ø³ Ø§Ù„Ø³Ù†ÙˆØ§Øª Ø§Ù„ØµØºÙŠØ± ÙÙ‚Ø· Ø¹Ù†Ø¯ Ø§Ù„ÙØªØ­ â€” Ø§Ù„Ø¥Ø­ØµØ§ÙŠØ§Øª Ø¹Ù†Ø¯ Ø§Ù„Ø·Ù„Ø¨ (Ø²Ø± "ØªØ­Ø¯ÙŠØ«")
  //    Ø­ØªÙ‰ Ù„Ø§ ÙŠÙØ³Ø­Ø¨ Ø´Ø¬Ø±Ø© Ø¹Ø§Ù… ÙƒØ§Ù…Ù„ ÙˆØªØªØ¬Ù…Ù‘Ø¯ Ø§Ù„ÙˆØ§Ø¬Ù‡Ø© ÙƒÙ„ Ù…Ø±Ø© ØªÙÙØªØ­ ÙÙŠÙ‡Ø§ Ø§Ù„Ø¥Ø¹Ø¯Ø§Ø¯Ø§Øª
  useEffect(() => {
    if (isAdmin && currentUser) {
      loadYears();
    }
  }, [isAdmin, currentUser, loadYears]);

  const handleResetAcademicYear = useCallback(() => {
    if (!currentUser || currentUser.role !== 'admin') return;

    const targetYear = newYearDraft.trim();

    if (!isValidAcademicYearFormat(targetYear)) {
      setResetDialog({ type: 'error', message: 'ØµÙŠØºØ© Ø§Ù„Ø³Ù†Ø© ØºÙŠØ± ØµØ­ÙŠØ­Ø©. Ù…Ø«Ø§Ù„ ØµØ­ÙŠØ­: 2025_2026' });
      return;
    }

    if (targetYear === currentAcademicYear) {
      setResetDialog({ type: 'error', message: 'ÙŠØ¬Ø¨ Ø£Ù† ØªØ®ØªÙ„Ù Ø§Ù„Ø³Ù†Ø© Ø§Ù„Ø¬Ø¯ÙŠØ¯Ø© Ø¹Ù† Ø§Ù„Ø³Ù†Ø© Ø§Ù„Ø­Ø§Ù„ÙŠØ©' });
      return;
    }

    setResetTypedConfirm('');
    setResetDialog({ type: 'confirm' });
  }, [currentUser, newYearDraft, currentAcademicYear]);

  const confirmReset = useCallback(async () => {
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
      setResetDialog({ type: 'error', message: (e.message || 'Ø®Ø·Ø£ ØºÙŠØ± Ù…Ø¹Ø±ÙˆÙ') });
    } finally {
      setResetting(false);
    }
  }, [currentUser, newYearDraft, onResetComplete]);

  const closeResetDialog = useCallback(() => {
    if (resetDialog?.type === 'success') {
      window.location.reload();
      return;
    }
    setResetDialog(null);
  }, [resetDialog?.type]);


  return (
    <div className="glass-card rounded-xl p-4 sm:p-6 space-y-4 sm:space-y-6">
      <h2 className="text-xl sm:text-2xl font-semibold text-white flex items-center gap-2"><SettingsIcon className="w-6 h-6" /> Ø§Ù„Ø¥Ø¹Ø¯Ø§Ø¯Ø§Øª</h2>

      {/* Ø´Ø±ÙŠØ· Ø§Ù„Ø³Ù†Ø© Ø§Ù„Ø£ÙƒØ§Ø¯ÙŠÙ…ÙŠØ© */}
      <div className="p-4 bg-gradient-to-r from-indigo-500/10 to-purple-500/10 border-2 border-indigo-400/30 rounded-xl">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <GraduationCap className="w-9 h-9 text-indigo-400 shrink-0" />
            <div>
              <h3 className="text-base sm:text-lg font-semibold text-indigo-300">Ø§Ù„Ø³Ù†Ø© Ø§Ù„Ø£ÙƒØ§Ø¯ÙŠÙ…ÙŠØ© Ø§Ù„Ø­Ø§Ù„ÙŠØ©</h3>
              <p className="text-2xl font-bold text-indigo-300">
                {currentAcademicYear.replace('_', ' - ')}
              </p>
            </div>
          </div>
          {academicYears.length > 0 && (
            <div className="text-sm text-indigo-300 bg-white/5 px-3 py-2 rounded-lg border border-indigo-400/20 flex items-center gap-1.5">
              <Library className="w-4 h-4" /> {academicYears.length} Ø³Ù†Ø© ÙÙŠ Ø§Ù„Ù†Ø¸Ø§Ù…
            </div>
          )}
        </div>
      </div>

      {/* ðŸ›ï¸ Ù‡ÙˆÙŠØ© Ø§Ù„Ù†Ø¸Ø§Ù… - Ù„Ù„Ø£Ø¯Ù…Ù† Ø§Ù„Ø±Ø¦ÙŠØ³ÙŠ ÙÙ‚Ø· */}
      {isAdmin && (
        <div className="p-4 bg-gradient-to-r from-blue-500/10 to-cyan-500/10 border-2 border-blue-400/30 rounded-xl">
          <div className="flex items-center gap-3 mb-3">
            <Landmark className="w-9 h-9 text-blue-400 shrink-0" />
            <div>
              <h3 className="text-base sm:text-lg font-semibold text-blue-300">Ù‡ÙˆÙŠØ© Ø§Ù„Ù†Ø¸Ø§Ù…</h3>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              value={systemTitleDraft}
              onChange={(e) => setSystemTitleDraft(e.target.value)}
              placeholder="Ù†Ø¸Ø§Ù… Ø¥Ø¯Ø§Ø±Ø© Ø§Ù„Ø­Ø¶ÙˆØ± Ø§Ù„Ø¬Ø§Ù…Ø¹ÙŠ"
              className="glass-input flex-1"
              maxLength={60}
            />
            <button
              onClick={handleSystemTitleSave}
              disabled={systemTitleSaving}
              className="btn-base btn-primary shrink-0 flex items-center justify-center gap-2"
            >
              {systemTitleSaving ? <><MorphingSquare size="sm" /> Ø¬Ø§Ø±ÙŠ Ø§Ù„Ø­ÙØ¸...</> : <><Save className="w-4 h-4" /> Ø­ÙØ¸ Ø§Ù„Ø¹Ù†ÙˆØ§Ù†</>}
            </button>
          </div>
          {systemTitleMessage && (
            <p className={`mt-2 text-sm ${systemTitleMessage.type === 'success' ? 'text-green-400' : 'text-red-400'}`}>
              {systemTitleMessage.text}
            </p>
          )}
        </div>
      )}

      {/* Ø¥Ø­ØµØ§ÙŠØ§Øª Firebase (Ù„Ù„Ø£Ø¯Ù…Ù†) */}
      {isAdmin && (
        <div>
          <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
            <h3 className="text-base sm:text-lg font-semibold text-slate-300 flex items-center gap-2"><ChartColumn className="w-5 h-5" /> Ø§Ø³ØªØ®Ø¯Ø§Ù… Firebase</h3>
            <button
              onClick={loadStats}
              disabled={loadingStats}
              className="text-sm text-blue-400 hover:text-blue-300 flex items-center gap-1.5"
            >
              {loadingStats ? <><MorphingSquare size="sm" /> ...</> : <><RefreshCw className="w-4 h-4" /> ØªØ­Ø¯ÙŠØ«</>}
            </button>
          </div>

          {stats ? (
            <div className="bg-gradient-to-br from-blue-500/10 to-cyan-500/10 border-2 border-blue-400/20 rounded-xl p-4">
              {/* Ø´Ø±ÙŠØ· Ø§Ù„Ø§Ø³ØªØ®Ø¯Ø§Ù… - âœ… Ù…ØµØ­Ø­ */}
              <div className="mb-4">
                <div className="flex justify-between text-sm font-medium text-slate-300 mb-2">
                  <span>Ø§Ù„Ø­Ø¬Ù… Ø§Ù„Ù…Ø³ØªØ®Ø¯Ù…</span>
                  <span className={
                    usagePercent > 70 ? 'text-red-600' : 
                    usagePercent > 40 ? 'text-yellow-600' : 
                    'text-green-600'
                  }>
                    {formatSize(stats.totalSizeKB)} Ù…Ù† 1 GB ({usagePercent.toFixed(4)}%)
                  </span>
                </div>
                <div className="w-full bg-slate-700 rounded-full h-3 overflow-hidden border border-blue-400/20">
                  <div
                    className={`h-full rounded-full transition-[width] duration-300 ${
                      usagePercent > 70 ? 'bg-red-500' : 
                      usagePercent > 40 ? 'bg-yellow-500' : 
                      'bg-green-500'
                    }`}
                    style={{ width: `${Math.min(100, Math.max(0.5, usagePercent))}%` }}
                  />
                </div>
              </div>

              {/* Ø§Ù„Ø¥Ø­ØµØ§ÙŠØ§Øª */}
              <div className="grid grid-cols-1 sm:grid-cols-3 md:grid-cols-5 gap-4 sm:gap-6">
                <div className="bg-slate-800 rounded-lg p-3 text-center shadow-sm">
                  <div className="text-2xl font-bold text-blue-400">{stats.totalStudents}</div>
                  <div className="text-xs text-slate-400 flex items-center justify-center gap-1"><UserIcon className="w-3.5 h-3.5" /> Ø·Ø§Ù„Ø¨</div>
                </div>
                <div className="bg-slate-800 rounded-lg p-3 text-center shadow-sm">
                  <div className="text-2xl font-bold text-purple-400">{stats.totalRecords}</div>
                  <div className="text-xs text-slate-400 flex items-center justify-center gap-1"><SquarePen className="w-3.5 h-3.5" /> Ø³Ø¬Ù„ Ø­Ø¶ÙˆØ±</div>
                </div>
                <div className="bg-slate-800 rounded-lg p-3 text-center shadow-sm">
                  <div className="text-2xl font-bold text-pink-400">{stats.totalSessions}</div>
                  <div className="text-xs text-slate-400 flex items-center justify-center gap-1"><ClipboardList className="w-3.5 h-3.5" /> Ø¬Ù„Ø³Ø©</div>
                </div>
                <div className="bg-slate-800 rounded-lg p-3 text-center shadow-sm">
                  <div className="text-2xl font-bold text-emerald-400">{stats.totalTeachers}</div>
                  <div className="text-xs text-slate-400 flex items-center justify-center gap-1"><GraduationCap className="w-3.5 h-3.5" /> Ù…Ø¯Ø±Ø³</div>
                </div>
                <div className="bg-slate-800 rounded-lg p-3 text-center shadow-sm">
                  <div className="text-2xl font-bold text-amber-400">{stats.totalFaceDescriptors}</div>
                  <div className="text-xs text-slate-400 flex items-center justify-center gap-1"><Smile className="w-3.5 h-3.5" /> Ø¨ØµÙ…Ø© ÙˆØ¬Ù‡</div>
                </div>
              </div>


            </div>
          ) : (
            <div className="bg-slate-800/30 border border-white/10 rounded-lg p-4 text-center text-slate-500 flex items-center justify-center gap-2">
              {loadingStats ? <><MorphingSquare size="sm" /> Ø¬Ø§Ø±ÙŠ ØªØ­Ù…ÙŠÙ„ Ø§Ù„Ø¥Ø­ØµØ§ÙŠØ§Øª...</> : 'Ø§Ø¶ØºØ· "ØªØ­Ø¯ÙŠØ«" Ù„Ø¹Ø±Ø¶ Ø§Ù„Ø¥Ø­ØµØ§ÙŠØ§Øª'}
            </div>
          )}
        </div>
      )}



      {/* Ù…Ù†Ø·Ù‚Ø© Ø§Ù„Ø®Ø·Ø± */}
      {isAdmin && (
        <div>
          <h3 className="text-base sm:text-lg font-semibold mb-3 text-red-400 flex items-center gap-2">
            <TriangleAlert className="w-5 h-5" /> Ù…Ù†Ø·Ù‚Ø© Ø§Ù„Ø®Ø·Ø±
          </h3>
          <div className="bg-gradient-to-br from-red-500/10 to-orange-500/10 border-2 border-red-400/30 rounded-xl p-4 sm:p-5">
            <div className="flex items-start gap-3 mb-4">
              <RefreshCw className="w-10 h-10 text-red-400 shrink-0" />
              <div className="flex-1">
                <h4 className="font-semibold text-red-300 text-base sm:text-lg mb-2">Ø¨Ø¯Ø¡ Ø³Ù†Ø© Ø£ÙƒØ§Ø¯ÙŠÙ…ÙŠØ© Ø¬Ø¯ÙŠØ¯Ø©</h4>
                <div className="bg-slate-800/30 border border-red-400/20 rounded-lg p-3 text-sm">
                  <p className="text-red-400 flex items-start gap-2">
                    <TriangleAlert className="w-4 h-4 shrink-0 mt-0.5" />
                    Ù…Ù„Ø§Ø­Ø¸Ø©: Ø³ÙŠØªÙ… Ø­Ø°Ù Ø¬Ù…ÙŠØ¹ Ø§Ù„Ø·Ù„Ø§Ø¨ ÙˆØ³Ø¬Ù„Ø§Øª Ø§Ù„Ø­Ø¶ÙˆØ± ÙÙ‚Ø·ØŒ ÙˆØªØ¨Ù‚Ù‰ Ø§Ù„ÙƒÙ„ÙŠØ§Øª ÙˆØ§Ù„Ù…Ø±Ø§Ø­Ù„ ÙˆØ§Ù„ØªØ¯Ø±ÙŠØ³ÙŠÙˆÙ†.
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-1.5 mb-4">
              <label className="block text-sm font-bold text-red-300 flex items-center gap-1.5">
                <CalendarDays className="w-4 h-4" /> Ø§Ù„Ø³Ù†Ø© Ø§Ù„Ø¬Ø¯ÙŠØ¯Ø© (Ù‚Ø§Ø¨Ù„Ø© Ù„Ù„ØªØ¹Ø¯ÙŠÙ„)
              </label>
              <input
                type="text"
                value={newYearDraft}
                onChange={(e) => setNewYearDraft(e.target.value)}
                placeholder={getNextAcademicYear(currentAcademicYear)}
                dir="ltr"
                className="glass-input font-mono text-center text-sm"
              />
              <p className="text-xs text-red-400">Ø§Ù„ØµÙŠØºØ©: 2025_2026</p>
            </div>

            <button
              onClick={handleResetAcademicYear}
              disabled={resetting}
              className="btn-base btn-danger w-full"
            >
              {resetting ? (
                <><MorphingSquare size="sm" /> Ø¬Ø§Ø±ÙŠ Ø§Ù„Ø¨Ø¯Ø¡... Ù„Ø§ ØªØºÙ„Ù‚ Ø§Ù„ØµÙØ­Ø©!</>
              ) : (
                <><RefreshCw className="w-5 h-5" /> Ø¨Ø¯Ø¡ Ø³Ù†Ø© Ø£ÙƒØ§Ø¯ÙŠÙ…ÙŠØ© Ø¬Ø¯ÙŠØ¯Ø©</>
              )}
            </button>

            <p className="text-xs text-red-400 mt-2 text-center font-medium flex items-center justify-center gap-1.5">
              <TriangleAlert className="w-3.5 h-3.5" /> Ù‡Ø°Ù‡ Ø§Ù„Ø¹Ù…Ù„ÙŠØ© Ù„Ø§ ÙŠÙ…ÙƒÙ† Ø§Ù„ØªØ±Ø§Ø¬Ø¹ Ø¹Ù†Ù‡Ø§
            </p>
          </div>
        </div>
      )}

      {/* Ù‚Ø§Ø¦Ù…Ø© Ø§Ù„Ø³Ù†ÙˆØ§Øª Ø§Ù„Ø£ÙƒØ§Ø¯ÙŠÙ…ÙŠØ© */}
      {isAdmin && academicYears.length > 0 && (
        <div>
          <h3 className="text-base sm:text-lg font-semibold mb-3 text-slate-300 flex items-center gap-2"><Library className="w-5 h-5" /> Ø§Ù„Ø³Ù†ÙˆØ§Øª Ø§Ù„Ø£ÙƒØ§Ø¯ÙŠÙ…ÙŠØ©</h3>
          <div className="bg-slate-800/30 border border-white/10 rounded-lg p-4">
            <div className="flex flex-wrap gap-2">
              {academicYears.map(year => (
                <span
                  key={year}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium border ${
                    year === currentAcademicYear
                      ? 'bg-green-500/15 text-green-300 border-green-400/40'
                      : 'bg-slate-800/30 text-slate-300 border-white/15'
                  }`}
                >
                  {year === currentAcademicYear && <CircleCheck className="w-4 h-4 text-green-600 inline-block align-middle ms-1" />}
                  {year.replace('_', ' - ')}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ðŸ¤– Ù‚Ø³Ù… Ø§Ù„ØªÙ„ØºØ±Ø§Ù… */}
      <div>
        <h3 className="text-base sm:text-lg font-semibold mb-3 text-slate-300 flex items-center gap-2">
          <Bot className="w-5 h-5" /> Ø¨ÙˆØª Ø§Ù„ØªÙ„ØºØ±Ø§Ù… (Ø¥Ø´Ø¹Ø§Ø±Ø§Øª Ø§Ù„Ø­Ø¶ÙˆØ±)
        </h3>

        <div className="bg-gradient-to-br from-sky-500/10 to-blue-500/10 border-2 border-sky-400/30 rounded-xl p-4 sm:p-5 mb-4">
          <div className="flex items-start gap-2 sm:gap-3 mb-4">
            <Megaphone className="w-8 h-8 sm:w-10 sm:h-10 text-sky-400 shrink-0" />
            <div className="flex-1 min-w-0">
              <h4 className="font-bold text-sky-300 text-base sm:text-lg mb-1">Ø¥Ø¹Ø¯Ø§Ø¯Ø§Øª Ø§Ù„Ø¨ÙˆØª</h4>
              <p className="text-xs sm:text-sm text-sky-300">
                Ø£Ø±Ø³Ù„ Ø¥Ø´Ø¹Ø§Ø±Ø§Øª Ø§Ù„Ø­Ø¶ÙˆØ± ÙˆØ§Ù„ØºÙŠØ§Ø¨ ØªÙ„Ù‚Ø§Ø¦ÙŠØ§Ù‹ Ø¥Ù„Ù‰ Ù‚Ù†ÙˆØ§Øª Ø§Ù„ØªÙ„ØºØ±Ø§Ù… Ù„ÙƒÙ„ Ù…Ø§Ø¯Ø©
              </p>
            </div>
          </div>

          <div className="bg-slate-800/30 border border-sky-400/20 rounded-lg p-3 sm:p-4 mb-4 space-y-1.5">
            <label className="block text-xs sm:text-sm font-bold text-slate-300 flex items-center gap-1.5"><KeyRound className="w-4 h-4" /> ØªÙˆÙƒÙ† Ø§Ù„Ø¨ÙˆØª (Bot Token)</label>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={telegramBotToken}
                onChange={e => { setTelegramBotToken(e.target.value); setBotVerified(false); setTelegramMessage(null); }}
                placeholder="1234567890:ABCdefGHIjklMNOpqrsTUVwxyz"
                className="glass-input flex-1 font-mono text-xs sm:text-sm"
                dir="ltr"
              />
              <button
                onClick={handleVerifyBot}
                className="btn-base btn-secondary"
              >
                <Search className="w-4 h-4" /> ØªØ­Ù‚Ù‚
              </button>
            </div>
            {botVerified && (
              <p className="text-xs sm:text-sm text-green-400 mt-2 font-medium flex items-center gap-1.5"><CircleCheck className="w-4 h-4" /> Ø§Ù„Ø¨ÙˆØª Ù…ÙˆØ«ÙˆÙ‚: @{botUsername}</p>
            )}
            <div className="mt-2 bg-slate-800/30 border border-white/10 rounded-lg p-2 sm:p-3 text-xs sm:text-xs text-slate-400">
              <p className="font-bold mb-1 flex items-center gap-1.5"><Info className="w-4 h-4" /> ÙƒÙŠÙÙŠØ© Ø§Ù„Ø­ØµÙˆÙ„ Ø¹Ù„Ù‰ Ø§Ù„ØªÙˆÙƒÙ†:</p>
                  <ol className="list-decimal list-inside space-y-1 ms-2">
                <li>Ø§ÙØªØ­ <a href="https://t.me/BotFather" target="_blank" className="text-blue-400 underline">@BotFather</a> ÙÙŠ ØªÙ„ØºØ±Ø§Ù…</li>
                <li>Ø£Ø±Ø³Ù„ <code className="bg-white/10 px-1 rounded">/newbot</code> ÙˆØ§ØªØ¨Ø¹ Ø§Ù„ØªØ¹Ù„ÙŠÙ…Ø§Øª</li>
                <li>Ø§Ù†Ø³Ø® Ø§Ù„ØªÙˆÙƒÙ† ÙˆØ£Ù„ØµÙ‚Ù‡ Ù‡Ù†Ø§</li>
              </ol>
            </div>
          </div>

          {/* Ø±Ø¨Ø· Ø§Ù„Ù‚Ù†ÙˆØ§Øª */}
          <div className="bg-slate-800/30 border border-sky-400/20 rounded-lg p-3 sm:p-4">
            <h4 className="font-bold text-slate-300 mb-3 text-sm sm:text-base flex items-center gap-2"><Megaphone className="w-4 h-4 text-sky-400" /> Ø±Ø¨Ø· Ø§Ù„Ù‚Ù†ÙˆØ§Øª Ø­Ø³Ø¨ Ø§Ù„Ù…Ø§Ø¯Ø©</h4>
            <p className="text-xs sm:text-xs text-slate-500 mb-3">
              Ù„ÙƒÙ„ Ù…Ø§Ø¯Ø© (Ù…Ø±Ø­Ù„Ø©)ØŒ Ø£Ø¯Ø®Ù„ Chat ID Ø§Ù„Ù‚Ù†Ø§Ø© Ø§Ù„Ø®Ø§ØµØ© Ø¨Ù‡Ø§
            </p>

            {stages.length === 0 ? (
              <div className="bg-yellow-500/10 border border-yellow-400/20 rounded-lg p-3 text-xs sm:text-sm text-yellow-400 text-center flex items-center justify-center gap-2">
                <TriangleAlert className="w-4 h-4 shrink-0" /> Ù„Ø§ ØªÙˆØ¬Ø¯ Ù…Ø±Ø§Ø­Ù„ Ù…Ø¶Ø§ÙØ©. Ø£Ø¶Ù Ø§Ù„Ù…Ø±Ø§Ø­Ù„ Ø£ÙˆÙ„Ø§Ù‹ Ù…Ù† ØµÙØ­Ø© Ø¥Ø¯Ø§Ø±Ø© Ø§Ù„ÙƒÙ„ÙŠØ§Øª.
              </div>
            ) : (
              <div className="space-y-3 max-h-80 overflow-y-auto">
                {stages.map(stage => {
                  const college = colleges.find(c => c.id === stage.collegeId);
                  const channel = telegramConfig?.channels[stage.id];
                  const chatId = channel?.chatId || '';

                  return (
                    <div key={stage.id} className="border border-white/10 rounded-lg p-3 hover:border-sky-400/30 transition-colors duration-200">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-lg shrink-0">{college?.icon || <Library className="w-4 h-4" />}</span>
                          <div className="min-w-0">
                            <span className="font-bold text-white text-sm sm:text-base truncate block">{stage.name}</span>
                            {college && (
                              <span className="text-xs sm:text-xs text-slate-500 block truncate">{college.name}</span>
                            )}
                          </div>
                        </div>
                        <label className="flex items-center gap-1 text-xs sm:text-xs shrink-0">
                          <input
                            type="checkbox"
                            checked={channel?.enabled ?? false}
                            onChange={e => handleChannelToggle(stage.id, 'enabled', e.target.checked)}
                            className="accent-sky-600"
                          />
                          Ù…ÙØ¹Ù‘Ù„
                        </label>
                      </div>
                      <div className="flex flex-col sm:flex-row gap-2">
                        <input
                          type="text"
                          value={chatId}
                          onChange={e => handleChannelChatId(stage.id, e.target.value)}
                          placeholder="-1001234567890"
                          className="glass-input flex-1 text-xs sm:text-sm font-mono"
                          dir="ltr"
                        />
                        <button
                          onClick={() => handleTestChannel(stage.id)}
                          disabled={!chatId || !telegramConfig?.botToken}
                          className="bg-green-600 hover:bg-green-700 disabled:opacity-40 text-white text-xs font-medium px-3 py-1.5 rounded-md transition duration-200 flex items-center gap-1.5"
                        >
                          <Send className="w-3.5 h-3.5" /> Ø§Ø®ØªØ¨Ø§Ø±
                        </button>
                      </div>
                      {chatId && (
                        <div className="flex flex-wrap gap-2 sm:gap-3 mt-2 text-xs sm:text-xs text-slate-500">
                          <label className="flex items-center gap-1">
                            <input type="checkbox" checked={channel?.notifyOnAbsence ?? true}
                              onChange={e => handleChannelToggle(stage.id, 'notifyOnAbsence', e.target.checked)}
                              className="accent-sky-600 w-3 h-3" />
                            ØºÙŠØ§Ø¨
                          </label>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {stages.length > 0 && (
              <div className="mt-3 bg-slate-800/30 border border-white/10 rounded-lg p-2 sm:p-3 text-xs sm:text-xs text-slate-400">
                <p className="font-bold mb-1 flex items-center gap-1.5"><Info className="w-4 h-4" /> ÙƒÙŠÙÙŠØ© Ø§Ù„Ø­ØµÙˆÙ„ Ø¹Ù„Ù‰ Chat ID:</p>
              <ol className="list-decimal list-inside space-y-1 ms-2">
                  <li>Ø£Ø¶Ù Ø§Ù„Ø¨ÙˆØª ÙƒØ£Ø¯Ù…Ù† ÙÙŠ Ø§Ù„Ù‚Ù†Ø§Ø©</li>
                  <li>Ø£Ø±Ø³Ù„ Ø±Ø³Ø§Ù„Ø© ÙÙŠ Ø§Ù„Ù‚Ù†Ø§Ø©</li>
                  <li>Ø§ÙØªØ­ <a href="https://t.me/GetChatID_Bot" target="_blank" className="text-blue-400 underline">@GetChatID_Bot</a></li>
                  <li>Ø§Ù†Ø³Ø® Ø§Ù„Ø±Ù‚Ù… (ÙŠØ¨Ø¯Ø£ Ø¨Ù€ -100) ÙˆØ£Ù„ØµÙ‚Ù‡ Ù‡Ù†Ø§</li>
                </ol>
              </div>
            )}
          </div>

          {telegramMessage && (
            <div className={`mt-3 p-3 rounded-lg text-xs sm:text-sm font-medium ${
              telegramMessage.type === 'success'
                ? 'bg-green-500/15 text-green-300 border border-green-400/30'
                : 'bg-red-500/15 text-red-300 border border-red-400/30'
            }`}>
              {telegramMessage.text}
            </div>
          )}

          <button
            onClick={handleTelegramSave}
            disabled={telegramSaving || !hasTelegramChanges()}
            className="mt-4 btn-base btn-primary w-full"
          >
            {telegramSaving ? (
              <><MorphingSquare size="sm" /> Ø¬Ø§Ø±ÙŠ Ø§Ù„Ø­ÙØ¸...</>
            ) : (
              <><Save className="w-5 h-5" /> Ø­ÙØ¸ Ø¥Ø¹Ø¯Ø§Ø¯Ø§Øª Ø§Ù„ØªÙ„ØºØ±Ø§Ù…</>
            )}
          </button>
        </div>
      </div>

      {/* ðŸ“‹ Ù†Ø§ÙØ°Ø© ØªØ£ÙƒÙŠØ¯ Ø¯Ø§Ø®Ù„ÙŠØ© (Ø¨Ø¯Ù„ window.confirm/prompt Ø§Ù„ØªÙŠ ØªØªØ¬Ù…Ø¯ Ø¹Ù„Ù‰ Ø§Ù„Ø¬ÙˆØ§Ù„) */}
      {resetDialog && createPortal(
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4 animate-fadeIn"
          onClick={() => resetDialog.type !== 'success' && setResetDialog(null)}
        >
          <div
            ref={modalBehaviorRef}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="reset-dialog-title"
            tabIndex={-1}
            className="glass-modal modal-panel w-[calc(100vw-2rem)] max-w-lg text-center space-y-4 animate-modalUp focus:outline-none"
            onClick={e => e.stopPropagation()}
            dir="rtl"
          >
            {resetDialog.type === 'confirm' && (
              <>
                <h3 id="reset-dialog-title" className="text-base sm:text-lg font-semibold text-white">ØªØ­Ø°ÙŠØ± Ø®Ø·ÙŠØ±</h3>
                <p className="text-sm text-slate-400 whitespace-pre-line text-start">
                  {`Ø§Ù„Ø³Ù†Ø© Ø§Ù„Ø¬Ø¯ÙŠØ¯Ø©: ${newYearDraft}\n\n` +
                   `Ø³ÙŠØªÙ… Ø­Ø°Ù Ø¬Ù…ÙŠØ¹ Ø§Ù„Ø·Ù„Ø§Ø¨ ÙˆØ³Ø¬Ù„Ø§Øª Ø§Ù„Ø­Ø¶ÙˆØ± ÙˆØ§Ù„Ø¬Ù„Ø³Ø§Øª\n` +
                   `Ø³ÙŠØªÙ… ØªØ¹Ø·ÙŠÙ„ ØµÙ„Ø§Ø­ÙŠØ§Øª Ø¬Ù…ÙŠØ¹ Ø§Ù„ØªØ¯Ø±ÙŠØ³ÙŠÙŠÙ† (Ø§Ù„Ø­Ø³Ø§Ø¨Ø§Øª ØªØ¨Ù‚Ù‰)\n\n` +
                   `Ù…Ø§ Ø³ÙŠØ¨Ù‚Ù‰:\n` +
                   `Ø§Ù„ÙƒÙ„ÙŠØ§Øª ÙˆØ§Ù„Ù…Ø±Ø§Ø­Ù„ ÙƒÙ…Ø§ Ù‡ÙŠ\n` +
                   `Ø­Ø³Ø§Ø¨Ùƒ (Ø§Ù„Ø£Ø¯Ù…Ù†) ÙˆØ­Ø³Ø§Ø¨Ø§Øª Ø§Ù„ØªØ¯Ø±ÙŠØ³ÙŠÙŠÙ†`}
                </p>
                <div className="space-y-1.5 text-start">
                  <label className="block text-xs font-bold text-slate-300">
                    Ù„Ù„ØªØ£ÙƒÙŠØ¯ Ø§Ù„Ù†Ù‡Ø§Ø¦ÙŠØŒ Ø§ÙƒØªØ¨: "ØªØµÙÙŠØ±"
                  </label>
                  <input
                    type="text"
                    value={resetTypedConfirm}
                    onChange={e => setResetTypedConfirm(e.target.value)}
                    placeholder="ØªØµÙÙŠØ±"
                    className="glass-input text-center text-sm"
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={confirmReset}
                    disabled={resetTypedConfirm !== 'ØªØµÙÙŠØ±' || resetting}
                    className="btn-base btn-danger flex-1"
                  >
                    {resetting ? 'Ø¬Ø§Ø±ÙŠ Ø§Ù„ØªÙ†ÙÙŠØ°...' : 'ØªØ£ÙƒÙŠØ¯ Ø§Ù„ØªÙ†ÙÙŠØ°'}
                  </button>
                  <button
                    onClick={() => setResetDialog(null)}
                    className="btn-base btn-secondary"
                  >
                    Ø¥Ù„ØºØ§Ø¡
                  </button>
                </div>
              </>
            )}

            {resetDialog.type === 'success' && (
              <>
                <h3 id="reset-dialog-title" className="text-base sm:text-lg font-semibold text-green-400">ØªÙ… Ø¨Ø¯Ø¡ Ø§Ù„Ø³Ù†Ø© Ø§Ù„Ø¬Ø¯ÙŠØ¯Ø© Ø¨Ù†Ø¬Ø§Ø­!</h3>
                <p className="text-sm text-slate-400 whitespace-pre-line text-start">
                  {`Ø§Ù„Ø³Ù†Ø© Ø§Ù„Ø³Ø§Ø¨Ù‚Ø©: ${resetDialog.oldYear}\n` +
                   `Ø§Ù„Ø³Ù†Ø© Ø§Ù„Ø¬Ø¯ÙŠØ¯Ø©: ${resetDialog.newYear}\n\n` +
                   `ØªÙ… Ø­Ø°Ù Ø§Ù„Ø·Ù„Ø§Ø¨ ÙˆØ³Ø¬Ù„Ø§Øª Ø§Ù„Ø­Ø¶ÙˆØ±\n` +
                   `ØªÙ… ØªØ¹Ø·ÙŠÙ„ ØµÙ„Ø§Ø­ÙŠØ§Øª Ø§Ù„ØªØ¯Ø±ÙŠØ³ÙŠÙŠÙ†`}
                </p>
                <button
                  onClick={closeResetDialog}
                  className="btn-base btn-primary w-full"
                >
                  Ø¥Ø¹Ø§Ø¯Ø© ØªØ­Ù…ÙŠÙ„ Ø§Ù„ØµÙØ­Ø©
                </button>
              </>
            )}

            {resetDialog.type === 'error' && (
              <>
                <h3 id="reset-dialog-title" className="text-base sm:text-lg font-semibold text-red-400">ÙØ´Ù„ Ø§Ù„Ø¹Ù…Ù„ÙŠØ©</h3>
                <p className="text-sm text-slate-400 whitespace-pre-line">{resetDialog.message}</p>
                <button
                  onClick={() => setResetDialog(null)}
                  className="btn-base btn-danger w-full"
                >
                  Ø¥ØºÙ„Ø§Ù‚
                </button>
              </>
            )}
          </div>
        </div>,
        document.body
      )}

    </div>
  );
});