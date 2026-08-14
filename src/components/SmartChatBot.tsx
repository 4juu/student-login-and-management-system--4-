import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
} from 'react';
import {
  Student,
  AttendanceRecord,
  AttendanceSession,
  College,
  Stage,
} from '../types/student';
import { User } from '../types/user';
import { AnimatePresence, motion } from "motion/react"
import { MorphPanel } from './MorphPanel';
import { ArrowUp, ChevronLeft, CircleCheck, CircleX, ClipboardList, MessageCircle, Search, Sparkles } from 'lucide-react';

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
  currentCollegeId?: string | null;
  currentStageId?: string | null;
  students: Student[];
  records: AttendanceRecord[];
  sessions: AttendanceSession[];
  activeSessionId?: string | null;
  allTeachers?: User[];
  allStagesData?: {
    [stageId: string]: {
      students: Student[];
      records: AttendanceRecord[];
      sessions: AttendanceSession[];
    };
  };
  // 🆕 3 Props جديدة فقط
  onRequestUniversityData?: () => Promise<void>;
  universityDataLoaded?: boolean;
  universityDataLoading?: boolean;
}

// ✅ API Keys
const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY as string;
const OPENROUTER_API_KEY = import.meta.env.VITE_OPENROUTER_API_KEY as string;

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

const GROQ_API_KEY = import.meta.env.VITE_GROQ_API_KEY as string;
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

interface AIModel {
  id: string;
  name: string;
  provider: 'gemini' | 'openrouter' | 'groq';
  model: string;
  emoji: string;
}

const AI_MODELS: AIModel[] = [
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash ⚡', provider: 'gemini', model: 'gemini-2.5-flash', emoji: '🟡' },
  { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', provider: 'gemini', model: 'gemini-2.0-flash', emoji: '🟡' },
  { id: 'gemini-2.0-flash-exp', name: 'Gemini 2.0 Exp 🧪', provider: 'gemini', model: 'gemini-2.0-flash-exp', emoji: '🟡' },
  { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash', provider: 'gemini', model: 'gemini-1.5-flash', emoji: '🟡' },
  { id: 'gemini-1.5-flash-8b', name: 'Gemini 1.5 Flash 8B', provider: 'gemini', model: 'gemini-1.5-flash-8b', emoji: '🟡' },
  { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro 🧠', provider: 'gemini', model: 'gemini-1.5-pro', emoji: '🟡' },
  { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B ⚡', provider: 'groq', model: 'llama-3.3-70b-versatile', emoji: '⚡' },
  { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B (سريع جداً)', provider: 'groq', model: 'llama-3.1-8b-instant', emoji: '⚡' },
  { id: 'llama3-70b-8192', name: 'Llama 3 70B', provider: 'groq', model: 'llama3-70b-8192', emoji: '⚡' },
  { id: 'llama3-8b-8192', name: 'Llama 3 8B', provider: 'groq', model: 'llama3-8b-8192', emoji: '⚡' },
  { id: 'gemma2-9b-it', name: 'Gemma 2 9B', provider: 'groq', model: 'gemma2-9b-it', emoji: '⚡' },
  { id: 'mixtral-8x7b', name: 'Mixtral 8x7B', provider: 'groq', model: 'mixtral-8x7b-32768', emoji: '⚡' },
  { id: 'deepseek-r1-distill-llama-70b', name: 'DeepSeek R1 70B 🧠', provider: 'groq', model: 'deepseek-r1-distill-llama-70b', emoji: '⚡' },
  { id: 'qwen-qwq-32b', name: 'Qwen QwQ 32B 🧠', provider: 'groq', model: 'qwen-qwq-32b', emoji: '⚡' },
];

const getGeminiUrl = (model: string) =>
  `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const pad2 = (n: number) => String(n).padStart(2, '0');

const toEnglishDigits = (str: string): string => {
  if (!str) return '';
  return String(str).replace(/[\u0660-\u0669\u06F0-\u06F9]/g, (ch) => {
    const code = ch.charCodeAt(0);
    if (code >= 0x0660 && code <= 0x0669) return String(code - 0x0660);
    if (code >= 0x06F0 && code <= 0x06F9) return String(code - 0x06F0);
    return ch;
  });
};

const normalizeDateKey = (value?: string | Date | null): string => {
  try {
    if (!value) return '';
    if (value instanceof Date) {
      if (isNaN(value.getTime())) return '';
      return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`;
    }
    let text = String(value).trim();
    if (!text) return '';
    text = toEnglishDigits(text);
    text = text.replace(/[/\\.]/g, '-');
    const ymdMatch = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (ymdMatch) {
      return `${ymdMatch[1]}-${pad2(parseInt(ymdMatch[2]))}-${pad2(parseInt(ymdMatch[3]))}`;
    }
    const dmyMatch = text.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
    if (dmyMatch && dmyMatch[3].length === 4) {
      return `${dmyMatch[3]}-${pad2(parseInt(dmyMatch[2]))}-${pad2(parseInt(dmyMatch[1]))}`;
    }
    const dateObj = new Date(text);
    if (!isNaN(dateObj.getTime())) {
      return `${dateObj.getFullYear()}-${pad2(dateObj.getMonth() + 1)}-${pad2(dateObj.getDate())}`;
    }
    return '';
  } catch (e) {
    return '';
  }
};

const formatDateWithDay = (value?: string | Date | null): string => {
  const key = normalizeDateKey(value);
  if (!key) return '-';
  const days = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  const months = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  const d = new Date(`${key}T12:00:00`);
  if (isNaN(d.getTime())) return key;
  return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
};

const getGeminiText = (data: any): string => {
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts.map((p: any) => p?.text || '').join('').trim();
};

const getErrorMessage = (status: number, errorData: any): string => {
  const msg = errorData?.error?.message || '';
  switch (status) {
    case 400: return `طلب غير صحيح: ${msg}`;
    case 401: return 'API Key غير صحيحة';
    case 403: return 'API Key ما عندها صلاحية';
    case 404: return 'الموديل غير موجود';
    case 429: return 'تم تجاوز الحد المسموح';
    case 500: return 'خطأ داخلي من السيرفر';
    case 503: return 'الخدمة مزدحمة حالياً';
    default: return `خطأ ${status}: ${msg}`;
  }
};

const callGeminiDirect = async (model: string, contents: any[]): Promise<string> => {
  const response = await fetch(getGeminiUrl(model), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents,
      generationConfig: { temperature: 0.1, topK: 20, topP: 0.85, maxOutputTokens: 8192 },
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
      ],
    }),
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const err: any = new Error(getErrorMessage(response.status, errorData));
    err.status = response.status;
    throw err;
  }
  const data = await response.json();
  const text = getGeminiText(data);
  if (!text) {
    const finishReason = data?.candidates?.[0]?.finishReason;
    const err: any = new Error(finishReason === 'SAFETY' ? 'SAFETY_BLOCKED' : 'EMPTY_RESPONSE');
    err.status = 0;
    throw err;
  }
  return text;
};

const callGroqDirect = async (
  model: string,
  systemInstruction: string,
  conversationHistory: Message[],
  userMessage: string
): Promise<string> => {
  if (!GROQ_API_KEY) {
    const err: any = new Error('NO_GROQ_KEY');
    err.status = 401;
    throw err;
  }
  const messages: any[] = [{ role: 'system', content: systemInstruction }];
  conversationHistory.slice(-6).forEach(msg => {
    messages.push({ role: msg.type === 'user' ? 'user' : 'assistant', content: msg.content });
  });
  messages.push({ role: 'user', content: userMessage });

  const response = await fetch(GROQ_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROQ_API_KEY}` },
    body: JSON.stringify({ model, messages, temperature: 0.1, max_tokens: 8192, top_p: 0.85, stream: false }),
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const err: any = new Error(errorData?.error?.message || `Error ${response.status}`);
    err.status = response.status;
    throw err;
  }
  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) { const err: any = new Error('EMPTY_RESPONSE'); err.status = 0; throw err; }
  return text;
};

const callOpenRouterDirect = async (
  model: string,
  systemInstruction: string,
  conversationHistory: Message[],
  userMessage: string
): Promise<string> => {
  if (!OPENROUTER_API_KEY) {
    const err: any = new Error('NO_OPENROUTER_KEY');
    err.status = 401;
    throw err;
  }
  const messages: any[] = [{ role: 'system', content: systemInstruction }];
  conversationHistory.slice(-6).forEach(msg => {
    messages.push({ role: msg.type === 'user' ? 'user' : 'assistant', content: msg.content });
  });
  messages.push({ role: 'user', content: userMessage });

  const response = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      'HTTP-Referer': typeof window !== 'undefined' ? window.location.origin : '',
      'X-Title': 'Attendance System AI',
    },
    body: JSON.stringify({ model, messages, temperature: 0.1, max_tokens: 8192, top_p: 0.85 }),
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const err: any = new Error(errorData?.error?.message || `Error ${response.status}`);
    err.status = response.status;
    throw err;
  }
  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) { const err: any = new Error('EMPTY_RESPONSE'); err.status = 0; throw err; }
  return text;
};

interface StudentQuickCard {
  student: Student;
  attendedCount: number;
  absentCount: number;
  percentage: string;
  isPresentToday: boolean;
  isAbsentToday: boolean;
  attendedSessions: { session: AttendanceSession & { _normalizedDate: string }; present: boolean; absent: boolean }[];
  attendedDays: { date: string; label: string; count: number }[];
  absentDays: { date: string; label: string; count: number }[];
}

export const SmartChatBot: React.FC<SmartChatBotProps> = ({
  user,
  colleges,
  stages,
  currentCollegeId,
  currentStageId,
  students,
  records,
  sessions,
  activeSessionId: _activeSessionId,
  allTeachers: _allTeachers = [],
  allStagesData = {},
  // 🆕 Props جديدة
  universityDataLoaded = false,
}) => {
  const isAdmin = user.role === 'admin';
  const currentCollege = colleges.find(c => c.id === currentCollegeId);
  const currentStage = stages.find(s => s.id === currentStageId);

  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentModelIndex, setCurrentModelIndex] = useState(0);
  const [failedModels, setFailedModels] = useState<Set<string>>(new Set());
  const selectedModelId = 'auto';

  const [studentSearchQuery, setStudentSearchQuery] = useState('');
  const [studentSuggestions, setStudentSuggestions] = useState<Student[]>([]);
  const [selectedStudentCard, setSelectedStudentCard] = useState<StudentQuickCard | null>(null);
  const [showStudentCard, setShowStudentCard] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [showSessionsModal, setShowSessionsModal] = useState(false);
  const [showDayDetails, setShowDayDetails] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const lastRequestTime = useRef<number>(0);
  const studentSearchRef = useRef<HTMLDivElement>(null);
  const contextCacheRef = useRef<{ key: string; value: string }>({ key: '', value: '' });

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (studentSearchRef.current && !studentSearchRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

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
    const accessibleColleges = colleges.filter(c => !!allowedStagesMap[c.id] && allowedStagesMap[c.id].length > 0);
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
    if (isAdmin && !currentStageId && accessibleData.allStudents.length > 0) {
      return {
        students: accessibleData.allStudents,
        records: accessibleData.allRecords,
        sessions: accessibleData.allSessions,
      };
    }
    return { students, records, sessions };
  }, [isAdmin, currentStageId, accessibleData, students, records, sessions]);

  const fixDate = useCallback((rawDate: any): string => {
    if (!rawDate) return '';
    if (rawDate instanceof Date) {
      const y = rawDate.getFullYear();
      const m = String(rawDate.getMonth() + 1).padStart(2, '0');
      const d = String(rawDate.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
    let text = String(rawDate).trim();
    text = text.replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '');
    let cleaned = '';
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (code >= 0x0660 && code <= 0x0669) cleaned += String(code - 0x0660);
      else if (code >= 0x06F0 && code <= 0x06F9) cleaned += String(code - 0x06F0);
      else cleaned += text[i];
    }
    const numbers = cleaned.match(/\d+/g);
    if (!numbers || numbers.length < 3) return cleaned;
    let yearIdx = -1;
    for (let i = 0; i < numbers.length; i++) {
      if (numbers[i].length === 4) { yearIdx = i; break; }
    }
    let year = '', month = '', day = '';
    if (yearIdx === 0) { year = numbers[0]; month = numbers[1]; day = numbers[2]; }
    else if (yearIdx === 2) { day = numbers[0]; month = numbers[1]; year = numbers[2]; }
    else if (yearIdx === 1) { month = numbers[0]; year = numbers[1]; day = numbers[2]; }
    else { year = numbers[0]; month = numbers[1]; day = numbers[2]; }
    if (!year || !month || !day) return cleaned;
    return `${year}-${String(parseInt(month)).padStart(2, '0')}-${String(parseInt(day)).padStart(2, '0')}`;
  }, []);

  const computeStudentCard = useCallback((student: Student): StudentQuickCard => {
    const todayKey = fixDate(new Date());
    const scRecords = scope.records;
    const scSessions = scope.sessions;

    const fixedSessions = scSessions.map(s => ({
      ...s,
      _normalizedDate: fixDate((s as any).date),
    }));

    const sortedSessions = [...fixedSessions].sort((a, b) => {
      if (a._normalizedDate !== b._normalizedDate) return a._normalizedDate.localeCompare(b._normalizedDate);
      return String(a.name || '').localeCompare(String(b.name || ''), 'ar');
    });

    const studentRecords = scRecords.filter(r => r.studentId === student.id);
    const presentSessionIds = new Set(studentRecords.filter(r => r.status === 'present').map(r => r.sessionId));
    const absentSessionIds = new Set(studentRecords.filter(r => r.status === 'absent').map(r => r.sessionId));

    const todaySessionIds = new Set<string>();
    fixedSessions.forEach(s => { if (s._normalizedDate === todayKey) todaySessionIds.add(s.id); });
    const isPresentToday = studentRecords.some(r => r.status === 'present' && todaySessionIds.has(r.sessionId));
    const isAbsentToday = studentRecords.some(r => r.status === 'absent' && todaySessionIds.has(r.sessionId));

    const attendedCount = presentSessionIds.size;
    const absentCount = absentSessionIds.size;
    const percentage = (attendedCount + absentCount) > 0
      ? ((attendedCount / (attendedCount + absentCount)) * 100).toFixed(1)
      : '0';

    const attendedSessions = sortedSessions.map(s => ({
      session: s,
      present: presentSessionIds.has(s.id),
      absent: absentSessionIds.has(s.id),
    }));

    const sessionById = new Map(fixedSessions.map(s => [s.id, s]));
    const sessionDateOf = (record: AttendanceRecord): string => {
      const sess = sessionById.get(record.sessionId);
      return sess?._normalizedDate || '';
    };
    const attendedDates = new Set<string>();
    const absentDates = new Set<string>();
    studentRecords.forEach(r => {
      const d = sessionDateOf(r);
      if (!d) return;
      if (r.status === 'present') attendedDates.add(d);
      else if (r.status === 'absent') absentDates.add(d);
    });
    const attendedDays = [...attendedDates].sort().reverse().map(date => ({
      date,
      label: formatDateWithDay(date),
      count: studentRecords.filter(r => r.status === 'present' && sessionDateOf(r) === date).length,
    }));
    const absentDays = [...absentDates].sort().reverse().map(date => ({
      date,
      label: formatDateWithDay(date),
      count: studentRecords.filter(r => r.status === 'absent' && sessionDateOf(r) === date).length,
    }));

    return { student, attendedCount, absentCount, percentage, isPresentToday, isAbsentToday, attendedSessions, attendedDays, absentDays };
  }, [scope, fixDate]);

  const handleStudentSearch = useCallback((query: string) => {
    setStudentSearchQuery(query);
    setShowStudentCard(false);
    setSelectedStudentCard(null);

    if (query.trim().length < 2) {
      setStudentSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    const q = query.trim().toLowerCase();
    const matches = scope.students.filter(s =>
      s.name.toLowerCase().includes(q) ||
      s.code?.toLowerCase().includes(q) ||
      s.group?.toLowerCase().includes(q)
    ).slice(0, 15);

    setStudentSuggestions(matches);
    setShowSuggestions(matches.length > 0);
  }, [scope]);

  const handleSelectStudent = useCallback((student: Student) => {
    const card = computeStudentCard(student);
    setSelectedStudentCard(card);
    setShowStudentCard(true);
    setShowSuggestions(false);
    setStudentSearchQuery(student.name);
  }, [computeStudentCard]);

  const sendStudentQuestion = useCallback((student: Student) => {
    const question = `أعطني تفاصيل حضور وغياب الطالب ${student.name}`;
    setInput(question);
    setShowStudentCard(false);
    setShowSuggestions(false);
    setStudentSearchQuery('');
    setTimeout(() => inputRef.current?.focus(), 100);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
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
        setMessages([{
          id: Date.now().toString(),
          type: 'bot',
          content: `اهلاً دكتور ${user.displayName}\n\nبشنو أكدر أساعدك اليوم؟`,
          timestamp: new Date(),
        }]);
      }
    }
  }, [isOpen, messages.length, user.displayName, isAdmin, currentStageId]);

  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  const buildDataContext = useCallback((): string => {
    // تخزين مؤقت — نعيد الاستخدام إذا البيانات ما تغيرت
    const dataKey = JSON.stringify({
      sl: students.length,
      rl: records.length,
      sel: sessions.length,
      cid: currentStageId,
      uid: user.uid,
      m: isAdmin,
      ul: universityDataLoaded ? '1' : '0',
    });
    if (contextCacheRef.current.key === dataKey) return contextCacheRef.current.value;

    const now = new Date();
    const todayDate = fixDate(now);

    const fixedSessions = sessions.map(s => ({
      ...s,
      date: fixDate((s as any).date),
    }));

    const sortedSessions = [...fixedSessions].sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return String(a.name || '').localeCompare(String(b.name || ''), 'ar');
    });

    const groups = Array.from(new Set(students.map(s => s.group).filter(Boolean))) as string[];
    groups.sort((a, b) => a.localeCompare(b, 'ar'));

    // 📊 إحصاءات اليوم
    const todaySessionIds = new Set<string>();
    sortedSessions.forEach(s => { if (s.date === todayDate) todaySessionIds.add(s.id); });
    const todayRecords = records.filter(r => todaySessionIds.has(r.sessionId));
    const presentTodayIds = new Set(todayRecords.filter(r => r.status === 'present').map(r => r.studentId));
    const absentTodayIds = new Set(todayRecords.filter(r => r.status === 'absent').map(r => r.studentId));
    const todaySessionList = sortedSessions.filter(s => todaySessionIds.has(s.id));
    const presentToday = students.filter(s => presentTodayIds.has(s.id));
    const absentToday = students.filter(s => absentTodayIds.has(s.id));
    const unrecordedToday = students.length - presentToday.length - absentToday.length;

    // 🚨 إجابات مؤكدة
    let context = `# 🚨 إجابات مؤكدة 100% من قاعدة البيانات\n\n`;
    context += `## 📊 إحصاءات دقيقة (محسوبة من النظام مباشرة):\n`;
    context += `- إجمالي الطلاب: **${students.length}**\n`;
    context += `- إجمالي المحاضرات: **${sortedSessions.length}**\n`;
    if (todaySessionList.length > 0) {
      context += `- حضور اليوم: ✅ **${presentToday.length}** حاضر / ❌ **${absentToday.length}** غائب${unrecordedToday > 0 ? ` / ⬜ **${unrecordedToday}** غير مسجل` : ''}\n`;
      context += `- نسبة حضور اليوم: **${students.length > 0 ? ((presentToday.length / students.length) * 100).toFixed(1) : '0'}%**\n`;
      context += `- محاضرات اليوم: **${todaySessionList.length}**\n`;
    }
    if (groups.length > 0) {
      context += `\n### 📊 إحصاءات الكروبات:\n`;
      groups.forEach(g => {
        const gStudents = students.filter(s => s.group === g);
        const gIds = new Set(gStudents.map(s => s.id));
        const gRecs = records.filter(r => gIds.has(r.studentId) && r.status === 'present');
        const possible = gStudents.length * sortedSessions.length;
        const rate = possible > 0 ? ((gRecs.length / possible) * 100).toFixed(1) : '0';
        const gp = gStudents.filter(s => presentTodayIds.has(s.id)).length;
        context += `- **${g}**: ${gStudents.length} طالب | حضور عام ${rate}% | اليوم ✅${gp} ❌${gStudents.length - gp}\n`;
      });
    }
    const totalPossible = students.length * sortedSessions.length;
    const overallRate = totalPossible > 0 ? ((records.filter(r => r.status === 'present').length / totalPossible) * 100).toFixed(2) : '0';
    context += `\n- 📈 نسبة الحضور العامة: **${overallRate}%**\n\n`;
    context += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

    // معلومات المستخدم والتاريخ
    context += `## معلومات المستخدم:\n- الاسم: ${user.displayName}\n- الدور: ${isAdmin ? 'أدمن' : 'تدريسي'}\n\n`;
    context += `## التاريخ الحالي:\n- اليوم: ${formatDateWithDay(todayDate)}\n- التاريخ: ${todayDate}\n- الوقت: ${now.toLocaleTimeString('ar-EG')}\n\n`;
    if (currentCollege && currentStage) {
      context += `## الموقع الحالي:\n- الكلية: ${currentCollege.name}\n- المرحلة: ${currentStage.name}\n\n`;
    }

    if (currentStageId && students.length > 0) {
      // تفصيل محاضرات اليوم
      if (todaySessionList.length > 0) {
        context += `## 🌟 تفصيل محاضرات اليوم:\n\n`;
        todaySessionList.forEach((session, idx) => {
          const sRecs = records.filter(r => r.sessionId === session.id && r.status === 'present');
          const sPresentCount = sRecs.length;
          const sAbsentCount = records.filter(r => r.sessionId === session.id && r.status === 'absent').length;
          const sRate = students.length > 0 ? ((sPresentCount / students.length) * 100).toFixed(1) : '0';
          context += `**${idx + 1}. ${session.name}** | ✅${sPresentCount} ❌${sAbsentCount} | ${sRate}%\n`;
        });
        context += `\n`;
      }

      // جميع المحاضرات بالتفصيل — أسماء الحاضرين والغائبين لكل سجل
      context += `## 📅 تفاصيل جميع المحاضرات:\n`;
      sortedSessions.forEach((session, idx) => {
        const presentIds = new Set(records.filter(r => r.sessionId === session.id && r.status === 'present').map(r => r.studentId));
        const absentIds = new Set(records.filter(r => r.sessionId === session.id && r.status === 'absent').map(r => r.studentId));
        const presentStudents = students.filter(s => presentIds.has(s.id));
        const absentStudents = students.filter(s => absentIds.has(s.id));
        const isT = session.date === todayDate ? ' 🌟' : '';
        context += `\n---\n### ${idx + 1}. ${session.name}${isT}\n`;
        context += `📅 التاريخ: ${formatDateWithDay(session.date)}\n`;
        context += `✅ الحاضرون (${presentStudents.length}): ${presentStudents.map(s => s.name).join(', ')}\n`;
        context += `❌ الغائبون (${absentStudents.length}): ${absentStudents.map(s => s.name).join(', ')}\n`;
      });
      context += `\n`;

      // الطلاب — سطر واحد لكل طالب (بدون سجل كل محاضرة)
      context += `## 👥 الطلاب:\n`;
      const sortedStudents = [...students].sort((a, b) => {
        const ga = a.group || 'ZZZ', gb = b.group || 'ZZZ';
        if (ga !== gb) return ga.localeCompare(gb, 'ar');
        return a.name.localeCompare(b.name, 'ar');
      });
      sortedStudents.forEach(student => {
        const studentRecords = records.filter(r => r.studentId === student.id);
        const attendedCount = studentRecords.filter(r => r.status === 'present').length;
        const absentCount = studentRecords.filter(r => r.status === 'absent').length;
        const pct = (attendedCount + absentCount) > 0 ? ((attendedCount / (attendedCount + absentCount)) * 100).toFixed(1) : '0';
        const isPresent = presentTodayIds.has(student.id);
        context += `${isPresent ? '✅' : '❌'} ${student.name} | كود:${student.code || '-'} | كروب:${student.group || '-'} | حضور:${attendedCount} | غياب:${absentCount} | ${pct}%\n`;
      });
      context += `\n`;
    } else {
      context += `## ⚠️ لا توجد مرحلة مختارة حالياً\n`;
    }

    // بيانات الجامعة للأدمن
    if (isAdmin && !currentStageId) {
      if (Object.keys(accessibleData.stagesMap).length > 0) {
        context += `## 🏛️ ملخص المراحل:\n`;
        Object.entries(accessibleData.stagesMap).forEach(([_stageId, stageData]) => {
          const tp = stageData.students.length * stageData.sessions.length;
          const r = tp > 0 ? ((stageData.records.filter(rr => rr.status === 'present').length / tp) * 100).toFixed(1) : '0';
          context += `- **${stageData.collegeName} / ${stageData.stageName}**: ${stageData.students.length} طالب | ${stageData.sessions.length} جلسة | ${r}%\n`;
        });
      } else if (!universityDataLoaded) {
        context += `## ⚠️ بيانات الجامعة غير محملة\nإذا سألك المستخدم عن الجامعة كاملة، اطلب منه الضغط على زر "📊 تحميل بيانات الجامعة" بالأعلى.\n\n`;
      }
    }

    // 🚨 تنبيه مهم: الـ AI يلتزم بالإجابات المؤكدة
    context += `\n## 🚨 تعليمات مهمة:\n- الإجابات المؤكدة بالأعلى صحيحة 100%\n- اعتمد عليها ولا تحاول تحسب من البيانات بنفسك\n- إذا سألك عن رقم موجود بالإجابات المؤكدة، استخدمه مباشرة\n`;

    const result = context;
    contextCacheRef.current = { key: dataKey, value: result };
    return result;
  }, [sessions, records, students, user.displayName, isAdmin, currentCollege, currentStage, currentStageId, accessibleData, fixDate, universityDataLoaded, user.uid]);

  // 🚀 محرك الأسئلة البسيطة — رد فوري بدون API (يغطي 200+ صيغة فصحى وعراقي)

  const analyzeQuestion = useCallback((question: string): string => {
    let hint = '';
    const todayKey = fixDate(new Date());

    const asksPresent = /حاضر|حضر|حضور|الموجود|اللي اج|دوام|جا|اجا|اجو/i.test(question);
    const asksAbsent = /غاب|غائب|غياب|ماجا|ما حضر|مو موجود|الناقص|ما اجا|ماجو/i.test(question);
    const asksToday = /اليوم|هسه|هسة|الحين|اليومية/i.test(question);
    const asksAdmin = /مدير|مسؤول|الدعم|النظام|الموقع|من سوى|من صمم|من برمج|من المشرف|صاحب|owner|admin|developer/i.test(question);
    const asksUniversity = /جامعة|كل الكليات|كل المراحل|الجامعة كاملة|الكليات كلها|كل الطلاب/i.test(question);

    if (asksAdmin) {
      hint += `\n\n[🚨 الجواب الإلزامي: مدير الموقع/النظام هو "الدكتور الصيدلاني مجتبى هيثم محمد"]`;
      return hint;
    }

    // 🆕 تنبيه إذا سأل عن الجامعة كاملة وما حمّل البيانات
    if (isAdmin && asksUniversity && !universityDataLoaded && !currentStageId) {
      hint += `\n\n[🚨 المستخدم يسأل عن بيانات الجامعة الشاملة لكنها غير محملة. اطلب منه الضغط على زر "📊 تحميل بيانات الجامعة" بأعلى الشات]`;
      return hint;
    }

    const fixedSessions = sessions.map(s => ({ ...s, _normalizedDate: fixDate((s as any).date) }));
    const todaySessionIdsSet = new Set<string>();
    fixedSessions.forEach(s => { if (s._normalizedDate === todayKey) todaySessionIdsSet.add(s.id); });
    const todayRecords = records.filter(r => todaySessionIdsSet.has(r.sessionId));
    const presentIds = new Set(todayRecords.filter(r => r.status === 'present').map(r => r.studentId));
    const absentIds = new Set(todayRecords.filter(r => r.status === 'absent').map(r => r.studentId));
    const present = students.filter(s => presentIds.has(s.id));
    const absent = students.filter(s => absentIds.has(s.id));
    const THRESHOLD = 50;

    if (asksPresent && !asksAbsent) {
      if (present.length === 0) {
        hint += `\n\n[🚨 لا يوجد حاضرين اليوم]`;
      } else if (present.length > THRESHOLD) {
        hint += `\n\n[🚨 الحاضرين ${present.length} (أكثر من 50). اذكر العدد فقط]`;
      } else {
        hint += `\n\n[🚨 الحاضرين فقط (${present.length}): ${present.map(s => `${s.name} (${s.code}, ${s.group || '-'})`).join(' | ')}]`;
      }
      return hint;
    }

    if (asksAbsent && !asksPresent) {
      if (absent.length === 0) {
        hint += `\n\n[🚨 لا يوجد غائبين - الكل حاضر]`;
      } else if (absent.length > THRESHOLD) {
        hint += `\n\n[🚨 الغائبين ${absent.length} (أكثر من 50). اذكر العدد فقط]`;
      } else {
        hint += `\n\n[🚨 الغائبين فقط (${absent.length}): ${absent.map(s => `${s.name} (${s.code}, ${s.group || '-'})`).join(' | ')}]`;
      }
      return hint;
    }

    if (asksToday || asksPresent || asksAbsent) {
      const todaySessionsList = fixedSessions.filter(s => todaySessionIdsSet.has(s.id));
      if (todaySessionsList.length === 0) {
        hint += `\n\n[🚨 لا توجد بيانات حضور لليوم (${todayKey})]`;
        return hint;
      }
      if (students.length > THRESHOLD) {
        let perSessionSummary = '';
        todaySessionsList.forEach(sess => {
          const presentCount = records.filter(r => r.sessionId === sess.id && r.status === 'present').length;
          perSessionSummary += `\n• سجل "${sess.name}": ${presentCount}/${students.length} حاضر`;
        });
        hint += `\n\n[🚨 عدد كبير (${students.length}). فصّل كل سجل:${perSessionSummary}]`;
        return hint;
      }
      let sessionsBreakdown = `\n\n[🚨 فصّل كل سجل لحاله:\n`;
      todaySessionsList.forEach((sess, idx) => {
        const sRecs = records.filter(r => r.sessionId === sess.id);
        const sPresentIds = new Set(sRecs.filter(r => r.status === 'present').map(r => r.studentId));
        const sAbsentIds = new Set(sRecs.filter(r => r.status === 'absent').map(r => r.studentId));
        const sPresent = students.filter(s => sPresentIds.has(s.id));
        const sAbsent = students.filter(s => sAbsentIds.has(s.id));
        sessionsBreakdown += `━━━ السجل ${idx + 1}: "${sess.name}" ━━━\n`;
        sessionsBreakdown += `✅ (${sPresent.length}): ${sPresent.map(s => `${s.name}`).join(' | ') || 'لا أحد'}\n`;
        sessionsBreakdown += `❌ (${sAbsent.length}): ${sAbsent.map(s => `${s.name}`).join(' | ') || 'لا أحد'}\n\n`;
      });
      sessionsBreakdown += `]`;
      hint += sessionsBreakdown;
      return hint;
    }

    for (const student of students) {
      const firstName = student.name.split(' ')[0];
      const matches = question.includes(student.name) ||
        (firstName.length > 2 && question.includes(firstName)) ||
        question.includes(student.code);
      if (matches) {
        const studentRecords = records.filter(r => r.studentId === student.id);
        const attendedSessionIds = new Set(studentRecords.filter(r => r.status === 'present').map(r => r.sessionId));
        const absentSessionIds = new Set(studentRecords.filter(r => r.status === 'absent').map(r => r.sessionId));
        const attendedCount = attendedSessionIds.size;
        const absentCount = absentSessionIds.size;
        const percentage = (attendedCount + absentCount) > 0 ? ((attendedCount / (attendedCount + absentCount)) * 100).toFixed(1) : '0';
        const isPresentToday = presentIds.has(student.id);
        hint += `\n\n[🚨 الطالب "${student.name}": كود ${student.code} | كروب ${student.group || '-'} | حضور ${attendedCount}/${sessions.length} | غياب ${absentCount} | نسبة ${percentage}% | اليوم: ${isPresentToday ? '✅ حاضر' : '❌ غائب'}]`;
        break;
      }
    }

    return hint;
  }, [students, records, sessions, fixDate, isAdmin, universityDataLoaded, currentStageId]);

  // 🚀 محرك الرد المحلي — يعمل 100% بدون API (يقرأ من قاعدة البيانات مباشرة)
  const buildLocalReply = useCallback((question: string): { handled: boolean; text: string } => {
    const q = question.trim();
    const todayKey = fixDate(new Date());
    const scStudents = scope.students;
    const scRecords = scope.records;
    const scSessions = scope.sessions;

    const fixedSessions = scSessions.map(s => ({ ...s, _normalizedDate: fixDate((s as any).date) }));
    const sessionById = new Map(fixedSessions.map(s => [s.id, s]));

    const dayReportFor = (student: Student): { attendedDays: string[]; absentDays: string[] } => {
      const sRecs = scRecords.filter(r => r.studentId === student.id);
      const attendedDates = new Set<string>();
      const absentDates = new Set<string>();
      sRecs.forEach(r => {
        const sess = sessionById.get(r.sessionId);
        if (!sess?._normalizedDate) return;
        if (r.status === 'present') attendedDates.add(sess._normalizedDate);
        else if (r.status === 'absent') absentDates.add(sess._normalizedDate);
      });
      return {
        attendedDays: [...attendedDates].sort().reverse(),
        absentDays: [...absentDates].sort().reverse(),
      };
    };

    const todaySessions = fixedSessions.filter(s => s._normalizedDate === todayKey);
    const todaySessionIdSet = new Set(todaySessions.map(s => s.id));
    const todayPresentIds = new Set(
      scRecords.filter(r => todaySessionIdSet.has(r.sessionId) && r.status === 'present').map(r => r.studentId)
    );
    const todayAbsentIds = new Set(
      scRecords.filter(r => todaySessionIdSet.has(r.sessionId) && r.status === 'absent').map(r => r.studentId)
    );

    // 1) من سوى الموقع / الأدمن
    if (/مدير|مسؤول|من سوى|من صمم|من برمج|صاحب الموقع|owner|admin|developer/i.test(q)) {
      return { handled: true, text: '👨‍⚕️ مدير الموقع/النظام هو "الدكتور الصيدلاني مجتبى هيثم محمد"' };
    }

    // 2) بحث عن طالب بالاسم أو الكود (رقم الطالب)
    for (const student of scStudents) {
      const firstName = student.name.split(' ')[0];
      const nameMatch = q.includes(student.name) || (firstName.length > 2 && q.includes(firstName));
      const codeMatch = !!student.code && q.includes(student.code);
      if (!nameMatch && !codeMatch) continue;

      const sRecs = scRecords.filter(r => r.studentId === student.id);
      const presentSessionIds = new Set(sRecs.filter(r => r.status === 'present').map(r => r.sessionId));
      const absentSessionIds = new Set(sRecs.filter(r => r.status === 'absent').map(r => r.sessionId));
      const attendedCount = presentSessionIds.size;
      const absentCount = absentSessionIds.size;
      const pct = (attendedCount + absentCount) > 0 ? ((attendedCount / (attendedCount + absentCount)) * 100).toFixed(1) : '0';
      const { attendedDays, absentDays } = dayReportFor(student);

      let todayStatus = '';
      if (todaySessions.length === 0) todayStatus = 'لا توجد محاضرات اليوم';
      else if (todayPresentIds.has(student.id)) todayStatus = '✅ حاضر';
      else if (todayAbsentIds.has(student.id)) todayStatus = '❌ غائب';
      else todayStatus = 'غير مسجل اليوم';

      let text = `📋 الطالب: **${student.name}**\n`;
      text += `🆔 الكود: ${student.code || '-'} | كروب: ${student.group || '-'}\n`;
      text += `📅 اليوم: ${todayStatus}\n\n`;
      text += `✅ أيام الحضور (${attendedDays.length}):\n`;
      if (attendedDays.length === 0) text += `  لا يوجد\n`;
      attendedDays.forEach(d => { text += `  • ${formatDateWithDay(d)}\n`; });
      text += `\n❌ أيام الغياب (${absentDays.length}):\n`;
      if (absentDays.length === 0) text += `  لا يوجد\n`;
      absentDays.forEach(d => { text += `  • ${formatDateWithDay(d)}\n`; });
      text += `\n📊 النسبة: **${pct}%** (حضور ${attendedCount} / غياب ${absentCount})`;
      return { handled: true, text };
    }

    // 3) منو حضر اليوم — حضور اليوم فقط
    if (/منو حضر|اللي حضر|من حضر|الموجودين|الحاضرين اليوم|حضور اليوم|شو حاضر/i.test(q)) {
      if (todaySessions.length === 0) {
        return { handled: true, text: `📅 لا توجد بيانات حضور لليوم (${formatDateWithDay(todayKey)})` };
      }
      const present = scStudents.filter(s => todayPresentIds.has(s.id));
      if (present.length === 0) return { handled: true, text: '🚨 لا يوجد حاضرين اليوم' };
      let text = `✅ حضور اليوم فقط (${present.length}):\n`;
      present.forEach(s => { text += `  • ${s.name} (${s.code || '-'}${s.group ? `, ${s.group}` : ''})\n`; });
      return { handled: true, text };
    }

    // 4) منو غاب اليوم
    if (/منو غاب|الغايبين اليوم|اللي ما حضر|من ما حضر|غياب اليوم|الناقصين|مو موجودين/i.test(q)) {
      if (todaySessions.length === 0) {
        return { handled: true, text: `📅 لا توجد بيانات حضور لليوم (${formatDateWithDay(todayKey)})` };
      }
      const absent = scStudents.filter(s => todayAbsentIds.has(s.id));
      if (absent.length === 0) return { handled: true, text: '✅ لا يوجد طلاب مسجلين غياب اليوم' };
      let text = `❌ غياب اليوم (${absent.length}):\n`;
      absent.forEach(s => { text += `  • ${s.name} (${s.code || '-'}${s.group ? `, ${s.group}` : ''})\n`; });
      return { handled: true, text };
    }

    // 5) إحصائيات اليوم
    if (/اليوم|إحصائيات|نسبة الحضور|عدد الحاضر|عدد الغايب|الحضور والغياب/i.test(q)) {
      if (todaySessions.length === 0) {
        return { handled: true, text: `📅 لا توجد محاضرات اليوم (${formatDateWithDay(todayKey)})` };
      }
      const presentCount = scStudents.filter(s => todayPresentIds.has(s.id)).length;
      const absentCount = scStudents.filter(s => todayAbsentIds.has(s.id)).length;
      const notRecordedCount = scStudents.length - presentCount - absentCount;
      const pct = scStudents.length > 0 ? ((presentCount / scStudents.length) * 100).toFixed(1) : '0';
      let text = `📊 إحصائيات اليوم (${formatDateWithDay(todayKey)}):\n`;
      text += `  ✅ الحاضرون: **${presentCount}**\n`;
      text += `  ❌ الغائبون: **${absentCount}**\n`;
      if (notRecordedCount > 0) text += `  ⬜ غير مسجل اليوم: **${notRecordedCount}**\n`;
      text += `  📈 نسبة الحضور: **${pct}%**`;
      return { handled: true, text };
    }

    // 6) لم يتم التعرف — دليل الاستخدام (يشتغل بدون API)
    const exampleStudent = scStudents[0];
    const example = exampleStudent ? `(مثال: ${exampleStudent.name} أو ${exampleStudent.code || 'الكود'})` : '(مثال: اسم الطالب أو الكود)';
    return {
      handled: false,
      text: `🤖 أعمل حالياً بدون API وأقدر أساعدك بـ:\n` +
        `  • اكتب اسم الطالب أو رقمه (الكود) → أيام حضوره وغيابه ${example}\n` +
        `  • اسأل "منو حضر اليوم؟" → حضور اليوم فقط\n` +
        `  • اسأل "منو غاب اليوم؟" → غياب اليوم فقط\n` +
        `  • اسأل "إحصائيات اليوم"`,
    };
  }, [scope, fixDate]);

  const callGeminiAPI = useCallback(
    async (userMessage: string, conversationHistory: Message[]): Promise<string> => {
      // 🚀 أولاً: الرد المحلي بدون API — فوري ومجاني
      const localReply = buildLocalReply(userMessage);
      if (localReply.handled) return localReply.text;

      // إذا ما هناك API Keys → نرجّع دليل الاستخدام المحلي
      if (!GEMINI_API_KEY && !OPENROUTER_API_KEY && !GROQ_API_KEY) {
        return localReply.text;
      }

      const dataContext = buildDataContext();
      const questionHint = analyzeQuestion(userMessage);
      const enhancedMessage = userMessage + questionHint;

      const systemInstruction = `أنت مساعد ذكي متخصص فقط بنظام حضور الطلاب.

# 🚨 قواعد إلزامية:
- ❌ ممنوع تجمع سجلات اليوم - كل سجل لحاله
- ❌ ممنوع تخمين أي شي
- ✅ اقرأ التلميحات [🚨] واعتمد عليها
- ✅ أجب بالعربية العراقية
- ✅ استخدم ✅ للحاضر و ❌ للغائب
- ✅ خاطب التدريسي بـ "دكتور"
- 👨‍⚕️ مدير الموقع: **الدكتور الصيدلاني مجتبى هيثم محمد**

---
${dataContext}`;

      const geminiContents = [
        { role: 'user', parts: [{ text: systemInstruction }] },
        { role: 'model', parts: [{ text: 'تمام دكتور، جاهز.' }] },
        ...conversationHistory.slice(-6).map(msg => ({
          role: msg.type === 'user' ? 'user' : 'model',
          parts: [{ text: msg.content }],
        })),
        { role: 'user', parts: [{ text: enhancedMessage }] },
      ];

      let lastError = '';

      if (selectedModelId !== 'auto') {
        const chosen = AI_MODELS.find(m => m.id === selectedModelId);
        if (!chosen) return 'الموديل المختار غير موجود';
        try {
          if (chosen.provider === 'gemini') return await callGeminiDirect(chosen.model, geminiContents);
          if (chosen.provider === 'groq') return await callGroqDirect(chosen.model, systemInstruction, conversationHistory, enhancedMessage);
          return await callOpenRouterDirect(chosen.model, systemInstruction, conversationHistory, enhancedMessage);
        } catch (err: any) {
          return `${chosen.name} فشل: ${err?.message || 'خطأ غير معروف'}`;
        }
      }

      for (let i = currentModelIndex; i < AI_MODELS.length; i++) {
        const aiModel = AI_MODELS[i];
        if (failedModels.has(aiModel.id)) continue;
        if (aiModel.provider === 'gemini' && !GEMINI_API_KEY) continue;
        if (aiModel.provider === 'openrouter' && !OPENROUTER_API_KEY) continue;
        if (aiModel.provider === 'groq' && !GROQ_API_KEY) continue;

        try {
          let text = '';
          if (aiModel.provider === 'gemini') text = await callGeminiDirect(aiModel.model, geminiContents);
          else if (aiModel.provider === 'groq') text = await callGroqDirect(aiModel.model, systemInstruction, conversationHistory, enhancedMessage);
          else text = await callOpenRouterDirect(aiModel.model, systemInstruction, conversationHistory, enhancedMessage);
          if (i !== currentModelIndex) setCurrentModelIndex(i);
          return text;
        } catch (err: any) {
          const status = err?.status || 0;
          lastError = `${aiModel.name}: ${err?.message || 'خطأ'}`;
          if (status === 401 || status === 403) {
            setFailedModels(prev => new Set([...prev, aiModel.id]));
            continue;
          }
          setFailedModels(prev => new Set([...prev, aiModel.id]));
          if (i < AI_MODELS.length - 1) { await sleep([429, 503].includes(status) ? 1200 : 300); continue; }
        }
      }

      return `جميع الموديلات توقفت\n\nآخر خطأ: ${lastError}`;
    },
    [buildDataContext, currentModelIndex, analyzeQuestion, failedModels, selectedModelId, buildLocalReply]
  );

  const sendMessage = useCallback(async (text: string) => {
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
    if (inputRef.current) inputRef.current.style.height = '40px';

    // نرسل السؤال لـ Gemini مع كامل البيانات
    setIsTyping(true);
    try {
      const response = await callGeminiAPI(text.trim(), messages);
      setMessages(prev => [...prev, { id: `${Date.now()}_bot`, type: 'bot', content: response, timestamp: new Date() }]);
    } catch (err: any) {
      setError(err?.message || 'حدث خطأ غير متوقع');
    } finally {
      setIsTyping(false);
    }
  }, [messages, isTyping, callGeminiAPI]);

  const handleSend = useCallback(() => sendMessage(input), [input, sendMessage]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const formatMessage = (content: string): React.ReactNode => {
    const lines = content.split('\n');
    return lines.map((line, i) => {
      const lineHasCheck = line.includes('✅');
      const lineHasCross = line.includes('❌');
      let lineClass = 'text-gray-800';
      if (lineHasCheck) lineClass = 'text-green-700';
      if (lineHasCross) lineClass = 'text-red-700';

      const parts: React.ReactNode[] = [];
      const boldRegex = /\*\*(.+?)\*\*/g;
      let lastIndex = 0, match, key = 0;
      while ((match = boldRegex.exec(line)) !== null) {
        if (match.index > lastIndex) parts.push(<React.Fragment key={`t-${i}-${key++}`}>{line.substring(lastIndex, match.index)}</React.Fragment>);
        let boldClass = 'font-bold text-gray-900';
        if (lineHasCheck) boldClass = 'font-bold text-green-800';
        if (lineHasCross) boldClass = 'font-bold text-red-800';
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

      {/* 📄 نافذة الشات — أنيميشن انسحاب الورقة */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            key="chat-window"
            initial={{ width: 120, height: 44, borderRadius: 20, opacity: 0 }}
            animate={{ width: 420, height: 520, borderRadius: 16, opacity: 1 }}
            exit={{ width: 120, height: 44, borderRadius: 20, opacity: 0 }}
              transition={{
                type: "spring",
                stiffness: 300,
                damping: 24,
                mass: 0.7,
              }}
            className="fixed bottom-3 right-3 sm:bottom-6 sm:right-6 z-50 overflow-hidden border border-gray-200 shadow-2xl max-w-[calc(100vw-1.5rem)] sm:max-w-[calc(100vw-3rem)] max-h-[calc(100vh-3rem)] overscroll-contain"
            style={{ backgroundColor: '#ffffff' }}
            onKeyDown={e => { e.stopPropagation(); }}
            onKeyUp={e => { e.stopPropagation(); }}
          >
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ delay: 0.18, duration: 0.2 }}
              className="flex flex-col h-full"
            >
              {/* شريط علوي: زر الإغلاق (يمين) مع خط فاصل تحته */}
              <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-gray-200">
                <span className="text-xs text-gray-400 font-medium">المساعد الذكي</span>
                <button
                  onClick={() => setIsOpen(false)}
                  className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-red-50 text-red-400 hover:text-red-600 text-sm transition"
                >
                  ✕
                </button>
              </div>

              {/* ✅ شريط البحث — يظهر دائماً */}
              {students.length > 0 && (
                <div className="w-full px-4 pt-2">
                  <div className="max-w-xl mx-auto">
                    <div className="bg-gray-50 border-b border-gray-200">
                      <div className="relative px-3 py-2">
                        <div className="flex items-center gap-2 bg-white rounded-xl border border-gray-200 focus-within:border-gray-400 focus-within:ring-1 focus-within:ring-gray-300 transition shadow-sm">
                          <span className="pr-3 text-gray-400 text-sm flex items-center"><Search className="w-4 h-4" /></span>
                          <input
                            type="text"
                            value={studentSearchQuery}
                            onChange={e => handleStudentSearch(e.target.value)}
                            onFocus={() => { if (studentSuggestions.length > 0) setShowSuggestions(true); }}
                            placeholder="ابحث عن طالب بالاسم أو الكود..."
                            className="flex-1 py-2 pl-3 text-sm bg-transparent outline-none text-right text-gray-900 placeholder-gray-400"
                            dir="rtl"
                            autoComplete="off"
                          />
                          {studentSearchQuery && (
                            <button
                              onClick={() => { setStudentSearchQuery(''); setStudentSuggestions([]); setShowSuggestions(false); setShowStudentCard(false); setSelectedStudentCard(null); }}
                              className="pl-2 pr-1 text-gray-400 hover:text-gray-700 transition"
                            >
                              ×
                            </button>
                          )}
                        </div>
                        <p className="text-[10px] text-gray-400 mt-1 text-right">اكتب الاسم أو الكود لعرض أيام الحضور والغياب فوراً</p>

                        {showSuggestions && studentSuggestions.length > 0 && (
                          <div className="absolute top-full left-0 right-0 mt-1 bg-white rounded-xl shadow-xl border border-gray-200 z-[70] overflow-hidden max-h-[320px] overflow-y-auto">
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
                                className="w-full text-right px-4 py-3 hover:bg-gray-50 flex items-center gap-3 transition border-b border-gray-100 last:border-0"
                              >
                                <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center text-blue-700 font-bold text-sm border border-blue-200">
                                  {student.name.charAt(0)}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-semibold text-gray-900 truncate">{student.name}</p>
                                  <p className="text-[11px] text-gray-500">
                                    {student.code && `كود: ${student.code}`}
                                    {student.group && ` • كروب: ${student.group}`}
                                  </p>
                                  <p className="text-[10px] mt-0.5 text-gray-400">
                                    ✅ {sAttended} / ❌ {sAbsent} — {sPct}%
                                  </p>
                                </div>
                                <span className="text-gray-400 text-xs"><ChevronLeft className="w-4 h-4" /></span>
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
                    <div className="mt-2 bg-white rounded-xl border border-gray-200 shadow-md overflow-hidden">
                      <div className="bg-blue-50 px-4 py-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center text-lg font-bold border border-blue-200 text-blue-700">
                              {selectedStudentCard.student.name.charAt(0)}
                            </div>
                            <div>
                              <h4 className="font-bold text-sm text-gray-900">{selectedStudentCard.student.name}</h4>
                              <p className="text-[11px] text-gray-500">
                                {selectedStudentCard.student.code && `كود: ${selectedStudentCard.student.code}`}
                                {selectedStudentCard.student.group && ` • كروب: ${selectedStudentCard.student.group}`}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {selectedStudentCard.isPresentToday ? (
                              <div className="text-xs font-bold px-2 py-1 rounded-full flex items-center gap-1 bg-green-500/10 text-green-700">
                                <CircleCheck className="w-3.5 h-3.5" /> حاضر اليوم
                              </div>
                            ) : selectedStudentCard.isAbsentToday ? (
                              <div className="text-xs font-bold px-2 py-1 rounded-full flex items-center gap-1 bg-red-500/10 text-red-700">
                                <CircleX className="w-3.5 h-3.5" /> غائب اليوم
                              </div>
                            ) : (
                              <div className="text-xs font-bold px-2 py-1 rounded-full flex items-center gap-1 bg-gray-500/10 text-gray-600">
                                <CircleX className="w-3.5 h-3.5" /> غير مسجل اليوم
                              </div>
                            )}
                            <button
                              onClick={() => { setShowStudentCard(false); setSelectedStudentCard(null); setStudentSearchQuery(''); }}
                              className="w-6 h-6 flex items-center justify-center rounded-md hover:bg-red-50 text-red-400 hover:text-red-600 text-sm transition flex-shrink-0"
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-3 divide-x divide-x-reverse divide-gray-200">
                        <div className="text-center py-3 px-2">
                          <p className="text-lg font-bold text-green-600">{selectedStudentCard.attendedCount}</p>
                          <p className="text-[10px] text-gray-500 flex items-center justify-center gap-1"><CircleCheck className="w-3 h-3" /> حضور</p>
                        </div>
                        <div className="text-center py-3 px-2">
                          <p className="text-lg font-bold text-red-500">{selectedStudentCard.absentCount}</p>
                          <p className="text-[10px] text-gray-500 flex items-center justify-center gap-1"><CircleX className="w-3 h-3" /> غياب</p>
                        </div>
                        <div className="text-center py-3 px-2">
                          <p className={`text-lg font-bold ${parseFloat(selectedStudentCard.percentage) >= 75 ? 'text-green-600' : parseFloat(selectedStudentCard.percentage) >= 50 ? 'text-yellow-600' : 'text-red-500'}`}>
                            {selectedStudentCard.percentage}%
                          </p>
                          <p className="text-[10px] text-gray-500">النسبة</p>
                        </div>
                      </div>

                      <div className="border-t border-gray-200">
                        <button
                          onClick={() => setShowDayDetails(v => !v)}
                          className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-bold text-gray-700 hover:bg-gray-50 transition"
                        >
                          <span className="flex items-center gap-1.5"><ClipboardList className="w-3.5 h-3.5 text-blue-600" /> أيام الحضور والغياب</span>
                          <span className="text-gray-400">{showDayDetails ? '▲' : '▼'}</span>
                        </button>
                        {showDayDetails && (
                          <div className="px-3 pb-3 space-y-2.5 max-h-48 overflow-y-auto">
                            <div>
                              <p className="text-[11px] font-bold text-green-700 mb-1">✅ أيام الحضور ({selectedStudentCard.attendedDays.length})</p>
                              <div className="space-y-1">
                                {selectedStudentCard.attendedDays.length === 0 ? (
                                  <p className="text-[11px] text-gray-400 px-1">لا يوجد</p>
                                ) : selectedStudentCard.attendedDays.map(d => (
                                  <div key={d.date} className="flex items-center justify-between bg-green-50 border border-green-200 rounded-lg px-2.5 py-1.5 text-xs text-green-800">
                                    <span>{d.label}</span>
                                    <span className="text-[10px] text-green-600">{d.count} محاضرة</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                            <div>
                              <p className="text-[11px] font-bold text-red-700 mb-1">❌ أيام الغياب ({selectedStudentCard.absentDays.length})</p>
                              <div className="space-y-1">
                                {selectedStudentCard.absentDays.length === 0 ? (
                                  <p className="text-[11px] text-gray-400 px-1">لا يوجد</p>
                                ) : selectedStudentCard.absentDays.map(d => (
                                  <div key={d.date} className="flex items-center justify-between bg-red-50 border border-red-200 rounded-lg px-2.5 py-1.5 text-xs text-red-800">
                                    <span>{d.label}</span>
                                    <span className="text-[10px] text-red-600">{d.count} محاضرة</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="flex gap-2 p-3 bg-gray-50 border-t border-gray-200">
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
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm"
                     onMouseDown={() => setShowSessionsModal(false)}>
                  <div className="bg-white rounded-2xl shadow-2xl border border-gray-200 w-[calc(100%-16px)] max-h-[calc(100%-16px)] flex flex-col overflow-hidden"
                       onMouseDown={e => e.stopPropagation()}>
                    <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50 flex-shrink-0">
                      <span className="text-sm font-bold text-gray-900 flex items-center gap-1.5"><ClipboardList className="w-4 h-4" /> سجلات حضور {selectedStudentCard.student.name}</span>
                      <button
                        onClick={() => setShowSessionsModal(false)}
                        className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-red-50 text-red-400 hover:text-red-600 text-sm transition"
                      >
                        ✕
                      </button>
                    </div>
                    <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
                      {selectedStudentCard.attendedSessions.length === 0 ? (
                        <div className="text-center py-8 text-gray-400 text-sm">لا توجد سجلات</div>
                      ) : (
                        selectedStudentCard.attendedSessions.map((as_, idx) => (
                          <div key={idx}
                               className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm ${
                                 as_.present
                                   ? 'bg-green-50 border border-green-200 text-green-800'
                                   : as_.absent
                                   ? 'bg-red-50 border border-red-200 text-red-800'
                                   : 'bg-gray-50 border border-gray-200 text-gray-500'
                               }`}>
                            <span className="flex-shrink-0">{as_.present ? <CircleCheck className="w-5 h-5 text-green-600" /> : as_.absent ? <CircleX className="w-5 h-5 text-red-600" /> : <CircleX className="w-5 h-5 text-gray-400" />}</span>
                            <div className="flex-1 min-w-0">
                              <p className="font-semibold truncate">{as_.session.name}</p>
                              <p className={`text-[11px] mt-0.5 ${as_.present ? 'text-green-600' : as_.absent ? 'text-red-600' : 'text-gray-400'}`}>
                                {formatDateWithDay(as_.session._normalizedDate)}
                              </p>
                            </div>
                            {!as_.present && !as_.absent && (
                              <span className="text-[10px] font-medium text-gray-400 flex-shrink-0">غير مسجل</span>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                    <div className="px-4 py-2.5 border-t border-gray-200 bg-gray-50 flex-shrink-0 flex justify-between items-center">
                      <span className="text-[11px] text-gray-500 flex items-center gap-1">
                        <CircleCheck className="w-3 h-3" /> {selectedStudentCard.attendedCount} حضور • <CircleX className="w-3 h-3" /> {selectedStudentCard.absentCount} غياب
                      </span>
                      <button
                        onClick={() => setShowSessionsModal(false)}
                        className="px-4 py-1.5 bg-gray-200 hover:bg-gray-300 text-gray-700 text-xs rounded-lg transition font-medium"
                      >
                        إغلاق
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* 💬 الرسائل */}
              <div className="flex-1 overflow-y-auto pb-4 space-y-3 px-3 overscroll-contain" style={{ backgroundColor: '#ffffff' }}>
                {messages.map((msg, idx) => (
                    <motion.div
                      key={msg.id}
                      initial={{ opacity: 0, y: 14, scale: 0.96 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      transition={{ duration: 0.45, ease: [0.22, 0.08, 0.22, 1], delay: idx === messages.length - 1 ? 0.12 : 0 }}
                      className={`flex ${msg.type === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                    <div className={`max-w-[90%] rounded-2xl p-3 shadow-sm ${
                      msg.type === 'user'
                        ? 'bg-blue-500 text-white rounded-br-sm'
                        : 'bg-gray-100 text-gray-900 border border-gray-200 rounded-bl-sm'
                    }`}>
                      {msg.type === 'bot' && (
                        <div className="flex items-center gap-1 mb-1.5 text-[10px] text-gray-500 font-semibold">
                          <Sparkles className="w-3.5 h-3.5 text-amber-500" /><span>المساعد الذكي</span>
                        </div>
                      )}
                      <div className={`text-sm leading-relaxed whitespace-pre-wrap break-words ${
                        msg.type === 'user' ? 'text-white' : 'text-gray-900'
                      }`}>{formatMessage(msg.content)}</div>
                      <p className={`text-[10px] mt-1.5 ${
                        msg.type === 'user' ? 'text-white/70' : 'text-gray-500'
                      }`}>
                        {msg.timestamp.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  </motion.div>
                ))}

                {isTyping && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.25 }}
                    className="flex justify-start"
                  >
                    <div className="bg-gray-100 border border-gray-200 rounded-2xl rounded-bl-sm p-3 shadow-sm">
                      <div className="flex items-center gap-2">
                        <div className="flex gap-1">
                          <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                          <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                          <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                        </div>
                        <span className="text-xs text-gray-500">يكتب...</span>
                      </div>
                    </div>
                  </motion.div>
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* ⚠️ شريط الأخطاء */}
              {error && (
                <div className="px-3 py-2 bg-red-50 border-t border-red-200">
                  <p className="text-xs text-red-600 flex items-center gap-1.5"><CircleX className="w-3.5 h-3.5 shrink-0" /> {error}</p>
                </div>
              )}

              {/* ⌨️ منطقة الإدخال */}
              {(() => {
                const isInputBlocked = !isAdmin && !currentStageId;
                return (
                  <div className="border-t border-gray-200" style={{ backgroundColor: '#ffffff' }}>
                    {!isTyping && !isInputBlocked && messages.length > 0 && (
                      <div className="px-3 pt-2 pb-0 flex flex-wrap gap-1.5">
                        <button
                          onClick={() => sendMessage('منو حضر اليوم؟')}
                          className="text-[11px] font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 border border-gray-200 rounded-full px-3 py-1.5 transition"
                        >
                          ✅ منو حضر اليوم؟
                        </button>
                        <button
                          onClick={() => sendMessage('منو غاب اليوم؟')}
                          className="text-[11px] font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 border border-gray-200 rounded-full px-3 py-1.5 transition"
                        >
                          ❌ منو غاب اليوم؟
                        </button>
                        <button
                          onClick={() => sendMessage('إحصائيات اليوم')}
                          className="text-[11px] font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 border border-gray-200 rounded-full px-3 py-1.5 transition"
                        >
                          📊 إحصائيات اليوم
                        </button>
                      </div>
                    )}
                    <div className="px-3 py-2">
                      <div className={`flex items-end gap-2 rounded-xl border-2 bg-white px-3 py-2 transition ${
                        isInputBlocked ? 'border-gray-200 opacity-50' : 'border-gray-900 focus-within:border-gray-700'
                      }`}>
                        <textarea
                          ref={inputRef as React.Ref<HTMLTextAreaElement>}
                          value={input}
                          onChange={e => setInput(e.target.value)}
                          onKeyDown={handleKeyDown}
                          placeholder={isInputBlocked ? 'الإدخال متوقف مؤقتاً...' : 'اكتب سؤالك هنا...'}
                          className="flex-1 resize-none outline-none text-sm bg-transparent text-gray-900 placeholder-gray-400"
                          rows={1}
                          style={{ minHeight: 24, maxHeight: 80 }}
                          disabled={isTyping || isInputBlocked}
                          spellCheck={false}
                        />
                        <button
                          onClick={handleSend}
                          disabled={isTyping || !input.trim() || isInputBlocked}
                          className="w-7 h-7 flex items-center justify-center rounded-lg bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition flex-shrink-0 text-sm"
                        >
                          <ArrowUp className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};