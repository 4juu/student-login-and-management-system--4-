import React, { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { AttendanceSession, Student, AttendanceRecord } from '../types/student';
import { getCurrentAcademicYear } from '../firebase/dataService';
import { AbsenceSendLogEntry, GroupSendProgress } from '../types/telegram';
import { Calendar, ChartColumn, Circle, CircleCheck, ClipboardList, GraduationCap, Library, Pencil, TriangleAlert } from 'lucide-react';

interface SessionManagerProps {
  sessions: AttendanceSession[];
  activeSessionId: string | null;
  onCreateSession: (session: AttendanceSession) => void;
  onSelectSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
  onRenameSession?: (sessionId: string, newName: string) => void;
  students?: Student[];
  records?: AttendanceRecord[];
  onMarkAbsent?: (sessionId: string, studentIds: string[]) => void;
  absenceSendLogs?: AbsenceSendLogEntry[];
  isSending?: boolean;
  currentSendingSessionId?: string | null;
  sendGroups?: GroupSendProgress[];
  sendDoneCount?: number;
  sendTotalGroups?: number;
  completedGroupData?: Record<string, GroupSendProgress[]>;
}

export const SessionManager: React.FC<SessionManagerProps> = ({
  sessions,
  activeSessionId,
  onCreateSession,
  onSelectSession,
  onDeleteSession,
  students = [],
  records = [],
  onMarkAbsent,
  onRenameSession,
  absenceSendLogs = [],
  isSending = false,
  currentSendingSessionId = null,
  sendGroups = [],
  completedGroupData = {},
}) => {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [sessionName, setSessionName] = useState('');
  const [absentSessionId, setAbsentSessionId] = useState<string | null>(null);
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editSessionName, setEditSessionName] = useState('');
  const [sendLogSessionId, setSendLogSessionId] = useState<string | null>(null);

  const [confirmState, setConfirmState] = useState<{
    title: string;
    message: string;
    confirmLabel?: string;
    onConfirm: () => void;
  } | null>(null);

  const currentAcademicYear = useMemo(() => getCurrentAcademicYear(), []);

  const allGroups = useMemo(() => {
    const groups = new Set<string>();
    students.forEach(s => { if (s.group) groups.add(s.group); });
    return Array.from(groups).sort((a, b) => a.localeCompare(b, 'ar'));
  }, [students]);

  const presentStudentIdsForSession = useMemo(() => {
    if (!absentSessionId) return new Set<string>();
    return new Set(
      records.filter(r => r.sessionId === absentSessionId && r.status === 'present').map(r => r.studentId)
    );
  }, [records, absentSessionId]);

  const getAbsentCandidates = useMemo(() => {
    if (!absentSessionId || selectedGroups.size === 0) return [];
    return students.filter(s =>
      s.group && selectedGroups.has(s.group) && !presentStudentIdsForSession.has(s.id)
    );
  }, [students, selectedGroups, presentStudentIdsForSession, absentSessionId]);

  const handleQuickCreate = () => {
    const now = new Date();
    const dateStr = now.toLocaleDateString('ar-EG', { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
    const name = `حضور ${dateStr}`;
    
    const newSession: AttendanceSession = {
      id: Date.now().toString(),
      name,
      date: now.toLocaleDateString('ar-EG'),
      createdAt: now.toISOString(),
      isActive: true,
      academicYear: currentAcademicYear,
    };
    
    onCreateSession(newSession);
  };

  // 🛑 تأكيد عند تغيير السجل النشط — منع تغيير غير مقصود أثناء المحاضرة
  const handleActivateSession = (sessionId: string) => {
    if (sessionId === activeSessionId) return;
    const target = sessions.find(s => s.id === sessionId);
    const activeCount = activeSessionId ? records.filter(r => r.sessionId === activeSessionId).length : 0;

    setConfirmState({
      title: 'تأكيد تغيير السجل النشط',
      message:
        `سيتم تحويل عمليات تسجيل الحضور إلى السجل: "${target?.name || ''}"\n\n` +
        (activeSessionId
          ? activeCount > 0
            ? `السجل النشط الحالي يحتوي على ${activeCount} عملية تسجيل ولن تُحذف.\n`
            : 'السجل النشط الحالي لا يحتوي على أي سجلات حضور.\n'
          : '') +
        'هل تريد المتابعة؟',
      confirmLabel: 'نعم، تفعيل',
      onConfirm: () => {
        setConfirmState(null);
        onSelectSession(sessionId);
      },
    });
  };

  const handleCustomCreate = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!sessionName.trim()) {
      alert('الرجاء إدخال اسم السجل');
      return;
    }

    const now = new Date();
    const newSession: AttendanceSession = {
      id: Date.now().toString(),
      name: sessionName.trim(),
      date: now.toLocaleDateString('ar-EG'),
      createdAt: now.toISOString(),
      isActive: true,
      academicYear: currentAcademicYear,
    };
    
    onCreateSession(newSession);
    setSessionName('');
    setShowCreateForm(false);
  };

  const handleDelete = (sessionId: string) => {
    setConfirmState({
      title: 'حذف السجل',
      message: 'هل أنت متأكد من حذف هذا السجل؟ سيتم حذف جميع سجلات الحضور المرتبطة به.',
      onConfirm: () => {
        onDeleteSession(sessionId);
        setConfirmState(null);
      },
    });
  };

  const handleOpenAbsent = (sessionId: string) => {
    setAbsentSessionId(sessionId);
    setSelectedGroups(new Set());
  };

  const handleGroupToggle = (group: string) => {
    setSelectedGroups(prev => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  };

  const handleConfirmAbsent = () => {
    if (!absentSessionId || getAbsentCandidates.length === 0) return;
    const sessionId = absentSessionId;
    const studentIds = getAbsentCandidates.map(s => s.id);
    const count = studentIds.length;
    setConfirmState({
      title: 'تسجيل الغياب',
      message: `هل تريد تسجيل غياب (${count}) طالب من الكروبات المحددة؟`,
      confirmLabel: 'تسجيل الغياب',
      onConfirm: () => {
        onMarkAbsent?.(sessionId, studentIds);
        setConfirmState(null);
        setAbsentSessionId(null);
        setSelectedGroups(new Set());
      },
    });
  };

  const presentCountBySession = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of records) {
      if (r.status !== 'present') continue;
      counts.set(r.sessionId, (counts.get(r.sessionId) || 0) + 1);
    }
    return counts;
  }, [records]);

  const renderSendLogModal = () => {
    const isThisSending = isSending && currentSendingSessionId === sendLogSessionId;
    const log = absenceSendLogs.find(l => l.sessionId === sendLogSessionId);
    const groupData = isThisSending ? sendGroups : (log ? completedGroupData[sendLogSessionId!] : []);
    const hasData = isThisSending || (log && groupData.length > 0);

    return createPortal(
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setSendLogSessionId(null)}>
        <div className="modal-height bg-slate-800 rounded-2xl shadow-2xl w-full max-w-lg flex flex-col overflow-hidden border border-slate-600" dir="rtl" onClick={e => e.stopPropagation()}>
          <div className="shrink-0 px-6 pt-6 pb-4 border-b border-slate-700">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-lg font-bold text-white flex items-center gap-2"><ClipboardList className="w-5 h-5" /> سجل إرسال الغيابات</h2>
              <button onClick={() => setSendLogSessionId(null)} className="text-slate-400 hover:text-white text-2xl leading-none">&times;</button>
            </div>
            {log && <p className="text-sm text-slate-400 flex items-center gap-1"><Library className="w-4 h-4" /> {log.subjectName} | {log.groups.join('، ')}</p>}
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2 min-h-0">
            {!hasData ? (
              <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                <svg className="w-12 h-12 mb-3 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                </svg>
                <p className="text-sm">لم يتم إرسال أي غيابات اليوم</p>
              </div>
            ) : (
              groupData.map((group) => (
                <div
                  key={group.groupName}
                  className={`flex items-center gap-3 p-3 rounded-xl border transition ${
                    group.allDone
                      ? 'bg-green-900/40 border-green-700'
                      : 'bg-blue-900/40 border-blue-700'
                  }`}
                >
                  <div className="shrink-0">
                    {group.allDone ? (
                      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="12" r="11" stroke="#22c55e" strokeWidth="2" fill="#14532d" />
                        <path d="M7 13l3 3 7-7" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                      </svg>
                    ) : (
                      <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="12" r="10" stroke="rgba(255,255,255,0.2)" strokeWidth="3" />
                        <path d="M12 2a10 10 0 019.95 9" stroke="#60a5fa" strokeWidth="3" strokeLinecap="round" />
                      </svg>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-white text-sm truncate">{group.groupName}</span>
                      <span className="text-[10px] text-slate-400 shrink-0">
                        {group.channels.length} {group.channels.length > 1 ? 'قنوات' : 'قناة'}
                      </span>
                    </div>
                    {group.channels.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {group.channels.map((ch) => (
                          <span
                            key={ch.channelLabel}
                            className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                              ch.status === 'sent'
                                ? 'bg-green-900 text-green-300'
                                : ch.status === 'failed'
                                ? 'bg-red-900 text-red-300'
                                : 'bg-slate-600 text-slate-400'
                            }`}
                          >
                            {ch.channelLabel}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="shrink-0 px-6 py-4 border-t border-slate-700 flex gap-2">
            <button
              onClick={() => setSendLogSessionId(null)}
              className="flex-1 bg-slate-700 hover:bg-slate-600 text-slate-200 font-medium py-2.5 px-4 rounded-xl transition"
            >
              إغلاق
            </button>
          </div>
        </div>
      </div>,
      document.body
    );
  };

  return (
    <div className="glass-card rounded-xl p-6">
      <div className="mb-4 p-3 bg-indigo-500/10 border border-indigo-500/30 rounded-lg flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <GraduationCap className="w-7 h-7 text-indigo-400" />
          <div>
            <p className="text-sm font-bold text-indigo-200">
              السنة الأكاديمية: {currentAcademicYear.replace('_', ' - ')}
            </p>
            <p className="text-xs text-indigo-300">
              جميع السجلات تنتمي لهذه السنة
            </p>
          </div>
        </div>
        <div className="text-xs bg-white/10 px-3 py-1 rounded-full border border-indigo-400/30 text-indigo-200 flex items-center gap-1">
          <ChartColumn className="w-3.5 h-3.5" /> {sessions.length} سجل
        </div>
      </div>

      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-white">إدارة السجلات</h2>
        <div className="flex gap-2">
          <button
            onClick={handleQuickCreate}
            className="bg-green-600 hover:bg-green-700 text-white font-medium py-2 px-4 rounded-md transition duration-200 flex items-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            سجل جديد (اليوم)
          </button>
          <button
            onClick={() => setShowCreateForm(!showCreateForm)}
            className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-md transition duration-200"
          >
            سجل مخصص
          </button>
        </div>
      </div>

      {showCreateForm && (
        <form onSubmit={handleCustomCreate} className="mb-6 p-4 bg-blue-500/10 rounded-lg border border-blue-500/30">
          <div className="flex gap-4">
            <input
              type="text"
              value={sessionName}
              onChange={(e) => setSessionName(e.target.value)}
              placeholder="أدخل اسم السجل (مثال: حضور الاختبار النهائي)"
              className="flex-1 px-4 py-2 border border-slate-600 bg-slate-800 text-white placeholder:text-slate-500 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              dir="rtl"
            />
            <button
              type="submit"
              className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-6 rounded-md transition duration-200"
            >
              إنشاء
            </button>
            <button
              type="button"
              onClick={() => setShowCreateForm(false)}
              className="bg-white/10 hover:bg-white/20 text-slate-200 font-medium py-2 px-4 rounded-md transition duration-200"
            >
              إلغاء
            </button>
          </div>
        </form>
      )}

      {sessions.length === 0 ? (
        <div className="text-center py-12 bg-white/5 border border-white/10 rounded-lg">
          <svg className="w-16 h-16 text-slate-500 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <p className="text-slate-300 mb-4">لا توجد سجلات حضور</p>
          <p className="text-sm text-slate-400">انقر على "سجل جديد" لإنشاء سجل حضور لليوم</p>
        </div>
      ) : (
        <div className="space-y-3">
          {sessions.map((session) => (
            <div
              key={session.id}
              className={`p-3 sm:p-4 rounded-lg border-2 transition-all ${
                session.id === activeSessionId
                  ? 'border-green-500/50 bg-green-500/10'
                  : 'border-white/10 bg-white/5 hover:border-white/20'
              }`}
            >
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    {session.id === activeSessionId && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] sm:text-xs font-medium bg-green-500 text-white shrink-0">
                        نشط الآن
                      </span>
                    )}
                    <h3 className="text-base sm:text-lg font-bold text-white truncate">
                      {editingSessionId === session.id ? (
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={editSessionName}
                            onChange={e => setEditSessionName(e.target.value)}
                            className="px-3 py-1 border border-blue-500/40 bg-slate-800 text-white rounded text-base sm:text-lg font-bold"
                            autoFocus
                            onKeyDown={e => {
                              if (e.key === 'Enter' && editSessionName.trim()) {
                                onRenameSession?.(session.id, editSessionName.trim());
                                setEditingSessionId(null);
                              }
                              if (e.key === 'Escape') setEditingSessionId(null);
                            }}
                            onBlur={() => setEditingSessionId(null)}
                            dir="rtl"
                          />
                        </div>
                      ) : (
                        <span>{session.name}</span>
                      )}
                    </h3>
                    {onRenameSession && editingSessionId !== session.id && (
                      <button
                        onClick={() => { setEditingSessionId(session.id); setEditSessionName(session.name); }}
                        className="text-blue-400 hover:text-blue-300 text-xs sm:text-sm shrink-0"
                        title="تعديل الاسم"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                  <p className="text-xs sm:text-sm text-slate-300 mt-1 flex items-center gap-1">
                    <Calendar className="w-4 h-4 text-slate-400" /> {session.date} | <CircleCheck className="w-4 h-4 text-green-400" /> {presentCountBySession.get(session.id) || 0} حاضر
                  </p>
                </div>
                
                <div className="flex gap-1.5 sm:gap-2 flex-wrap">
                  {session.id !== activeSessionId && (
                    <button
                      onClick={() => handleActivateSession(session.id)}
                      className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-1.5 sm:py-2 px-3 sm:px-4 rounded-md transition duration-200 text-xs sm:text-sm"
                    >
                      تفعيل
                    </button>
                  )}
                  <button
                    onClick={() => handleOpenAbsent(session.id)}
                    className="bg-orange-500 hover:bg-orange-600 text-white font-medium py-1.5 sm:py-2 px-3 sm:px-4 rounded-md transition duration-200 text-xs sm:text-sm flex items-center gap-1.5"
                  >
                    <Circle className="w-2.5 h-2.5 fill-red-500 text-red-500" /> غياب
                  </button>
                  <button
                    onClick={() => handleDelete(session.id)}
                    className="bg-red-600 hover:bg-red-700 text-white font-medium py-1.5 sm:py-2 px-3 sm:px-4 rounded-md transition duration-200 text-xs sm:text-sm"
                  >
                    حذف
                  </button>
                  <button
                    onClick={() => setSendLogSessionId(session.id)}
                    className="bg-slate-700 hover:bg-slate-600 text-white font-medium py-1.5 sm:py-2 px-3 sm:px-4 rounded-md transition duration-200 text-xs sm:text-sm flex items-center gap-1.5"
                  >
                    <ClipboardList className="w-4 h-4" /> سجل الإرسال
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* نافذة اختيار الكروبات للغياب */}
      {absentSessionId &&
        createPortal(
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setAbsentSessionId(null)}>
          <div className="modal-panel bg-slate-900 border border-white/10 rounded-xl shadow-2xl max-w-lg w-full overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold text-white flex items-center gap-2"><Circle className="w-3 h-3 fill-red-500 text-red-500" /> تسجيل غياب الكروبات</h3>
              <button onClick={() => setAbsentSessionId(null)} className="text-slate-400 hover:text-white text-2xl">&times;</button>
            </div>

            <p className="text-sm text-slate-300 mb-4">
              حدد الكروبات اللي عندها محاضرة اليوم. الطلاب المنتمين لهذه الكروبات واللي ما حضروا راح يسجلون غياب.
            </p>

            {allGroups.length === 0 ? (
              <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4 text-center text-yellow-300 flex items-center justify-center gap-2">
                <TriangleAlert className="w-5 h-5" /> لا توجد كروبات للطلاب في هذه المرحلة
              </div>
            ) : (
              <div className="space-y-2 mb-4">
                <label className="flex items-center gap-2 p-2 bg-white/5 rounded-lg hover:bg-white/10 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedGroups.size === allGroups.length}
                    onChange={() => {
                      if (selectedGroups.size === allGroups.length) setSelectedGroups(new Set());
                      else setSelectedGroups(new Set(allGroups));
                    }}
                    className="accent-orange-500 w-5 h-5"
                  />
                  <span className="font-bold text-slate-200">تحديد الكل</span>
                </label>
                {allGroups.map(group => (
                  <label key={group} className="flex items-center gap-2 p-2 rounded-lg hover:bg-white/10 cursor-pointer border border-white/10">
                    <input
                      type="checkbox"
                      checked={selectedGroups.has(group)}
                      onChange={() => handleGroupToggle(group)}
                      className="accent-orange-500 w-5 h-5"
                    />
                    <span className="font-medium text-white">{group}</span>
                    <span className="text-xs text-slate-400 mr-auto">
                      {students.filter(s => s.group === group).length} طالب
                    </span>
                  </label>
                ))}
              </div>
            )}

            {getAbsentCandidates.length > 0 && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 mb-4">
                <p className="text-sm font-bold text-red-300 mb-1 flex items-center gap-1">
                  <TriangleAlert className="w-4 h-4" /> ({getAbsentCandidates.length}) طالب غائب
                </p>
                <div className="text-xs text-red-400 max-h-24 overflow-y-auto">
                  {getAbsentCandidates.map(s => (
                    <span key={s.id} className="inline-block ml-1">{s.name} | </span>
                  ))}
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={handleConfirmAbsent}
                disabled={getAbsentCandidates.length === 0}
                className="flex-1 bg-orange-600 hover:bg-orange-700 disabled:bg-white/10 disabled:text-slate-500 text-white font-bold py-3 px-4 rounded-lg transition flex items-center justify-center gap-2"
              >
                <CircleCheck className="w-4 h-4" /> تسجيل غياب ({getAbsentCandidates.length})
              </button>
              <button
                onClick={() => setAbsentSessionId(null)}
                className="bg-white/10 hover:bg-white/20 text-slate-200 font-medium py-3 px-4 rounded-lg transition"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* 📋 نافذة تأكيد داخلية (بدل window.confirm التي تتجمد على الجوال) */}
      {confirmState &&
        createPortal(
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4" onClick={() => setConfirmState(null)}>
            <div className="modal-panel bg-slate-900 border border-white/10 rounded-xl shadow-2xl max-w-sm w-full overflow-y-auto p-6 text-center" onClick={e => e.stopPropagation()}>
              <h3 className="text-lg font-bold text-white mb-2">{confirmState.title}</h3>
              <p className="text-sm text-slate-300 mb-6 whitespace-pre-line">{confirmState.message}</p>
              <div className="flex gap-2">
                <button
                  onClick={confirmState.onConfirm}
                  className="flex-1 bg-orange-600 hover:bg-orange-700 text-white font-bold py-3 px-4 rounded-lg transition"
                >
                  {confirmState.confirmLabel || 'موافق'}
                </button>
                <button
                  onClick={() => setConfirmState(null)}
                  className="bg-white/10 hover:bg-white/20 text-slate-200 font-medium py-3 px-4 rounded-lg transition"
                >
                  إلغاء
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* 📋 نافذة سجل إرسال الغيابات */}
      {sendLogSessionId && renderSendLogModal()}

    </div>
  );
};
