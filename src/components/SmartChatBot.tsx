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
  attendedSessions: { session: AttendanceSession & { _normalizedDate: string }; present: boolean }[];
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
  onRequestUniversityData,
  universityDataLoaded = false,
  universityDataLoading = false,
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
  const [selectedModelId, setSelectedModelId] = useState<string>('auto');
  const [showModelSelector, setShowModelSelector] = useState(false);

  const [studentSearchQuery, setStudentSearchQuery] = useState('');
  const [studentSuggestions, setStudentSuggestions] = useState<Student[]>([]);
  const [selectedStudentCard, setSelectedStudentCard] = useState<StudentQuickCard | null>(null);
  const [showStudentCard, setShowStudentCard] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const lastRequestTime = useRef<number>(0);
  const modelSelectorRef = useRef<HTMLDivElement>(null);
  const studentSearchRef = useRef<HTMLDivElement>(null);
  const contextCacheRef = useRef<{ key: string; value: string }>({ key: '', value: '' });

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (modelSelectorRef.current && !modelSelectorRef.current.contains(event.target as Node)) {
        setShowModelSelector(false);
      }
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

    const fixedSessions = sessions.map(s => ({
      ...s,
      _normalizedDate: fixDate((s as any).date),
    }));

    const sortedSessions = [...fixedSessions].sort((a, b) => {
      if (a._normalizedDate !== b._normalizedDate) return a._normalizedDate.localeCompare(b._normalizedDate);
      return String(a.name || '').localeCompare(String(b.name || ''), 'ar');
    });

    const studentRecords = records.filter(r => r.studentId === student.id);
    const attendedSessionIds = new Set(studentRecords.map(r => r.sessionId));

    const todaySessionIds = new Set<string>();
    fixedSessions.forEach(s => { if (s._normalizedDate === todayKey) todaySessionIds.add(s.id); });
    records.forEach(r => {
      const sess = fixedSessions.find(s => s.id === r.sessionId);
      if (sess && sess._normalizedDate === todayKey) todaySessionIds.add(r.sessionId);
    });
    const isPresentToday = studentRecords.some(r => todaySessionIds.has(r.sessionId));

    const attendedCount = sortedSessions.filter(s => attendedSessionIds.has(s.id)).length;
    const absentCount = sortedSessions.length - attendedCount;
    const percentage = sortedSessions.length > 0
      ? ((attendedCount / sortedSessions.length) * 100).toFixed(1)
      : '0';

    const attendedSessions = sortedSessions.map(s => ({
      session: s,
      present: attendedSessionIds.has(s.id),
    }));

    return { student, attendedCount, absentCount, percentage, isPresentToday, attendedSessions };
  }, [sessions, records, fixDate]);

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
    const matches = students.filter(s =>
      s.name.toLowerCase().includes(q) ||
      s.code?.toLowerCase().includes(q) ||
      s.group?.toLowerCase().includes(q)
    ).slice(0, 8);

    setStudentSuggestions(matches);
    setShowSuggestions(matches.length > 0);
  }, [students]);

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
    if (isOpen && messages.length === 0) {
      // 🆕 رسالة ترحيب ذكية حسب الحالة
      let welcomeText = `أهلاً ${user.displayName} ✨\n\nبشنو أكدر أساعدك اليوم؟`;

      if (isAdmin && !universityDataLoaded && !currentStageId) {
        welcomeText += `\n\n💡 **نصيحة:** إذا تريد تسأل عن الجامعة كاملة (كل الكليات والمراحل)، اضغط على زر **"📊 تحميل بيانات الجامعة"** بالأعلى أولاً.`;
      }

      setMessages([{
        id: Date.now().toString(),
        type: 'bot',
        content: welcomeText,
        timestamp: new Date(),
      }]);
    }
  }, [isOpen, messages.length, user.displayName, isAdmin, universityDataLoaded, currentStageId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  useEffect(() => {
    if (isOpen) setTimeout(() => inputRef.current?.focus(), 300);
  }, [isOpen]);

  const activeModel = useMemo(() => {
    if (selectedModelId === 'auto') return AI_MODELS[currentModelIndex] || AI_MODELS[0];
    return AI_MODELS.find(m => m.id === selectedModelId) || AI_MODELS[0];
  }, [selectedModelId, currentModelIndex]);

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

    const sessionById = new Map(sortedSessions.map(s => [s.id, s]));
    const groups = Array.from(new Set(students.map(s => s.group).filter(Boolean))) as string[];
    groups.sort((a, b) => a.localeCompare(b, 'ar'));

    // 📊 إحصاءات اليوم
    const todaySessionIds = new Set<string>();
    sortedSessions.forEach(s => { if (s.date === todayDate) todaySessionIds.add(s.id); });
    records.forEach(r => {
      const session = sessionById.get(r.sessionId);
      if (session && session.date === todayDate) todaySessionIds.add(r.sessionId);
      if (r.date && r.date === todayDate) todaySessionIds.add(r.sessionId);
    });
    const todaySessionList = sortedSessions.filter(s => todaySessionIds.has(s.id));
    const todayRecords = records.filter(r => todaySessionIds.has(r.sessionId));
    const presentTodayIds = new Set(todayRecords.map(r => r.studentId));
    const presentToday = students.filter(s => presentTodayIds.has(s.id));
    const absentToday = students.filter(s => !presentTodayIds.has(s.id));

    // 🚨 إجابات مؤكدة
    let context = `# 🚨 إجابات مؤكدة 100% من قاعدة البيانات\n\n`;
    context += `## 📊 إحصاءات دقيقة (محسوبة من النظام مباشرة):\n`;
    context += `- إجمالي الطلاب: **${students.length}**\n`;
    context += `- إجمالي المحاضرات: **${sortedSessions.length}**\n`;
    if (todaySessionList.length > 0) {
      context += `- حضور اليوم: ✅ **${presentToday.length}** حاضر / ❌ **${absentToday.length}** غائب\n`;
      context += `- نسبة حضور اليوم: **${students.length > 0 ? ((presentToday.length / students.length) * 100).toFixed(1) : '0'}%**\n`;
      context += `- محاضرات اليوم: **${todaySessionList.length}**\n`;
    }
    if (groups.length > 0) {
      context += `\n### 📊 إحصاءات الكروبات:\n`;
      groups.forEach(g => {
        const gStudents = students.filter(s => s.group === g);
        const gIds = new Set(gStudents.map(s => s.id));
        const gRecs = records.filter(r => gIds.has(r.sessionId));
        const possible = gStudents.length * sortedSessions.length;
        const rate = possible > 0 ? ((gRecs.length / possible) * 100).toFixed(1) : '0';
        const gp = gStudents.filter(s => presentTodayIds.has(s.id)).length;
        context += `- **${g}**: ${gStudents.length} طالب | حضور عام ${rate}% | اليوم ✅${gp} ❌${gStudents.length - gp}\n`;
      });
    }
    const totalPossible = students.length * sortedSessions.length;
    const overallRate = totalPossible > 0 ? ((records.length / totalPossible) * 100).toFixed(2) : '0';
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
          const sRecs = records.filter(r => r.sessionId === session.id);
          const sPresent = new Set(sRecs.map(r => r.studentId));
          const sPresentCount = students.filter(s => sPresent.has(s.id)).length;
          const sAbsentCount = students.length - sPresentCount;
          const sRate = students.length > 0 ? ((sPresentCount / students.length) * 100).toFixed(1) : '0';
          context += `**${idx + 1}. ${session.name}** | ✅${sPresentCount} ❌${sAbsentCount} | ${sRate}%\n`;
        });
        context += `\n`;
      }

      // جميع المحاضرات بالتفصيل — أسماء الحاضرين والغائبين لكل سجل
      context += `## 📅 تفاصيل جميع المحاضرات:\n`;
      sortedSessions.forEach((session, idx) => {
        const sRecs = records.filter(r => r.sessionId === session.id);
        const presentIds = new Set(sRecs.map(r => r.studentId));
        const presentStudents = students.filter(s => presentIds.has(s.id));
        const absentStudents = students.filter(s => !presentIds.has(s.id));
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
        const attendedIds = new Set(studentRecords.map(r => r.sessionId));
        const attendedCount = sortedSessions.filter(s => attendedIds.has(s.id)).length;
        const absentCount = sortedSessions.length - attendedCount;
        const pct = sortedSessions.length > 0 ? ((attendedCount / sortedSessions.length) * 100).toFixed(1) : '0';
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
          const r = tp > 0 ? ((stageData.records.length / tp) * 100).toFixed(1) : '0';
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
    const sessionsLookup = new Map(fixedSessions.map(s => [s.id, s]));
    const todaySessionIdsSet = new Set<string>();
    fixedSessions.forEach(s => { if (s._normalizedDate === todayKey) todaySessionIdsSet.add(s.id); });
    records.forEach(r => {
      const sess = sessionsLookup.get(r.sessionId);
      if (sess && sess._normalizedDate === todayKey) todaySessionIdsSet.add(r.sessionId);
    });
    const todayRecords = records.filter(r => todaySessionIdsSet.has(r.sessionId));
    const presentIds = new Set(todayRecords.map(r => r.studentId));
    const present = students.filter(s => presentIds.has(s.id));
    const absent = students.filter(s => !presentIds.has(s.id));
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
          const sRecs = records.filter(r => r.sessionId === sess.id);
          perSessionSummary += `\n• سجل "${sess.name}": ${sRecs.length}/${students.length} حاضر`;
        });
        hint += `\n\n[🚨 عدد كبير (${students.length}). فصّل كل سجل:${perSessionSummary}]`;
        return hint;
      }
      let sessionsBreakdown = `\n\n[🚨 فصّل كل سجل لحاله:\n`;
      todaySessionsList.forEach((sess, idx) => {
        const sRecs = records.filter(r => r.sessionId === sess.id);
        const sPresentIds = new Set(sRecs.map(r => r.studentId));
        const sPresent = students.filter(s => sPresentIds.has(s.id));
        const sAbsent = students.filter(s => !sPresentIds.has(s.id));
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
        const attendedSessionIds = new Set(studentRecords.map(r => r.sessionId));
        const attendedCount = sessions.filter(s => attendedSessionIds.has(s.id)).length;
        const absentCount = sessions.length - attendedCount;
        const percentage = sessions.length > 0 ? ((attendedCount / sessions.length) * 100).toFixed(1) : '0';
        const isPresentToday = presentIds.has(student.id);
        hint += `\n\n[🚨 الطالب "${student.name}": كود ${student.code} | كروب ${student.group || '-'} | حضور ${attendedCount}/${sessions.length} | غياب ${absentCount} | نسبة ${percentage}% | اليوم: ${isPresentToday ? '✅ حاضر' : '❌ غائب'}]`;
        break;
      }
    }

    return hint;
  }, [students, records, sessions, fixDate, isAdmin, universityDataLoaded, currentStageId]);

  const callGeminiAPI = useCallback(
    async (userMessage: string, conversationHistory: Message[]): Promise<string> => {
      if (!GEMINI_API_KEY && !OPENROUTER_API_KEY && !GROQ_API_KEY) {
        return `⚠️ لازم تضيف API Key بالـ .env`;
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
        if (!chosen) return '❌ الموديل المختار غير موجود';
        try {
          if (chosen.provider === 'gemini') return await callGeminiDirect(chosen.model, geminiContents);
          if (chosen.provider === 'groq') return await callGroqDirect(chosen.model, systemInstruction, conversationHistory, enhancedMessage);
          return await callOpenRouterDirect(chosen.model, systemInstruction, conversationHistory, enhancedMessage);
        } catch (err: any) {
          return `❌ ${chosen.name} فشل: ${err?.message || 'خطأ غير معروف'}`;
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

      return `🌐 جميع الموديلات توقفت\n\nآخر خطأ: ${lastError}`;
    },
    [buildDataContext, currentModelIndex, analyzeQuestion, failedModels, selectedModelId]
  );

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isTyping) return;
    const now = Date.now();
    if (now - lastRequestTime.current < 500) {
      const wait = Math.ceil((500 - (now - lastRequestTime.current)) / 1000);
      setError(`⏱️ انتظر ${wait} ثانية`);
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

  const handleReset = useCallback(() => {
    if (window.confirm('متأكد من مسح المحادثة؟')) {
      setMessages([]);
      setError(null);
      setCurrentModelIndex(0);
      setFailedModels(new Set());
      setShowStudentCard(false);
      setStudentSearchQuery('');
      setSelectedStudentCard(null);
    }
  }, []);

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

  const groupedModels = useMemo(() => {
    const groups: { [key: string]: { label: string; models: AIModel[] } } = {
      gemini: { label: '🟡 Google Gemini', models: [] },
      groq: { label: '⚡ Groq (الأسرع)', models: [] },
      openrouter: { label: '🌐 OpenRouter', models: [] },
    };
    AI_MODELS.forEach(m => {
      if (m.provider === 'gemini') groups.gemini.models.push(m);
      else if (m.provider === 'groq') groups.groq.models.push(m);
      else groups.openrouter.models.push(m);
    });
    return Object.values(groups).filter(g => g.models.length > 0);
  }, []);

  const getTodayStatus = useCallback((card: StudentQuickCard): { sessions: { name: string; present: boolean }[] } => {
    const todayKey = fixDate(new Date());
    const todaySessions = card.attendedSessions.filter(
      as_ => as_.session._normalizedDate === todayKey
    );
    return { sessions: todaySessions.map(as_ => ({ name: as_.session.name, present: as_.present })) };
  }, [fixDate]);

  // 🆕 معالج تحميل بيانات الجامعة
  const handleLoadUniversityData = async () => {
    if (!onRequestUniversityData || universityDataLoading) return;
    await onRequestUniversityData();
    // إضافة رسالة تأكيد
    setMessages(prev => [...prev, {
      id: `${Date.now()}_bot`,
      type: 'bot',
      content: `✅ **تم تحميل بيانات الجامعة الشاملة!**\n\nالحين أكدر أجاوبك عن:\n• كل الكليات والمراحل\n• إحصائيات شاملة\n• مقارنات بين المراحل\n• تقارير الجامعة كاملة`,
      timestamp: new Date(),
    }]);
  };

  return (
    <>
      {/* زر فتح الشات */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-6 right-6 w-16 h-16 bg-gradient-to-br from-amber-500 via-orange-500 to-pink-600 hover:from-amber-600 hover:via-orange-600 hover:to-pink-700 text-white rounded-full shadow-2xl flex items-center justify-center transition-all hover:scale-110 z-50 group"
          title="المساعد الذكي"
        >
          <span className="text-3xl group-hover:rotate-12 transition-transform">✨</span>
          <span className="absolute -top-2 -left-2 bg-gradient-to-r from-yellow-400 to-orange-500 text-white text-[10px] px-2 py-0.5 rounded-full font-bold shadow-lg animate-pulse">AI</span>
        </button>
      )}

      {/* نافذة الشات */}
      {isOpen && (
        <div className="fixed bottom-6 right-6 w-[460px] max-w-[calc(100vw-3rem)] h-[750px] max-h-[calc(100vh-3rem)] bg-white rounded-2xl shadow-2xl flex flex-col z-50 border-2 border-amber-200 overflow-hidden">

          {/* Header */}
          <div className="bg-gradient-to-r from-amber-500 via-orange-500 to-pink-600 text-white p-3">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-white bg-opacity-20 rounded-full flex items-center justify-center text-xl shadow-lg border border-white border-opacity-30">✨</div>
                <div>
                  <h3 className="font-bold text-sm flex items-center gap-2">
                    المساعد الذكي
                    <span className="text-[10px] bg-white text-orange-600 px-1.5 py-0.5 rounded-full font-bold">AI</span>
                  </h3>
                  <p className="text-[11px] opacity-95 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 bg-green-300 rounded-full animate-pulse"></span>
                    {activeModel.emoji} {activeModel.name}
                    {selectedModelId === 'auto' && <span className="text-[9px] opacity-75">(تلقائي)</span>}
                  </p>
                </div>
              </div>
              <div className="flex gap-1 items-center">
                <button onClick={handleReset} className="text-white hover:bg-white hover:bg-opacity-20 rounded-lg p-1.5 transition text-sm" title="محادثة جديدة">🔄</button>
                <button onClick={() => setIsOpen(false)} className="text-white hover:bg-white hover:bg-opacity-20 rounded-lg p-1.5 transition text-lg leading-none w-7 h-7 flex items-center justify-center">×</button>
              </div>
            </div>

            {/* 🆕 زر تحميل بيانات الجامعة (للأدمن فقط) */}
            {isAdmin && onRequestUniversityData && !currentStageId && (
              <button
                onClick={handleLoadUniversityData}
                disabled={universityDataLoading}
                className={`w-full mt-2 flex items-center justify-center gap-2 rounded-lg px-3 py-1.5 text-xs transition font-bold ${
                  universityDataLoading
                    ? 'bg-white bg-opacity-10 cursor-wait'
                    : universityDataLoaded
                    ? 'bg-green-500 bg-opacity-30 hover:bg-opacity-40'
                    : 'bg-white bg-opacity-15 hover:bg-opacity-25'
                }`}
                title={universityDataLoaded ? 'البيانات محملة - اضغط للتحديث' : 'تحميل بيانات كل الكليات والمراحل'}
              >
                <span>📊</span>
                <span>
                  {universityDataLoading
                    ? '⏳ جاري تحميل بيانات الجامعة...'
                    : universityDataLoaded
                    ? '✅ بيانات الجامعة محملة - تحديث'
                    : '📊 تحميل بيانات الجامعة'}
                </span>
              </button>
            )}

            {/* اختيار الموديل */}
            <div className="relative mt-2" ref={modelSelectorRef}>
              <button
                onClick={() => setShowModelSelector(!showModelSelector)}
                className="w-full flex items-center justify-between bg-white bg-opacity-15 hover:bg-opacity-25 rounded-lg px-3 py-1.5 text-xs transition"
              >
                <span className="flex items-center gap-1.5">
                  <span>🤖</span>
                  <span>{selectedModelId === 'auto' ? `تلقائي (${activeModel.name})` : activeModel.name}</span>
                </span>
                <span className={`transition-transform ${showModelSelector ? 'rotate-180' : ''}`}>▼</span>
              </button>

              {showModelSelector && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white rounded-xl shadow-2xl border border-gray-200 max-h-[300px] overflow-y-auto z-[60]">
                  <button
                    onClick={() => { setSelectedModelId('auto'); setShowModelSelector(false); }}
                    className={`w-full text-right px-3 py-2.5 text-sm flex items-center gap-2 transition border-b border-gray-100 ${selectedModelId === 'auto' ? 'bg-orange-50 text-orange-700 font-bold' : 'text-gray-700 hover:bg-gray-50'}`}
                  >
                    <span>🔄</span>
                    <div className="flex-1">
                      <span className="block font-semibold">تلقائي</span>
                      <span className="block text-[10px] text-gray-400">يختار أفضل موديل متاح</span>
                    </div>
                    {selectedModelId === 'auto' && <span className="text-green-500">✓</span>}
                  </button>
                  {groupedModels.map((group, gi) => (
                    <div key={gi}>
                      <div className="px-3 py-1.5 bg-gray-50 text-[11px] font-bold text-gray-500 sticky top-0">{group.label}</div>
                      {group.models.map(m => {
                        const isFailed = failedModels.has(m.id);
                        const isSelected = selectedModelId === m.id;
                        const isAvailable = m.provider === 'gemini' ? !!GEMINI_API_KEY : m.provider === 'groq' ? !!GROQ_API_KEY : !!OPENROUTER_API_KEY;
                        return (
                          <button key={m.id} onClick={() => { if (isAvailable) { setSelectedModelId(m.id); setShowModelSelector(false); } }} disabled={!isAvailable}
                            className={`w-full text-right px-3 py-2 text-sm flex items-center gap-2 transition ${isSelected ? 'bg-orange-50 text-orange-700 font-bold' : ''} ${isFailed ? 'bg-red-50 text-red-400' : ''} ${!isAvailable ? 'opacity-40 cursor-not-allowed' : 'hover:bg-gray-50'} ${!isSelected && !isFailed && isAvailable ? 'text-gray-700' : ''}`}
                          >
                            <span>{m.emoji}</span>
                            <div className="flex-1">
                              <span className="block text-[13px]">{m.name}</span>
                              <span className="block text-[10px] text-gray-400">
                                {m.provider === 'gemini' && 'Google API'}
                                {m.provider === 'groq' && 'Groq API ⚡'}
                                {m.provider === 'openrouter' && 'OpenRouter'}
                                {isFailed && ' • ❌ فشل'}
                                {!isAvailable && ' • 🔑 بدون مفتاح'}
                              </span>
                            </div>
                            {isSelected && <span className="text-green-500">✓</span>}
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ✅ شريط البحث عن الطالب */}
          {students.length > 0 && (
            <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border-b border-blue-100 px-3 py-2" ref={studentSearchRef}>
              <div className="relative">
                <div className="flex items-center gap-2 bg-white rounded-xl border border-blue-200 focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100 transition shadow-sm">
                  <span className="pr-3 text-blue-400 text-sm">🔍</span>
                  <input
                    type="text"
                    value={studentSearchQuery}
                    onChange={e => handleStudentSearch(e.target.value)}
                    onFocus={() => { if (studentSuggestions.length > 0) setShowSuggestions(true); }}
                    placeholder="ابحث عن طالب بالاسم أو الكود..."
                    className="flex-1 py-2 pl-3 text-sm bg-transparent outline-none text-right text-gray-700 placeholder-gray-400"
                    dir="rtl"
                  />
                  {studentSearchQuery && (
                    <button
                      onClick={() => { setStudentSearchQuery(''); setStudentSuggestions([]); setShowSuggestions(false); setShowStudentCard(false); setSelectedStudentCard(null); }}
                      className="pl-2 pr-1 text-gray-400 hover:text-gray-600 transition"
                    >
                      ×
                    </button>
                  )}
                </div>
                <p className="text-[10px] text-blue-500 mt-1 text-right">اكتب اسم الطالب لعرض سجل الحضور فوراً بدون AI</p>

                {showSuggestions && studentSuggestions.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-white rounded-xl shadow-xl border border-blue-100 z-[70] overflow-hidden">
                    {studentSuggestions.map(student => (
                      <button
                        key={student.id}
                        onClick={() => handleSelectStudent(student)}
                        className="w-full text-right px-4 py-2.5 hover:bg-blue-50 flex items-center gap-3 transition border-b border-gray-50 last:border-0"
                      >
                        <div className="w-8 h-8 bg-gradient-to-br from-blue-400 to-indigo-500 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                          {student.name.charAt(0)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-800 truncate">{student.name}</p>
                          <p className="text-[11px] text-gray-500">
                            {student.code && `كود: ${student.code}`}
                            {student.group && ` • كروب: ${student.group}`}
                          </p>
                        </div>
                        <span className="text-blue-400 text-xs">←</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {showStudentCard && selectedStudentCard && (
                <div className="mt-2 bg-white rounded-xl border border-blue-200 shadow-md overflow-hidden">
                  <div className="bg-gradient-to-r from-blue-500 to-indigo-600 text-white px-4 py-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-white bg-opacity-20 rounded-full flex items-center justify-center text-lg font-bold border border-white border-opacity-30">
                          {selectedStudentCard.student.name.charAt(0)}
                        </div>
                        <div>
                          <h4 className="font-bold text-sm">{selectedStudentCard.student.name}</h4>
                          <p className="text-[11px] opacity-90">
                            {selectedStudentCard.student.code && `كود: ${selectedStudentCard.student.code}`}
                            {selectedStudentCard.student.group && ` • كروب: ${selectedStudentCard.student.group}`}
                          </p>
                        </div>
                      </div>
                      <div className="text-left">
                        <div className={`text-xs font-bold px-2 py-1 rounded-full ${selectedStudentCard.isPresentToday ? 'bg-green-400 bg-opacity-30 text-green-100' : 'bg-red-400 bg-opacity-30 text-red-100'}`}>
                          {selectedStudentCard.isPresentToday ? '✅ حاضر اليوم' : '❌ غائب اليوم'}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 divide-x divide-x-reverse divide-gray-100 border-b border-gray-100">
                    <div className="text-center py-2.5 px-2">
                      <p className="text-lg font-bold text-green-600">{selectedStudentCard.attendedCount}</p>
                      <p className="text-[10px] text-gray-500">✅ حضور</p>
                    </div>
                    <div className="text-center py-2.5 px-2">
                      <p className="text-lg font-bold text-red-500">{selectedStudentCard.absentCount}</p>
                      <p className="text-[10px] text-gray-500">❌ غياب</p>
                    </div>
                    <div className="text-center py-2.5 px-2">
                      <p className={`text-lg font-bold ${parseFloat(selectedStudentCard.percentage) >= 75 ? 'text-green-600' : parseFloat(selectedStudentCard.percentage) >= 50 ? 'text-yellow-600' : 'text-red-500'}`}>
                        {selectedStudentCard.percentage}%
                      </p>
                      <p className="text-[10px] text-gray-500">النسبة</p>
                    </div>
                  </div>

                  {(() => {
                    const todayStatus = getTodayStatus(selectedStudentCard);
                    if (todayStatus.sessions.length > 0) {
                      return (
                        <div className="px-3 py-2 bg-yellow-50 border-b border-yellow-100">
                          <p className="text-[11px] font-bold text-yellow-700 mb-1.5">🌟 سجلات اليوم:</p>
                          <div className="space-y-1">
                            {todayStatus.sessions.map((s, idx) => (
                              <div key={idx} className={`flex items-center gap-2 text-[11px] px-2 py-1 rounded-lg ${s.present ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
                                <span>{s.present ? '✅' : '❌'}</span>
                                <span className="font-medium">{s.name}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    }
                    return (
                      <div className="px-3 py-2 bg-gray-50 border-b border-gray-100">
                        <p className="text-[11px] text-gray-500 text-center">⚠️ لا توجد جلسات اليوم</p>
                      </div>
                    );
                  })()}

                  <div className="max-h-[140px] overflow-y-auto">
                    {selectedStudentCard.attendedSessions.length === 0 ? (
                      <div className="text-center py-3 text-gray-400 text-xs">لا توجد جلسات مسجلة</div>
                    ) : (
                      <div className="divide-y divide-gray-50">
                        {selectedStudentCard.attendedSessions.map((as_, idx) => (
                          <div key={idx} className={`flex items-center gap-2 px-3 py-2 text-[11px] ${as_.present ? 'hover:bg-green-50' : 'hover:bg-red-50'} transition`}>
                            <span className="flex-shrink-0">{as_.present ? '✅' : '❌'}</span>
                            <div className="flex-1 min-w-0">
                              <p className={`font-medium truncate ${as_.present ? 'text-green-700' : 'text-red-600'}`}>{as_.session.name}</p>
                              <p className="text-gray-400 text-[10px]">{formatDateWithDay(as_.session._normalizedDate)}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex gap-2 p-2 bg-gray-50 border-t border-gray-100">
                    <button
                      onClick={() => sendStudentQuestion(selectedStudentCard.student)}
                      className="flex-1 bg-gradient-to-r from-blue-500 to-indigo-600 text-white text-[11px] py-2 rounded-lg hover:from-blue-600 hover:to-indigo-700 transition font-medium"
                    >
                      💬 اسأل AI عنه
                    </button>
                    <button
                      onClick={() => { setShowStudentCard(false); setSelectedStudentCard(null); setStudentSearchQuery(''); }}
                      className="px-3 bg-gray-200 text-gray-600 text-[11px] py-2 rounded-lg hover:bg-gray-300 transition"
                    >
                      إغلاق
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* الرسائل */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gradient-to-b from-orange-50 via-white to-pink-50">
            {messages.map(msg => (
              <div key={msg.id} className={`flex ${msg.type === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[90%] rounded-2xl p-3 shadow-sm ${msg.type === 'user' ? 'bg-gradient-to-br from-amber-500 to-orange-600 text-white rounded-br-sm' : 'bg-white text-gray-800 border border-orange-100 rounded-bl-sm'}`}>
                  {msg.type === 'bot' && (
                    <div className="flex items-center gap-1 mb-1.5 text-[10px] text-orange-600 font-semibold">
                      <span>✨</span><span>المساعد الذكي</span>
                    </div>
                  )}
                  <div className="text-sm leading-relaxed whitespace-pre-wrap break-words">{formatMessage(msg.content)}</div>
                  <p className={`text-[10px] mt-1.5 ${msg.type === 'user' ? 'text-orange-100' : 'text-gray-400'}`}>
                    {msg.timestamp.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </div>
            ))}

            {isTyping && (
              <div className="flex justify-start">
                <div className="bg-white border border-orange-100 rounded-2xl rounded-bl-sm p-3 shadow-sm">
                  <div className="flex items-center gap-2">
                    <div className="flex gap-1">
                      <span className="w-2 h-2 bg-amber-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="w-2 h-2 bg-orange-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="w-2 h-2 bg-pink-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                    <span className="text-xs text-gray-500">{activeModel.emoji} {activeModel.name} يفكر...</span>
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {error && (
            <div className="px-3 py-2 bg-red-50 border-t border-red-200">
              <p className="text-xs text-red-700">❌ {error}</p>
            </div>
          )}

          <div className="p-3 bg-white border-t border-orange-100">
            <div className="flex gap-2 items-end">
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="اسألني أي شي..."
                rows={1}
                className="flex-1 px-3 py-2 border border-orange-200 rounded-2xl focus:ring-2 focus:ring-orange-400 focus:border-transparent text-sm resize-none max-h-24"
                dir="rtl"
                style={{ minHeight: '40px' }}
                onInput={e => {
                  const target = e.target as HTMLTextAreaElement;
                  target.style.height = 'auto';
                  target.style.height = `${Math.min(target.scrollHeight, 96)}px`;
                }}
                disabled={isTyping}
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || isTyping}
                className="bg-gradient-to-br from-amber-500 to-pink-600 hover:from-amber-600 hover:to-pink-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-full w-10 h-10 flex items-center justify-center transition shadow-md hover:shadow-lg flex-shrink-0"
              >
                {isTyping ? (
                  <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5 transform -scale-x-100" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                  </svg>
                )}
              </button>
            </div>
            <p className="text-[10px] text-gray-400 mt-1.5 text-center">
              {activeModel.emoji} <span className="text-orange-600 font-semibold">{activeModel.name}</span>
              {selectedModelId === 'auto' ? ' • تلقائي' : ' • يدوي'}
            </p>
          </div>
        </div>
      )}
    </>
  );
};