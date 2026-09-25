import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
} from 'react';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import {
  Student,
  AttendanceRecord,
  AttendanceSession,
  College,
  Stage,
} from '../types/student';
import { User } from '../types/user';
import { MorphPanel } from './MorphPanel';
import { ArrowUp, ChevronLeft, CircleCheck, CircleX, ClipboardList, MessageCircle, Mic, Search, Sparkles, Square } from 'lucide-react';
import { formatDateWithDay } from '../lib/date';
import { buildLocalReply } from '../lib/chatBrain';
import { useChatBrain } from '../hooks/useChatBrain';

interface Message {
  id: string;
  type: 'user' | 'bot';
  content: string;
  timestamp: Date;
}

interface SmartChatBotProps {
  user: User;
  colleges: College[];
  stages: Stage[];
  currentStageId?: string | null | undefined;
  students: Student[];
  records: AttendanceRecord[];
  sessions: AttendanceSession[];
  allStagesData?: {
    [stageId: string]: {
      students: Student[];
      records: AttendanceRecord[];
      sessions: AttendanceSession[];
    };
  } | undefined;
}

export const SmartChatBot: React.FC<SmartChatBotProps> = React.memo(({
  user,
  colleges,
  stages,
  currentStageId,
  students,
  records,
  sessions,
  allStagesData = {},
}) => {
  const isAdmin = user.role === 'admin';

  const [isOpen, setIsOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSessionsModal, setShowSessionsModal] = useState(false);
  const [showDayDetails, setShowDayDetails] = useState(false);

  useBodyScrollLock(isOpen || showSessionsModal || showDayDetails);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const lastRequestTime = useRef<number>(0);
  const studentSearchRef = useRef<HTMLDivElement>(null);

  const [isListening, setIsListening] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [voiceSupported] = useState(() =>
    typeof window !== 'undefined' && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition),
  );
  const recognitionRef = useRef<any>(null);
  const recognitionLangIndex = useRef(0);
  const lastTranscriptRef = useRef('');
  const manualStopRef = useRef(false);

  const accessibleData = useMemo(() => {
    if (isAdmin) {
      const allStudents: Student[] = [];
      const allRecords: AttendanceRecord[] = [];
      const allSessions: AttendanceSession[] = [];
      const stagesMap: {
        [stageId: string]: {
          students: Student[];
          records: AttendanceRecord[];
          sessions: AttendanceSession[];
          stageName: string;
          collegeName: string;
        };
      } = {};

      Object.entries(allStagesData).forEach(([stageId, stageData]) => {
        allStudents.push(...stageData.students);
        allRecords.push(...stageData.records);
        allSessions.push(...stageData.sessions);
        const stage = stages.find(s => s.id === stageId);
        const college = colleges.find(c => c.id === stage?.collegeId);
        stagesMap[stageId] = {
          ...stageData,
          stageName: stage?.name || 'غير معروف',
          collegeName: college?.name || 'غير معروف',
        };
      });

      return {
        accessibleColleges: colleges,
        accessibleStages: stages,
        allStudents: allStudents.length > 0 ? allStudents : students,
        allRecords: allRecords.length > 0 ? allRecords : records,
        allSessions: allSessions.length > 0 ? allSessions : sessions,
        stagesMap,
      };
    }

    const allowedStagesMap = user.permissions?.allowedStages ?? {};
    const accessibleColleges = colleges.filter(c => {
      const stagesForCollege = allowedStagesMap[c.id];
      return !!stagesForCollege && stagesForCollege.length > 0;
    });
    const accessibleStageIds = Object.values(allowedStagesMap).flat();
    const accessibleStages = stages.filter(s => accessibleStageIds.includes(s.id));

    return {
      accessibleColleges,
      accessibleStages,
      allStudents: students,
      allRecords: records,
      allSessions: sessions,
      stagesMap: {},
    };
  }, [isAdmin, colleges, stages, user.permissions, students, records, sessions, allStagesData]);

  const scope = useMemo(() => {
    const stage = currentStageId ? stages.find(s => s.id === currentStageId) : null;
    const college = stage ? colleges.find(c => c.id === stage.collegeId) : null;
    const meta = {
      colleges: accessibleData.accessibleColleges,
      stages: accessibleData.accessibleStages,
      stagesMap: accessibleData.stagesMap,
      stageName: stage?.name,
      collegeName: college?.name,
    };
    if (isAdmin && !currentStageId && accessibleData.allStudents.length > 0) {
      return {
        ...meta,
        students: accessibleData.allStudents,
        records: accessibleData.allRecords,
        sessions: accessibleData.allSessions,
      };
    }
    return { ...meta, students, records, sessions };
  }, [isAdmin, currentStageId, accessibleData, students, records, sessions, stages, colleges]);

  const dataLoaded = accessibleData.allStudents.length > 0;

  // بحث الطلاب + بطاقة الطالب + الاقتراحات — حالة معزولة في useChatBrain
  // (الدوال النقية في lib/chatBrain: buildLocalReply/computeStudentCard/fixDate)
  const {
    studentSearchQuery,
    studentSuggestions,
    selectedStudentCard,
    showStudentCard,
    showSuggestions,
    setShowSuggestions,
    handleStudentSearch,
    handleSelectStudent,
    sendStudentQuestion,
    clearStudentSearch,
  } = useChatBrain({ scope, setInput, inputRef });

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (studentSearchRef.current && !studentSearchRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [setShowSuggestions]);

  useEffect(() => {
    const el = messagesEndRef.current?.parentElement;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages, isTyping]);

  useEffect(() => {
    if (isOpen && messages.length === 0) {
      if (!isAdmin && !currentStageId) {
        setMessages([{
          id: Date.now().toString(),
          type: 'bot',
          content: 'اختر المرحلة أولاً حتى أكدر أجاوبك',
          timestamp: new Date(),
        }]);
      } else {
        const hint = isAdmin && !dataLoaded
          ? '\n\n💡 اضغط "⚡ تحميل بيانات الجامعة" في أعلى الشاشة، وبعدها اسألني عن تقرير طالب بالاسم أو "منو حضر اليوم؟".'
          : '';
        setMessages([{
          id: Date.now().toString(),
          type: 'bot',
          content: `اهلاً دكتور ${user.displayName}\n\nبشنو أكدر أساعدك اليوم؟${hint}`,
          timestamp: new Date(),
        }]);
      }
    }
  }, [isOpen, messages.length, user.displayName, isAdmin, currentStageId, dataLoaded]);

  useEffect(() => {
    if (!isOpen) return;
    const timer = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, [isOpen]);


  const sendMessage = useCallback((text: string) => {
    if (!text.trim() || isTyping) return;
    const now = Date.now();
    if (now - lastRequestTime.current < 500) {
      const wait = Math.ceil((500 - (now - lastRequestTime.current)) / 1000);
      setError(`انتظر ${wait} ثانية`);
      setTimeout(() => setError(null), 2000);
      return;
    }
    lastRequestTime.current = now;
    setError(null);

    const userMessage: Message = { id: Date.now().toString(), type: 'user', content: text.trim(), timestamp: new Date() };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    if (inputRef.current) inputRef.current.style.height = '';

    // الرد المحلي — يعمل 100% بدون أي API خارجي
    setIsTyping(true);
    setTimeout(() => {
      const local = buildLocalReply(text.trim(), scope);
      setMessages(prev => [...prev, { id: `${Date.now()}_bot`, type: 'bot', content: local.text, timestamp: new Date() }]);
      setIsTyping(false);
    }, 650);
  }, [isTyping, scope]);

  const sendMessageRef = useRef(sendMessage);
  sendMessageRef.current = sendMessage;

  const handleSend = useCallback(() => {
    // إيقاف التسجيل الصوتي تلقائياً عند الإرسال (بدون الحاجة لزر الإيقاف)
    if (isListening) {
      manualStopRef.current = true;
      try { recognitionRef.current?.stop(); } catch { /* ignore */ }
      setIsListening(false);
    }
    sendMessage(input);
  }, [input, sendMessage, isListening]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const requestClose = useCallback(() => {
    setClosing(true);
    window.setTimeout(() => { setIsOpen(false); setClosing(false); }, 280);
  }, []);

  const stopRecognition = useCallback((manual = false) => {
    manualStopRef.current = manual;
    try { recognitionRef.current?.stop(); } catch { /* ignore */ }
  }, []);

  const getRecognition = useCallback(() => {
    if (recognitionRef.current) return recognitionRef.current;
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return null;
    const rec = new SR();
    const voiceLangs = ['ar-IQ', 'ar-SA', 'ar'];
    rec.lang = voiceLangs[0];
    rec.continuous = false;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onresult = (event: any) => {
      let final = '';
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) final += event.results[i][0].transcript;
        else interim += event.results[i][0].transcript;
      }
      const combined = (final + interim).trim();
      lastTranscriptRef.current = combined;
      setInput(combined);
    };
    rec.onerror = (event: any) => {
      if (event.error === 'language-not-supported' && recognitionLangIndex.current < 2) {
        recognitionLangIndex.current++;
        const voiceLangs = ['ar-IQ', 'ar-SA', 'ar'];
        rec.lang = voiceLangs[recognitionLangIndex.current];
        try { rec.start(); setIsListening(true); } catch { /* ignore */ }
        return;
      }
      setIsListening(false);
      const messagesMap: Record<string, string> = {
        'not-allowed': 'رفض إذن المايك. سمح للمتصفح باستخدام المايك ثم حاول مرة ثانية.',
        'service-not-allowed': 'رفض إذن المايك. سمح للمتصفح باستخدام المايك ثم حاول مرة ثانية.',
        'audio-capture': 'ما أكدر أوصل للمايك. تأكد إنه متصل.',
        'no-speech': 'ما سمعت كلام. حاول مرة ثانية.',
        'network': 'مشكلة اتصال بالشبكة. حاول مرة ثانية.',
      };
      const msg = messagesMap[event.error];
      if (msg) {
        setVoiceError(msg);
        setTimeout(() => setVoiceError(null), 3500);
      }
    };
    rec.onend = () => {
      setIsListening(false);
      const text = lastTranscriptRef.current.trim();
      lastTranscriptRef.current = '';
      if (text && !manualStopRef.current) sendMessageRef.current(text);
    };
    recognitionRef.current = rec;
    return rec;
  }, []);

  const toggleListening = useCallback(() => {
    if (isListening) { stopRecognition(true); return; }
    const rec = getRecognition();
    if (!rec) return;
    setVoiceError(null);
    manualStopRef.current = false;
    lastTranscriptRef.current = '';
    setInput('');
    recognitionLangIndex.current = 0;
    try { rec.start(); setIsListening(true); } catch { setIsListening(false); }
  }, [isListening, getRecognition, stopRecognition]);

  useEffect(() => {
    if (!isOpen) {
      setIsListening(false);
      try { recognitionRef.current?.abort(); } catch { /* ignore */ }
    }
  }, [isOpen]);

  useEffect(() => () => {
    try { recognitionRef.current?.abort(); } catch { /* ignore */ }
    recognitionRef.current = null;
  }, []);

  const formatMessage = (content: string): React.ReactNode => {
    const lines = content.split('\n');
    return lines.map((line, i) => {
      const lineHasCheck = line.includes('✅');
      const lineHasCross = line.includes('❌');
      let lineClass = 'text-slate-300';
      if (lineHasCheck) lineClass = 'text-green-400';
      if (lineHasCross) lineClass = 'text-red-400';

      const parts: React.ReactNode[] = [];
      const boldRegex = /\*\*(.+?)\*\*/g;
      let lastIndex = 0, match, key = 0;
      while ((match = boldRegex.exec(line)) !== null) {
        if (match.index > lastIndex) parts.push(<React.Fragment key={`t-${i}-${key++}`}>{line.substring(lastIndex, match.index)}</React.Fragment>);
        let boldClass = 'font-bold text-white';
        if (lineHasCheck) boldClass = 'font-bold text-green-300';
        if (lineHasCross) boldClass = 'font-bold text-red-300';
        parts.push(<strong key={`b-${i}-${key++}`} className={boldClass}>{match[1]}</strong>);
        lastIndex = match.index + match[0].length;
      }
      if (lastIndex < line.length) parts.push(<React.Fragment key={`e-${i}-${key++}`}>{line.substring(lastIndex)}</React.Fragment>);
      if (parts.length === 0) parts.push(<React.Fragment key={`l-${i}`}>{line}</React.Fragment>);
      return (
        <React.Fragment key={i}>
          <span className={lineClass}>{parts}</span>
          {i < lines.length - 1 && <br />}
        </React.Fragment>
      );
    });
  };

  return (
    <>
      {/* 🟢 الحبة المصغرة (MorphPanel المطوي) */}
      {!isOpen && (
        <MorphPanel
          isExpanded={false}
          onToggle={() => setIsOpen(true)}
          input={input}
          onInputChange={setInput}
          onSend={handleSend}
          isTyping={isTyping}
          inputRef={inputRef}
          onKeyDown={handleKeyDown}
        />
      )}

      {/* 📄 نافذة الشات — انبساط ناعم من زر الماسنجر */}
      {isOpen && (
        <div
          key="chat-window"
          className={`fixed bottom-3 right-3 sm:bottom-6 sm:right-6 z-50 overflow-hidden border border-white/10 shadow-2xl max-w-[calc(100vw-1.5rem)] sm:max-w-[calc(100vw-3rem)] h-[min(560px,calc(100vh-3rem))] max-h-[calc(100vh-3rem)] overscroll-contain ${closing ? 'animate-chatClose' : 'animate-chatOpen'}`}
          style={{ backgroundColor: '#0f172a' }}
          onKeyDown={e => { e.stopPropagation(); }}
          onKeyUp={e => { e.stopPropagation(); }}
        >
          <div className="flex flex-col h-full">
              {/* شريط علوي: زر الإغلاق (يمين) مع خط فاصل تحته */}
              <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-white/10">
                <span className="text-xs text-slate-400 font-medium">المساعد الذكي</span>
                <button
                  onClick={requestClose}
                  className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-red-500/20 text-red-400 hover:text-red-300 text-sm transition"
                >
                  ✕
                </button>
              </div>

              {/* ✅ شريط البحث — يظهر عند توفر طلاب في النطاق الحالي */}
              {scope.students.length > 0 && (
                <div className="w-full px-4 pt-2">
                  <div className="max-w-xl mx-auto">
                    <div className="bg-white/5 border-b border-white/10">
                      <div className="relative px-3 py-2">
                        <div className="flex items-center gap-2 bg-slate-800 rounded-xl border border-white/10 focus-within:border-indigo-500/60 focus-within:ring-1 focus-within:ring-indigo-500/30 transition shadow-sm">
                          <span className="pr-3 text-slate-400 text-sm flex items-center"><Search className="w-4 h-4" /></span>
                          <input
                            type="text"
                            value={studentSearchQuery}
                            onChange={e => handleStudentSearch(e.target.value)}
                            onFocus={() => { if (studentSuggestions.length > 0) setShowSuggestions(true); }}
                            placeholder="ابحث عن طالب بالاسم أو الكود..."
                            className="flex-1 py-2 pl-3 text-sm bg-transparent outline-none text-right text-white placeholder:text-slate-500"
                            dir="rtl"
                            autoComplete="off"
                          />
                          {studentSearchQuery && (
                            <button
                              onClick={clearStudentSearch}
                              className="pl-2 pr-1 text-slate-400 hover:text-slate-200 transition"
                            >
                              ×
                            </button>
                          )}
                        </div>
                        <p className="text-[10px] text-slate-500 mt-1 text-right">اكتب الاسم أو الكود لعرض أيام الحضور والغياب فوراً</p>

                        {showSuggestions && studentSuggestions.length > 0 && (
                          <div className="absolute top-full left-0 right-0 mt-1 bg-slate-800 rounded-xl shadow-xl border border-white/10 z-[70] overflow-hidden max-h-[320px] overflow-y-auto">
                            {studentSuggestions.map(student => {
                              const sRecords = scope.records.filter(r => r.studentId === student.id);
                              const presentIds = new Set(sRecords.filter(r => r.status === 'present').map(r => r.sessionId));
                              const absentIds = new Set(sRecords.filter(r => r.status === 'absent').map(r => r.sessionId));
                              const sAttended = presentIds.size;
                              const sAbsent = absentIds.size;
                              const sPct = (sAttended + sAbsent) > 0 ? ((sAttended / (sAttended + sAbsent)) * 100).toFixed(1) : '0';
                              return (
                              <button
                                key={student.id}
                                onClick={() => handleSelectStudent(student)}
                                className="w-full text-right px-4 py-3 hover:bg-white/5 flex items-center gap-3 transition border-b border-white/10 last:border-0"
                              >
                                <div className="w-10 h-10 bg-blue-500/15 rounded-full flex items-center justify-center text-blue-300 font-bold text-sm border border-blue-500/30">
                                  {student.name.charAt(0)}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-semibold text-white truncate">{student.name}</p>
                                  <p className="text-[11px] text-slate-400">
                                    {student.code && `كود: ${student.code}`}
                                    {student.group && ` • كروب: ${student.group}`}
                                  </p>
                                  <p className="text-[10px] mt-0.5 text-slate-500">
                                    ✅ {sAttended} / ❌ {sAbsent} — {sPct}%
                                  </p>
                                </div>
                                <span className="text-slate-500 text-xs"><ChevronLeft className="w-4 h-4" /></span>
                              </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}

                  {showStudentCard && selectedStudentCard && (
                    <div className="mt-2 bg-slate-800 rounded-xl border border-white/10 shadow-md overflow-hidden">
                      <div className="bg-blue-500/10 px-4 py-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-blue-500/15 rounded-full flex items-center justify-center text-lg font-bold border border-blue-500/30 text-blue-300">
                              {selectedStudentCard.student.name.charAt(0)}
                            </div>
                            <div>
                              <h4 className="font-bold text-sm text-white">{selectedStudentCard.student.name}</h4>
                              <p className="text-[11px] text-slate-400">
                                {selectedStudentCard.student.code && `كود: ${selectedStudentCard.student.code}`}
                                {selectedStudentCard.student.group && ` • كروب: ${selectedStudentCard.student.group}`}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {selectedStudentCard.isPresentToday ? (
                              <div className="text-xs font-bold px-2 py-1 rounded-full flex items-center gap-1 bg-green-500/15 text-green-300">
                                <CircleCheck className="w-3.5 h-3.5" /> حاضر اليوم
                              </div>
                            ) : selectedStudentCard.isAbsentToday ? (
                              <div className="text-xs font-bold px-2 py-1 rounded-full flex items-center gap-1 bg-red-500/15 text-red-300">
                                <CircleX className="w-3.5 h-3.5" /> غائب اليوم
                              </div>
                            ) : (
                              <div className="text-xs font-bold px-2 py-1 rounded-full flex items-center gap-1 bg-slate-500/15 text-slate-300">
                                <CircleX className="w-3.5 h-3.5" /> غير مسجل اليوم
                              </div>
                            )}
                            <button
                              onClick={clearStudentSearch}
                              className="w-6 h-6 flex items-center justify-center rounded-md hover:bg-red-500/20 text-red-400 hover:text-red-300 text-sm transition flex-shrink-0"
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-3 divide-x divide-x-reverse divide-white/10">
                        <div className="text-center py-3 px-2">
                          <p className="text-lg font-bold text-green-400">{selectedStudentCard.attendedCount}</p>
                          <p className="text-[10px] text-slate-400 flex items-center justify-center gap-1"><CircleCheck className="w-3 h-3" /> حضور</p>
                        </div>
                        <div className="text-center py-3 px-2">
                          <p className="text-lg font-bold text-red-400">{selectedStudentCard.absentCount}</p>
                          <p className="text-[10px] text-slate-400 flex items-center justify-center gap-1"><CircleX className="w-3 h-3" /> غياب</p>
                        </div>
                        <div className="text-center py-3 px-2">
                          <p className={`text-lg font-bold ${parseFloat(selectedStudentCard.percentage) >= 75 ? 'text-green-400' : parseFloat(selectedStudentCard.percentage) >= 50 ? 'text-yellow-400' : 'text-red-400'}`}>
                            {selectedStudentCard.percentage}%
                          </p>
                          <p className="text-[10px] text-slate-400">النسبة</p>
                        </div>
                      </div>

                      <div className="border-t border-white/10">
                        <button
                          onClick={() => setShowDayDetails(v => !v)}
                          className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-bold text-slate-300 hover:bg-white/5 transition"
                        >
                          <span className="flex items-center gap-1.5"><ClipboardList className="w-3.5 h-3.5 text-blue-400" /> أيام الحضور والغياب</span>
                          <span className="text-slate-400">{showDayDetails ? '▲' : '▼'}</span>
                        </button>
                        {showDayDetails && (
                          <div className="px-3 pb-3 space-y-2.5 max-h-48 overflow-y-auto">
                            <div>
                              <p className="text-[11px] font-bold text-green-400 mb-1">✅ أيام الحضور ({selectedStudentCard.attendedDays.length})</p>
                              <div className="space-y-1">
                                {selectedStudentCard.attendedDays.length === 0 ? (
                                  <p className="text-[11px] text-slate-500 px-1">لا يوجد</p>
                                ) : selectedStudentCard.attendedDays.map(d => (
                                  <div key={d.date} className="flex items-center justify-between bg-green-500/10 border border-green-500/30 rounded-lg px-2.5 py-1.5 text-xs text-green-300">
                                    <span>{d.label}</span>
                                    <span className="text-[10px] text-green-400">{d.count} محاضرة</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                            <div>
                              <p className="text-[11px] font-bold text-red-400 mb-1">❌ أيام الغياب ({selectedStudentCard.absentDays.length})</p>
                              <div className="space-y-1">
                                {selectedStudentCard.absentDays.length === 0 ? (
                                  <p className="text-[11px] text-slate-500 px-1">لا يوجد</p>
                                ) : selectedStudentCard.absentDays.map(d => (
                                  <div key={d.date} className="flex items-center justify-between bg-red-500/10 border border-red-500/30 rounded-lg px-2.5 py-1.5 text-xs text-red-300">
                                    <span>{d.label}</span>
                                    <span className="text-[10px] text-red-400">{d.count} محاضرة</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="flex gap-2 p-3 bg-white/5 border-t border-white/10">
                        <button
                          onClick={() => setShowSessionsModal(true)}
                          className="flex-1 bg-gradient-to-l from-emerald-500 to-green-600 text-white text-[11px] py-2.5 rounded-lg hover:from-emerald-600 hover:to-green-700 transition font-medium shadow-sm flex items-center justify-center gap-1.5"
                        >
                          <ClipboardList className="w-3.5 h-3.5" /> سجلات الحضور ({selectedStudentCard.attendedSessions.length})
                        </button>
                        <button
                          onClick={() => sendStudentQuestion(selectedStudentCard.student)}
                          className="flex-1 bg-blue-500 text-white text-[11px] py-2.5 rounded-lg hover:bg-blue-600 transition font-medium shadow-sm flex items-center justify-center gap-1.5"
                        >
                          <MessageCircle className="w-3.5 h-3.5" /> اسأل عن الطالب
                        </button>
                      </div>
                    </div>
              )}

              {/* نافذة منبثقة لكل السجلات */}
              {showSessionsModal && selectedStudentCard && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
                     onMouseDown={() => setShowSessionsModal(false)}>
                  <div className="bg-slate-900 rounded-2xl shadow-2xl border border-white/10 w-[calc(100%-16px)] max-h-[calc(100%-16px)] flex flex-col overflow-hidden"
                       onMouseDown={e => e.stopPropagation()}>
                    <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-white/5 flex-shrink-0">
                      <span className="text-sm font-bold text-white flex items-center gap-1.5"><ClipboardList className="w-4 h-4" /> سجلات حضور {selectedStudentCard.student.name}</span>
                      <button
                        onClick={() => setShowSessionsModal(false)}
                        className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-red-500/20 text-red-400 hover:text-red-300 text-sm transition"
                      >
                        ✕
                      </button>
                    </div>
                    <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
                      {selectedStudentCard.attendedSessions.length === 0 ? (
                        <div className="text-center py-8 text-slate-400 text-sm">لا توجد سجلات</div>
                      ) : (
                        selectedStudentCard.attendedSessions.map((as_, idx) => (
                          <div key={idx}
                               className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm ${
                                 as_.present
                                   ? 'bg-green-500/10 border border-green-500/30 text-green-300'
                                   : as_.absent
                                   ? 'bg-red-500/10 border border-red-500/30 text-red-300'
                                   : 'bg-white/5 border border-white/10 text-slate-400'
                               }`}>
                            <span className="flex-shrink-0">{as_.present ? <CircleCheck className="w-5 h-5 text-green-400" /> : as_.absent ? <CircleX className="w-5 h-5 text-red-400" /> : <CircleX className="w-5 h-5 text-slate-400" />}</span>
                            <div className="flex-1 min-w-0">
                              <p className="font-semibold truncate">{as_.session.name}</p>
                              <p className={`text-[11px] mt-0.5 ${as_.present ? 'text-green-400' : as_.absent ? 'text-red-400' : 'text-slate-400'}`}>
                                {formatDateWithDay(as_.session._normalizedDate)}
                              </p>
                            </div>
                            {!as_.present && !as_.absent && (
                              <span className="text-[10px] font-medium text-slate-400 flex-shrink-0">غير مسجل</span>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                    <div className="px-4 py-2.5 border-t border-white/10 bg-white/5 flex-shrink-0 flex justify-between items-center">
                      <span className="text-[11px] text-slate-400 flex items-center gap-1">
                        <CircleCheck className="w-3 h-3" /> {selectedStudentCard.attendedCount} حضور • <CircleX className="w-3 h-3" /> {selectedStudentCard.absentCount} غياب
                      </span>
                      <button
                        onClick={() => setShowSessionsModal(false)}
                        className="px-4 py-1.5 bg-white/10 hover:bg-white/20 text-slate-300 text-xs rounded-lg transition font-medium"
                      >
                        إغلاق
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* 💬 الرسائل */}
              <div className="flex-1 min-h-0 overflow-y-auto pb-4 space-y-3 px-3 overscroll-contain" style={{ backgroundColor: '#0f172a' }}>
                {messages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`flex ${msg.type === 'user' ? 'justify-end' : 'justify-start'} animate-fadeUp`}
                    >
                    <div className={`max-w-[90%] rounded-2xl p-3 shadow-sm ${
                      msg.type === 'user'
                        ? 'bg-blue-600 text-white rounded-br-sm'
                        : 'bg-slate-800 text-white border border-white/10 rounded-bl-sm'
                    }`}>
                      {msg.type === 'bot' && (
                        <div className="flex items-center gap-1 mb-1.5 text-[10px] text-slate-400 font-semibold">
                          <Sparkles className="w-3.5 h-3.5 text-amber-400" /><span>المساعد الذكي</span>
                        </div>
                      )}
                      <div className={`text-sm leading-relaxed whitespace-pre-wrap break-words ${
                        msg.type === 'user' ? 'text-white' : 'text-slate-200'
                      }`}>{formatMessage(msg.content)}</div>
                      <p className={`text-[10px] mt-1.5 ${
                        msg.type === 'user' ? 'text-white/70' : 'text-slate-400'
                      }`}>
                        {msg.timestamp.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  </div>
                ))}

                {isTyping && (
                  <div className="flex justify-start animate-fadeUp">
                    <div className="bg-slate-800 border border-white/10 rounded-2xl rounded-bl-sm p-3 shadow-sm">
                      <div className="flex items-center gap-2">
                        <div className="flex gap-1">
                          <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                          <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                          <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                        </div>
                        <span className="text-xs text-slate-400">يكتب...</span>
                      </div>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* ⚠️ شريط الأخطاء */}
              {error && (
                <div role="alert" className="px-3 py-2 bg-red-500/10 border-t border-red-500/30">
                  <p className="text-xs text-red-300 flex items-center gap-1.5"><CircleX className="w-3.5 h-3.5 shrink-0" /> {error}</p>
                </div>
              )}

              {/* ⌨️ منطقة الإدخال */}
              {(() => {
                const isInputBlocked = !isAdmin && !currentStageId;
                return (
                  <div className="border-t border-white/10" style={{ backgroundColor: '#0f172a' }}>
                    {!isTyping && !isInputBlocked && messages.length > 0 && (() => {
                      const chips: { label: string; q: string }[] = !dataLoaded
                        ? [
                            { label: '✅ منو حضر اليوم؟', q: 'منو حضر اليوم؟' },
                            { label: '❌ منو غاب اليوم؟', q: 'منو غاب اليوم؟' },
                          ]
                        : [
                            { label: '✅ منو حضر اليوم؟', q: 'منو حضر اليوم؟' },
                            { label: '❌ منو غاب اليوم؟', q: 'منو غاب اليوم؟' },
                            { label: '📋 حضر اليوم + غاب اليوم', q: 'منو حضر اليوم ومنو غاب اليوم؟' },
                          ];
                      return (
                        <div className="px-3 pt-2 pb-0 flex flex-wrap gap-1.5">
                          {chips.map(c => (
                            <button
                              key={c.q}
                              onClick={() => sendMessage(c.q)}
                              className="text-[11px] font-medium text-slate-300 bg-white/5 hover:bg-white/10 border border-white/10 rounded-full px-3 py-1.5 transition"
                            >
                              {c.label}
                            </button>
                          ))}
                        </div>
                      );
                    })()}
                    <div className="px-3 py-2">
                      {(isListening || voiceError) && (
                        <div className="mb-2 flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium bg-red-500/10 text-red-300 border border-red-500/30">
                          {voiceError ? (
                            <>
                              <CircleX className="w-3.5 h-3.5 shrink-0" />
                              {voiceError}
                            </>
                          ) : (
                            <>
                              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                              جاري الاستماع... تكلّم الآن
                            </>
                          )}
                        </div>
                      )}
                      <div className={`flex items-end gap-2 rounded-xl border-2 bg-slate-800 px-3 py-2 transition ${
                        isInputBlocked ? 'border-slate-600 opacity-50' : 'border-white/20 focus-within:border-indigo-500'
                      }`}>
                        <textarea
                          ref={inputRef as React.Ref<HTMLTextAreaElement>}
                          value={input}
                          onChange={e => setInput(e.target.value)}
                          onKeyDown={handleKeyDown}
                          placeholder={isInputBlocked ? 'الإدخال متوقف مؤقتاً...' : 'اكتب سؤالك هنا...'}
                          className="flex-1 resize-none outline-none text-sm bg-transparent text-white placeholder:text-slate-500"
                          rows={1}
                          style={{ minHeight: 24, maxHeight: 80 }}
                          disabled={isTyping || isInputBlocked}
                          spellCheck={false}
                        />
                        {voiceSupported && (
                          <button
                            onClick={toggleListening}
                            disabled={isTyping || isInputBlocked}
                            title={isListening ? 'إيقاف التسجيل' : 'بحث صوتي'}
                            className={`w-7 h-7 flex items-center justify-center rounded-lg transition flex-shrink-0 text-sm disabled:opacity-30 disabled:cursor-not-allowed ${
                              isListening
                                ? 'bg-red-500 text-white animate-pulse'
                                : 'bg-white/10 text-slate-300 hover:bg-white/20'
                            }`}
                          >
                            {isListening ? <Square className="w-3.5 h-3.5" /> : <Mic className="w-4 h-4" />}
                          </button>
                        )}
                        <button
                          onClick={handleSend}
                          disabled={isTyping || !input.trim() || isInputBlocked}
                          className="w-7 h-7 flex items-center justify-center rounded-lg bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-30 disabled:cursor-not-allowed transition flex-shrink-0 text-sm"
                        >
                          <ArrowUp className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        )}
    </>
  );
});
