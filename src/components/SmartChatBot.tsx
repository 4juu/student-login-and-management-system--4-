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
  // ═══════════════════════════════════════
  // 🟡 Google Gemini (مجاني - دقيق)
  // ═══════════════════════════════════════
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash ⚡', provider: 'gemini', model: 'gemini-2.5-flash', emoji: '🟡' },
  { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', provider: 'gemini', model: 'gemini-2.0-flash', emoji: '🟡' },
  { id: 'gemini-2.0-flash-exp', name: 'Gemini 2.0 Exp 🧪', provider: 'gemini', model: 'gemini-2.0-flash-exp', emoji: '🟡' },
  { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash', provider: 'gemini', model: 'gemini-1.5-flash', emoji: '🟡' },
  { id: 'gemini-1.5-flash-8b', name: 'Gemini 1.5 Flash 8B', provider: 'gemini', model: 'gemini-1.5-flash-8b', emoji: '🟡' },
  { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro 🧠', provider: 'gemini', model: 'gemini-1.5-pro', emoji: '🟡' },
  
  // ═══════════════════════════════════════
  // ⚡ Groq (مجاني - الأسرع بالعالم)
  // ═══════════════════════════════════════
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

// ✅ تحويل كل أنواع الأرقام (عربي، فارسي، هندي) لإنجليزية
const toEnglishDigits = (str: string): string => {
  if (!str) return '';
  return String(str).replace(/[\u0660-\u0669\u06F0-\u06F9]/g, (ch) => {
    const code = ch.charCodeAt(0);
    // أرقام عربية U+0660-U+0669
    if (code >= 0x0660 && code <= 0x0669) {
      return String(code - 0x0660);
    }
    // أرقام فارسية U+06F0-U+06F9
    if (code >= 0x06F0 && code <= 0x06F9) {
      return String(code - 0x06F0);
    }
    return ch;
  });
};

// ✅ توحيد التاريخ - يدعم كل الصيغ
const normalizeDateKey = (value?: string | Date | null): string => {
  try {
    if (!value) return '';

    // 1. إذا كان Date object
    if (value instanceof Date) {
      if (isNaN(value.getTime())) return '';
      return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`;
    }

    // 2. تحويل النص
    let text = String(value).trim();
    if (!text) return '';

    // ✅ الخطوة الأهم: تحويل الأرقام العربية لإنجليزية أولاً
    text = toEnglishDigits(text);

    // الآن النص صار: "2026/5/15" بدلاً من "٢٠٢٦/٥/١٥"

    // 3. توحيد الفواصل (كل شيء يصير شرطة -)
    text = text.replace(/[/\\.]/g, '-');
    // الآن النص صار: "2026-5-15"

    // 4. استخراج YYYY-MM-DD
    const ymdMatch = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (ymdMatch) {
      const y = ymdMatch[1];
      const m = pad2(parseInt(ymdMatch[2]));
      const d = pad2(parseInt(ymdMatch[3]));
      return `${y}-${m}-${d}`;
      // النتيجة: "2026-05-15" ✅
    }

    // 5. صيغة مقلوبة DD-MM-YYYY
    const dmyMatch = text.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
    if (dmyMatch && dmyMatch[3].length === 4) {
      return `${dmyMatch[3]}-${pad2(parseInt(dmyMatch[2]))}-${pad2(parseInt(dmyMatch[1]))}`;
    }

    // 6. Fallback
    const dateObj = new Date(text);
    if (!isNaN(dateObj.getTime())) {
      return `${dateObj.getFullYear()}-${pad2(dateObj.getMonth() + 1)}-${pad2(dateObj.getDate())}`;
    }

    return '';
  } catch (e) {
    console.error('normalizeDateKey error:', value, e);
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

// ✅ استدعاء Gemini
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

// ✅ استدعاء Groq (مجاني وأسرع بالعالم)
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
    messages.push({
      role: msg.type === 'user' ? 'user' : 'assistant',
      content: msg.content,
    });
  });
  messages.push({ role: 'user', content: userMessage });

  const response = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.1,
      max_tokens: 8192,
      top_p: 0.85,
      stream: false,
    }),
  });
  
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const err: any = new Error(errorData?.error?.message || `Error ${response.status}`);
    err.status = response.status;
    throw err;
  }
  
  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) {
    const err: any = new Error('EMPTY_RESPONSE');
    err.status = 0;
    throw err;
  }
  return text;
};

// ✅ استدعاء OpenRouter
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
    messages.push({
      role: msg.type === 'user' ? 'user' : 'assistant',
      content: msg.content,
    });
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
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.1,
      max_tokens: 8192,
      top_p: 0.85,
    }),
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const err: any = new Error(errorData?.error?.message || `Error ${response.status}`);
    err.status = response.status;
    throw err;
  }
  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) {
    const err: any = new Error('EMPTY_RESPONSE');
    err.status = 0;
    throw err;
  }
  return text;
};

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
  
  // ✅ اختيار الموديل يدوي أو تلقائي
  const [selectedModelId, setSelectedModelId] = useState<string>('auto');
  const [showModelSelector, setShowModelSelector] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const lastRequestTime = useRef<number>(0);
  const modelSelectorRef = useRef<HTMLDivElement>(null);


  // ✅ إغلاق قائمة الموديلات عند الضغط خارجها
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (modelSelectorRef.current && !modelSelectorRef.current.contains(event.target as Node)) {
        setShowModelSelector(false);
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

  useEffect(() => {
    if (isOpen && messages.length === 0) {
      setMessages([{
        id: Date.now().toString(),
        type: 'bot',
        content: `أهلاً ${user.displayName} ✨\n\nبشنو أكدر أساعدك اليوم؟`,
        timestamp: new Date(),
      }]);
    }
  }, [isOpen, messages.length, user.displayName]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  useEffect(() => {
    if (isOpen) setTimeout(() => inputRef.current?.focus(), 300);
  }, [isOpen]);

  // ✅ الموديل الحالي اللي يظهر بالـ Header
  const activeModel = useMemo(() => {
    if (selectedModelId === 'auto') {
      return AI_MODELS[currentModelIndex] || AI_MODELS[0];
    }
    return AI_MODELS.find(m => m.id === selectedModelId) || AI_MODELS[0];
  }, [selectedModelId, currentModelIndex]);

  // ✅ بناء السياق مع تدقيق محسن لحضور اليوم
  // ✅ دالة جديدة لإصلاح التواريخ - تشتغل 100%
  const fixDate = useCallback((rawDate: any): string => {
    if (!rawDate) return '';
    
    if (rawDate instanceof Date) {
      const y = rawDate.getFullYear();
      const m = String(rawDate.getMonth() + 1).padStart(2, '0');
      const d = String(rawDate.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
    
    let text = String(rawDate).trim();
    
    // ✅ حذف الرموز الخفية (RTL/LTR marks)
    text = text.replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '');
    
    // ✅ تحويل الأرقام العربية والفارسية لإنجليزية
    let cleaned = '';
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (code >= 0x0660 && code <= 0x0669) {
        cleaned += String(code - 0x0660);
      } else if (code >= 0x06F0 && code <= 0x06F9) {
        cleaned += String(code - 0x06F0);
      } else {
        cleaned += text[i];
      }
    }
    
    // ✅ استخراج كل الأرقام
    const numbers = cleaned.match(/\d+/g);
    if (!numbers || numbers.length < 3) return cleaned;
    
    // ✅ نلاقي السنة (الرقم بـ 4 خانات)
    let yearIdx = -1;
    for (let i = 0; i < numbers.length; i++) {
      if (numbers[i].length === 4) {
        yearIdx = i;
        break;
      }
    }
    
    let year = '', month = '', day = '';
    
    if (yearIdx === 0) {
      // YYYY-MM-DD (السنة بالأول)
      year = numbers[0];
      month = numbers[1];
      day = numbers[2];
    } else if (yearIdx === 2) {
      // DD-MM-YYYY (السنة بالآخر)
      day = numbers[0];
      month = numbers[1];
      year = numbers[2];
    } else if (yearIdx === 1) {
      // MM-YYYY-DD (نادر)
      month = numbers[0];
      year = numbers[1];
      day = numbers[2];
    } else {
      // ما لقينا سنة، نفترض YYYY-MM-DD
      year = numbers[0];
      month = numbers[1];
      day = numbers[2];
    }
    
    if (!year || !month || !day) return cleaned;
    
    return `${year}-${String(parseInt(month)).padStart(2, '0')}-${String(parseInt(day)).padStart(2, '0')}`;
  }, []);

  const buildDataContext = useCallback((): string => {
    const now = new Date();
    const todayDate = fixDate(now);

    // ✅ إصلاح تواريخ كل الجلسات والسجلات
    const fixedSessions = sessions.map(s => ({
      ...s,
      date: fixDate((s as any).date),
      _originalDate: (s as any).date,
    }));

    const fixedRecords = records.map(r => ({
      ...r,
      date: (r as any).date ? fixDate((r as any).date) : '',
    }));

    // 🔍 DEBUG
    console.log('=== DEBUG TODAY ===');
    console.log('todayDate:', todayDate);
    console.log('sessions count:', fixedSessions.length);
    fixedSessions.slice(0, 5).forEach((s, i) => {
      console.log(`session[${i}]:`, {
        id: s.id,
        name: s.name,
        rawDate: (s as any)._originalDate,
        fixedDate: s.date,
        matchesToday: s.date === todayDate,
      });
    });
    console.log('=== END DEBUG ===');

    const sortedSessions = [...fixedSessions].sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return String(a.name || '').localeCompare(String(b.name || ''), 'ar');
    });

    const sessionById = new Map(sortedSessions.map(s => [s.id, s]));

    const groups = Array.from(new Set(students.map(s => s.group).filter(Boolean))) as string[];
    groups.sort((a, b) => a.localeCompare(b, 'ar'));

    let context = `# قاعدة بيانات نظام الحضور\n\n`;
    context += `## معلومات المستخدم:\n`;
    context += `- الاسم: ${user.displayName}\n`;
    context += `- الدور: ${isAdmin ? 'أدمن' : 'تدريسي'}\n\n`;
    context += `## التاريخ الحالي:\n`;
    context += `- اليوم: ${formatDateWithDay(todayDate)}\n`;
    context += `- التاريخ: ${todayDate}\n`;
    context += `- الوقت: ${now.toLocaleTimeString('ar-EG')}\n\n`;

    if (currentCollege && currentStage) {
      context += `## الموقع الحالي:\n`;
      context += `- الكلية: ${currentCollege.name}\n`;
      context += `- المرحلة: ${currentStage.name}\n\n`;
    }

    if (currentStageId && students.length > 0) {
      const allTodaySessionIds = new Set<string>();
      
      sortedSessions.forEach(s => {
        if (s.date === todayDate) {
          allTodaySessionIds.add(s.id);
        }
      });
      
      fixedRecords.forEach(r => {
        const session = sessionById.get(r.sessionId);
        if (session && session.date === todayDate) {
          allTodaySessionIds.add(r.sessionId);
        }
      });

      fixedRecords.forEach(r => {
        if (r.date && r.date === todayDate) {
          allTodaySessionIds.add(r.sessionId);
        }
      });

      const finalTodaySessions = sortedSessions.filter(s => allTodaySessionIds.has(s.id));
      const finalTodayRecords = fixedRecords.filter(r => allTodaySessionIds.has(r.sessionId));
      
      const presentStudentIds = new Set<string>();
      finalTodayRecords.forEach(r => presentStudentIds.add(r.studentId));
      
      const presentStudents = students.filter(s => presentStudentIds.has(s.id));
      const absentStudents = students.filter(s => !presentStudentIds.has(s.id));
      const hasActivity = allTodaySessionIds.size > 0;

      console.log('🎯 RESULTS:', {
        todayDate,
        todaySessions: finalTodaySessions.length,
        present: presentStudents.length,
        absent: absentStudents.length,
      });

      context += `## ═══════════════════════════════════════\n`;
      context += `## 🌟 حضور اليوم (${todayDate})\n`;
      context += `## ═══════════════════════════════════════\n\n`;
      
      context += `### 🚨🚨🚨 أرقام مؤكدة 100% 🚨🚨🚨\n`;
      context += `- يوجد نشاط اليوم: **${hasActivity ? '✅ نعم' : '❌ لا'}**\n`;
      context += `- عدد جلسات اليوم: **${finalTodaySessions.length}**\n`;
      context += `- عدد سجلات الحضور اليوم: **${finalTodayRecords.length}**\n`;
      context += `- إجمالي الطلاب: **${students.length}**\n`;
      context += `- ✅ عدد الحاضرين اليوم: **${presentStudents.length}**\n`;
      context += `- ❌ عدد الغائبين اليوم: **${absentStudents.length}**\n`;
      
      if (students.length > 0) {
        context += `- 📊 نسبة الحضور: **${((presentStudents.length / students.length) * 100).toFixed(1)}%**\n`;
      }
      context += `\n`;

      if (hasActivity) {
        // ✅ تفصيل كل جلسة/سجل اليوم على حدة
        context += `### 📋 تفصيل كل سجل اليوم على حدة:\n\n`;
        
        finalTodaySessions.forEach((session, sIdx) => {
          const sessionRecs = fixedRecords.filter(r => r.sessionId === session.id);
          const sessionPresentIds = new Set(sessionRecs.map(r => r.studentId));
          const sessionPresent = students.filter(s => sessionPresentIds.has(s.id));
          const sessionAbsent = students.filter(s => !sessionPresentIds.has(s.id));
          const sessionRate = students.length > 0 
            ? ((sessionPresent.length / students.length) * 100).toFixed(1) 
            : '0';

          context += `#### 🔵 السجل ${sIdx + 1}: **${session.name}**\n`;
          context += `- 📅 التاريخ: ${formatDateWithDay(session.date)}\n`;
          context += `- 📊 الإحصائيات: ✅ ${sessionPresent.length} حاضر | ❌ ${sessionAbsent.length} غائب | نسبة ${sessionRate}%\n\n`;

          context += `**✅ حاضرين سجل "${session.name}" (${sessionPresent.length}):**\n`;
          if (sessionPresent.length > 0) {
            sessionPresent.forEach((st, i) => {
              context += `${i + 1}. ✅ **${st.name}** | كود: ${st.code} | كروب: ${st.group || '-'}\n`;
            });
          } else {
            context += `- لا يوجد حاضرين بهذا السجل\n`;
          }
          context += `\n`;

          context += `**❌ غائبين سجل "${session.name}" (${sessionAbsent.length}):**\n`;
          if (sessionAbsent.length > 0) {
            sessionAbsent.forEach((st, i) => {
              context += `${i + 1}. ❌ **${st.name}** | كود: ${st.code} | كروب: ${st.group || '-'}\n`;
            });
          } else {
            context += `- الكل حاضر بهذا السجل! 🎉\n`;
          }
          context += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
        });

        // ✅ ملخص إجمالي (اختياري للأسئلة العامة)
        context += `### 📌 ملخص اليوم الإجمالي (للأسئلة العامة فقط):\n`;
        context += `- عدد السجلات اليوم: **${finalTodaySessions.length}**\n`;
        context += `- طلاب حضروا بأي سجل: **${presentStudents.length}**\n`;
        context += `- طلاب لم يحضروا أي سجل: **${absentStudents.length}**\n\n`;
      } else {
        context += `### ⚠️ لا يوجد جلسة بتاريخ اليوم\n\n`;
      }

      context += `## 📅 جميع الجلسات (${sortedSessions.length}):\n`;
      sortedSessions.forEach((session, index) => {
        const presentCount = fixedRecords.filter(r => r.sessionId === session.id).length;
        const isToday = session.date === todayDate ? ' 🌟 اليوم' : '';
        context += `${index + 1}. **${session.name}** | ${formatDateWithDay(session.date)} | ${presentCount}/${students.length}${isToday}\n`;
      });
      context += `\n`;

      context += `## 👥 تفاصيل الطلاب (${students.length}):\n\n`;
      const sortedStudents = [...students].sort((a, b) => {
        const ga = a.group || 'ZZZ';
        const gb = b.group || 'ZZZ';
        if (ga !== gb) return ga.localeCompare(gb, 'ar');
        return a.name.localeCompare(b.name, 'ar');
      });

      sortedStudents.forEach(student => {
        const studentRecords = fixedRecords.filter(r => r.studentId === student.id);
        const attendedSessionIds = new Set(studentRecords.map(r => r.sessionId));
        const attendedCount = sortedSessions.filter(s => attendedSessionIds.has(s.id)).length;
        const absentCount = sortedSessions.length - attendedCount;
        const percentage = sortedSessions.length > 0 ? ((attendedCount / sortedSessions.length) * 100).toFixed(1) : '0';
        const isPresentToday = presentStudentIds.has(student.id);

        context += `### 👤 **${student.name}**\n`;
        context += `- الكود: ${student.code}\n`;
        context += `- الكروب: ${student.group || '-'}\n`;
        context += `- حضور اليوم: ${isPresentToday ? '✅ حاضر' : '❌ غائب'}\n`;
        context += `- الحضور: ${attendedCount} | الغياب: ${absentCount} | النسبة: ${percentage}%\n`;
        context += `- سجل كامل:\n`;
        sortedSessions.forEach(session => {
          const isPresent = attendedSessionIds.has(session.id);
          const icon = isPresent ? '✅' : '❌';
          const isToday = session.date === todayDate ? ' 🌟' : '';
          context += `  ${icon} ${formatDateWithDay(session.date)} | ${session.name}${isToday}\n`;
        });
        context += `\n`;
      });

      if (groups.length > 0) {
        context += `## 📊 إحصائيات الكروبات:\n`;
        groups.forEach(group => {
          const groupStudents = students.filter(s => s.group === group);
          const groupStudentIds = new Set(groupStudents.map(s => s.id));
          const groupRecords = fixedRecords.filter(r => groupStudentIds.has(r.studentId));
          const possible = groupStudents.length * sortedSessions.length;
          const groupPercentage = possible > 0 ? ((groupRecords.length / possible) * 100).toFixed(1) : '0';
          const groupPresentToday = groupStudents.filter(s => presentStudentIds.has(s.id)).length;
          const groupAbsentToday = groupStudents.length - groupPresentToday;
          context += `- **${group}**: ${groupStudents.length} طالب | حضور عام ${groupPercentage}% | اليوم: ✅${groupPresentToday} ❌${groupAbsentToday}\n`;
        });
        context += `\n`;
      }

      const totalPossible = students.length * sortedSessions.length;
      const overallRate = totalPossible > 0 ? ((fixedRecords.length / totalPossible) * 100).toFixed(2) : '0';
      context += `## 📈 الإحصائيات العامة:\n`;
      context += `- عدد الطلاب: ${students.length}\n`;
      context += `- عدد الجلسات: ${sortedSessions.length}\n`;
      context += `- مجموع سجلات الحضور: ${fixedRecords.length}\n`;
      context += `- نسبة الحضور العامة: ${overallRate}%\n\n`;

    } else {
      context += `## ⚠️ لا توجد مرحلة مختارة حالياً\n`;
      accessibleData.accessibleColleges.forEach(college => {
        const collegeStages = accessibleData.accessibleStages.filter(stage => stage.collegeId === college.id);
        context += `- ${college.name}: ${collegeStages.map(s => s.name).join('، ')}\n`;
      });
      context += `\n`;
    }

    if (isAdmin && !currentStageId && Object.keys(accessibleData.stagesMap).length > 0) {
      context += `## 🏛️ ملخص المراحل:\n`;
      Object.entries(accessibleData.stagesMap).forEach(([_stageId, stageData]) => {
        const totalPossible = stageData.students.length * stageData.sessions.length;
        const rate = totalPossible > 0 ? ((stageData.records.length / totalPossible) * 100).toFixed(1) : '0';
        context += `- **${stageData.collegeName} / ${stageData.stageName}**: ${stageData.students.length} طالب | ${stageData.sessions.length} جلسة | ${rate}%\n`;
      });
      context += `\n`;
    }

    return context;
  }, [sessions, records, students, user.displayName, isAdmin, currentCollege, currentStage, currentStageId, accessibleData, fixDate]);

  // 🧠 تحليل السؤال
  const analyzeQuestion = useCallback((question: string): string => {
    let hint = '';
    const todayKey = fixDate(new Date());

    const asksPresent = /حاضر|حضر|حضور|الموجود|اللي اج|دوام|جا|اجا|اجو/i.test(question);
    const asksAbsent = /غاب|غائب|غياب|ماجا|ما حضر|مو موجود|الناقص|ما اجا|ماجو/i.test(question);
    const asksToday = /اليوم|هسه|هسة|الحين|اليومية/i.test(question);
    const asksAdmin = /مدير|مسؤول|الدعم|النظام|الموقع|من سوى|من صمم|من برمج|من المشرف|صاحب|owner|admin|developer/i.test(question);

    if (asksAdmin) {
      hint += `\n\n[🚨 الجواب الإلزامي: مدير الموقع/النظام هو "الدكتور الصيدلاني مجتبى هيثم محمد"]`;
      return hint;
    }

    const fixedSessions = sessions.map(s => ({
      ...s,
      _normalizedDate: fixDate((s as any).date),
    }));

    const sessionsLookup = new Map(fixedSessions.map(s => [s.id, s]));
    const todaySessionIdsSet = new Set<string>();
    
    fixedSessions.forEach(s => {
      if (s._normalizedDate === todayKey) todaySessionIdsSet.add(s.id);
    });
    
    records.forEach(r => {
      const sess = sessionsLookup.get(r.sessionId);
      if (sess && sess._normalizedDate === todayKey) todaySessionIdsSet.add(r.sessionId);
    });
    
    const todayRecords = records.filter(r => todaySessionIdsSet.has(r.sessionId));
    const presentIds = new Set(todayRecords.map(r => r.studentId));
    const present = students.filter(s => presentIds.has(s.id));
    const absent = students.filter(s => !presentIds.has(s.id));
    const THRESHOLD = 50;

    console.log('🧠 analyzeQuestion:', {
      todayKey,
      todaySessionsCount: todaySessionIdsSet.size,
      presentCount: present.length,
      absentCount: absent.length,
    });

    if (asksPresent && !asksAbsent) {
      if (present.length === 0) {
        hint += `\n\n[🚨 لا يوجد حاضرين اليوم (${todayKey}). ممنوع تقول فيه حاضرين]`;
      } else if (present.length > THRESHOLD) {
        hint += `\n\n[🚨 السؤال عن الحاضرين فقط. العدد: ${present.length} (أكثر من 50). اذكر العدد فقط واطلب تصدير اكسل]`;
      } else {
        hint += `\n\n[🚨 السؤال عن الحاضرين فقط (${present.length} طالب). اعرضهم بـ ✅. ممنوع ذكر الغائبين.\nالأسماء: ${present.map(s => `${s.name} (${s.code}, ${s.group || '-'})`).join(' | ')}]`;
      }
      return hint;
    }

    if (asksAbsent && !asksPresent) {
      if (absent.length === 0) {
        hint += `\n\n[🚨 لا يوجد غائبين اليوم - الكل حاضر]`;
      } else if (absent.length > THRESHOLD) {
        hint += `\n\n[🚨 السؤال عن الغائبين فقط. العدد: ${absent.length} (أكثر من 50). اذكر العدد فقط واطلب تصدير اكسل]`;
      } else {
        hint += `\n\n[🚨 السؤال عن الغائبين فقط (${absent.length} طالب). اعرضهم بـ ❌. ممنوع ذكر الحاضرين.\nالأسماء: ${absent.map(s => `${s.name} (${s.code}, ${s.group || '-'})`).join(' | ')}]`;
      }
      return hint;
    }

    if (asksToday || asksPresent || asksAbsent) {
      const total = students.length;
      
      // ✅ نجمع كل جلسات اليوم منفصلة
      const todaySessionsList = fixedSessions.filter(s => todaySessionIdsSet.has(s.id));
      
      if (todaySessionsList.length === 0) {
        hint += `\n\n[🚨 لا توجد بيانات حضور لليوم (${todayKey})]`;
        return hint;
      }

      if (total > THRESHOLD) {
        let perSessionSummary = '';
        todaySessionsList.forEach(sess => {
          const sRecs = records.filter(r => r.sessionId === sess.id);
          perSessionSummary += `\n• سجل "${sess.name}": ${sRecs.length}/${total} حاضر`;
        });
        hint += `\n\n[🚨 عدد كبير من الطلاب (${total}). فصّل كل سجل لحاله:${perSessionSummary}\n\nاطلب تصدير اكسل للتفاصيل]`;
        return hint;
      }

      // ✅ بناء تلميح مفصّل لكل سجل
      let sessionsBreakdown = `\n\n[🚨🚨🚨 إلزامي: فصّل كل سجل لحاله، لا تجمعهم!\n`;
      sessionsBreakdown += `عدد سجلات اليوم: ${todaySessionsList.length}\n\n`;
      
      todaySessionsList.forEach((sess, idx) => {
        const sRecs = records.filter(r => r.sessionId === sess.id);
        const sPresentIds = new Set(sRecs.map(r => r.studentId));
        const sPresent = students.filter(s => sPresentIds.has(s.id));
        const sAbsent = students.filter(s => !sPresentIds.has(s.id));
        
        sessionsBreakdown += `━━━ السجل ${idx + 1}: "${sess.name}" ━━━\n`;
        sessionsBreakdown += `✅ حاضرين (${sPresent.length}): ${sPresent.map(s => `${s.name} (${s.code}, ${s.group || '-'})`).join(' | ') || 'لا أحد'}\n`;
        sessionsBreakdown += `❌ غائبين (${sAbsent.length}): ${sAbsent.map(s => `${s.name} (${s.code}, ${s.group || '-'})`).join(' | ') || 'لا أحد'}\n\n`;
      });
      
      sessionsBreakdown += `\n⛔ ممنوع تجمع السجلات سوا!\n`;
      sessionsBreakdown += `⛔ ممنوع تقول "الحاضرين اليوم" بشكل عام!\n`;
      sessionsBreakdown += `✅ اعرض كل سجل لحاله بعنوان واضح!]`;
      
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
  }, [students, records, sessions, fixDate]);

  // ✅ استدعاء AI مع دعم الاختيار اليدوي
  const callGeminiAPI = useCallback(
    async (userMessage: string, conversationHistory: Message[]): Promise<string> => {
if (!GEMINI_API_KEY && !OPENROUTER_API_KEY && !GROQ_API_KEY) {
  return `⚠️ لازم تضيف API Key بالـ .env:\n\nVITE_GEMINI_API_KEY=...\nأو VITE_GROQ_API_KEY=...\nأو VITE_OPENROUTER_API_KEY=...`;
}

      const dataContext = buildDataContext();
      const questionHint = analyzeQuestion(userMessage);
      const enhancedMessage = userMessage + questionHint;

      const systemInstruction = `أنت مساعد ذكي متخصص فقط بنظام حضور الطلاب.

# 🚨 قواعد إلزامية:

## ⛔ ممنوع:
- ❌ ممنوع تقول "ماكو جلسة اليوم" قبل ما تفحص كل المصادر
- ❌ ممنوع تتجاهل التلميحات بين [🚨]
- ❌ ممنوع تذكر الغائبين إذا السؤال عن الحاضرين فقط
- ❌ ممنوع تذكر الحاضرين إذا السؤال عن الغائبين فقط
- ❌ ممنوع تخمين أي شي
- ❌ 🚨🚨 ممنوع تجمع سجلات اليوم سوا! كل سجل لحاله!
- ❌ ممنوع تقول "الحاضرين اليوم: X, Y, Z" كقائمة موحّدة
- ❌ ممنوع تحسب طالب حاضر بكل السجلات لو هو حضر بسجل واحد فقط

## 📋 لما يكون فيه أكثر من سجل (جلسة) باليوم:
1. ✅ افصل كل سجل لحاله بعنوان واضح: "السجل 1: اسم السجل"
2. ✅ لكل سجل اعرض الحاضرين والغائبين الخاصين فيه فقط
3. ✅ استخدم فاصل واضح بين السجلات: ━━━━━━━━━
4. ✅ لو الطالب حاضر بسجل وغائب بثاني → اعرضه ✅ بسجل و ❌ بالثاني

## 🔍 لأي سؤال عن اليوم:
1. افحص "🚨🚨🚨 أرقام مؤكدة 100%"
2. إذا "يوجد نشاط اليوم: ✅ نعم" → فيه حضور أكيد
3. اقرأ التلميحات بين [🚨] واعتمد عليها حرفياً
4. فقط إذا كل شي = 0 → قل "ماكو حضور اليوم"

## 👨‍⚕️ مدير الموقع:
**الدكتور الصيدلاني مجتبى هيثم محمد**

## 📊 أكثر من 50 طالب:
اذكر العدد فقط + اطلب تصدير اكسل

## ✅ القواعد:
1. أجب بالعربية العراقية
2. ✅ للحاضر (أخضر) و ❌ للغائب (أحمر)
3. استخدم **bold** للأسماء
4. كن دقيق 100%
5. خاطب التدريسي بـ "دكتور"

---

${dataContext}`;

      // Gemini contents
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

      // ✅ إذا اختار موديل معين
      if (selectedModelId !== 'auto') {
        const chosen = AI_MODELS.find(m => m.id === selectedModelId);
        if (!chosen) return '❌ الموديل المختار غير موجود';

        if (chosen.provider === 'gemini' && !GEMINI_API_KEY) {
          return '🔑 مو متوفر Gemini API Key';
        }
        if (chosen.provider === 'openrouter' && !OPENROUTER_API_KEY) {
          return '🔑 مو متوفر OpenRouter API Key';
        }
        if (chosen.provider === 'groq' && !GROQ_API_KEY) {
          return '🔑 مو متوفر Groq API Key';
        }

        try {
          console.log(`🎯 موديل مختار: ${chosen.name}`);
          if (chosen.provider === 'gemini') {
            return await callGeminiDirect(chosen.model, geminiContents);
          } else if (chosen.provider === 'groq') {
            return await callGroqDirect(chosen.model, systemInstruction, conversationHistory, enhancedMessage);
          } else {
            return await callOpenRouterDirect(chosen.model, systemInstruction, conversationHistory, enhancedMessage);
          }
        } catch (err: any) {
          return `❌ ${chosen.name} فشل: ${err?.message || 'خطأ غير معروف'}\n\n💡 جرب موديل ثاني أو خله "تلقائي"`;
        }
      }

      // ✅ الوضع التلقائي - يجرب كل الموديلات
      for (let i = currentModelIndex; i < AI_MODELS.length; i++) {
        const aiModel = AI_MODELS[i];
        if (failedModels.has(aiModel.id)) continue;
        if (aiModel.provider === 'gemini' && !GEMINI_API_KEY) continue;
        if (aiModel.provider === 'openrouter' && !OPENROUTER_API_KEY) continue;
        if (aiModel.provider === 'groq' && !GROQ_API_KEY) continue;

        try {
          console.log(`🔄 يجرب: ${aiModel.name}`);
          let text = '';
          if (aiModel.provider === 'gemini') {
            text = await callGeminiDirect(aiModel.model, geminiContents);
          } else if (aiModel.provider === 'groq') {
            text = await callGroqDirect(aiModel.model, systemInstruction, conversationHistory, enhancedMessage);
          } else {
            text = await callOpenRouterDirect(aiModel.model, systemInstruction, conversationHistory, enhancedMessage);
          }

          if (i !== currentModelIndex) {
            setCurrentModelIndex(i);
            console.log(`✅ يشتغل: ${aiModel.name}`);
          }
          return text;

        } catch (err: any) {
          const status = err?.status || 0;
          const message = err?.message || 'خطأ غير معروف';
          lastError = `${aiModel.name}: ${message}`;
          console.warn(`❌ ${aiModel.name} (${status}):`, message);

          if (status === 401 || status === 403) {
            if (aiModel.provider === 'gemini') {
              setFailedModels(prev => new Set([...prev, aiModel.id]));
              continue;
            }
            return `🔑 مشكلة بـ OpenRouter API Key\n${message}`;
          }

          setFailedModels(prev => new Set([...prev, aiModel.id]));
          if (i < AI_MODELS.length - 1) {
            await sleep([429, 503].includes(status) ? 1200 : 300);
            continue;
          }
        }
      }

      return `🌐 جميع الموديلات توقفت مؤقتاً\n\nآخر خطأ: ${lastError}\n\n💡 اضغط 🔄 وحاول ثاني`;
    },
    [buildDataContext, currentModelIndex, analyzeQuestion, failedModels, selectedModelId]
  );

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isTyping) return;
    const now = Date.now();
    if (now - lastRequestTime.current < 2000) {
      const wait = Math.ceil((2000 - (now - lastRequestTime.current)) / 1000);
      setError(`⏱️ انتظر ${wait} ثانية`);
      setTimeout(() => setError(null), 2000);
      return;
    }
    lastRequestTime.current = now;
    setError(null);

    const userMessage: Message = {
      id: Date.now().toString(),
      type: 'user',
      content: text.trim(),
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    if (inputRef.current) inputRef.current.style.height = '40px';
    setIsTyping(true);

    try {
      const response = await callGeminiAPI(text.trim(), messages);
      setMessages(prev => [...prev, {
        id: `${Date.now()}_bot`,
        type: 'bot',
        content: response,
        timestamp: new Date(),
      }]);
    } catch (err: any) {
      setError(err?.message || 'حدث خطأ غير متوقع');
    } finally {
      setIsTyping(false);
    }
  }, [messages, isTyping, callGeminiAPI]);

  const handleSend = useCallback(() => sendMessage(input), [input, sendMessage]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleReset = useCallback(() => {
    if (window.confirm('متأكد من مسح المحادثة؟')) {
      setMessages([]);
      setError(null);
      setCurrentModelIndex(0);
      setFailedModels(new Set());
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
      let lastIndex = 0;
      let match;
      let key = 0;

      while ((match = boldRegex.exec(line)) !== null) {
        if (match.index > lastIndex) {
          parts.push(<React.Fragment key={`t-${i}-${key++}`}>{line.substring(lastIndex, match.index)}</React.Fragment>);
        }
        let boldClass = 'font-bold text-gray-900';
        if (lineHasCheck) boldClass = 'font-bold text-green-800';
        if (lineHasCross) boldClass = 'font-bold text-red-800';
        parts.push(<strong key={`b-${i}-${key++}`} className={boldClass}>{match[1]}</strong>);
        lastIndex = match.index + match[0].length;
      }
      if (lastIndex < line.length) {
        parts.push(<React.Fragment key={`e-${i}-${key++}`}>{line.substring(lastIndex)}</React.Fragment>);
      }
      if (parts.length === 0) {
        parts.push(<React.Fragment key={`l-${i}`}>{line}</React.Fragment>);
      }
      return (
        <React.Fragment key={i}>
          <span className={lineClass}>{parts}</span>
          {i < lines.length - 1 && <br />}
        </React.Fragment>
      );
    });
  };

  // ✅ تجميع الموديلات حسب المزود للقائمة
  const groupedModels = useMemo(() => {
    const groups: { [key: string]: { label: string; models: AIModel[] } } = {
      gemini: { label: '🟡 Google Gemini (مجاني - دقيق)', models: [] },
      groq: { label: '⚡ Groq (مجاني - الأسرع)', models: [] },
      openrouter: { label: '🌐 OpenRouter (متعدد)', models: [] },
    };

    AI_MODELS.forEach(m => {
      if (m.provider === 'gemini') groups.gemini.models.push(m);
      else if (m.provider === 'groq') groups.groq.models.push(m);
      else groups.openrouter.models.push(m);
    });

    return Object.values(groups).filter(g => g.models.length > 0);
  }, []);

  return (
    <>
      {/* ✅ زر فتح الشات */}
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

      {/* ✅ نافذة الشات */}
      {isOpen && (
        <div className="fixed bottom-6 right-6 w-[450px] max-w-[calc(100vw-3rem)] h-[700px] max-h-[calc(100vh-3rem)] bg-white rounded-2xl shadow-2xl flex flex-col z-50 border-2 border-amber-200 overflow-hidden">
          
          {/* ✅ Header */}
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

            {/* ✅ زر اختيار الموديل */}
            <div className="relative mt-2" ref={modelSelectorRef}>
              <button
                onClick={() => setShowModelSelector(!showModelSelector)}
                className="w-full flex items-center justify-between bg-white bg-opacity-15 hover:bg-opacity-25 rounded-lg px-3 py-1.5 text-xs transition"
              >
                <span className="flex items-center gap-1.5">
                  <span>🤖</span>
                  <span>
                    {selectedModelId === 'auto'
                      ? `تلقائي (${activeModel.name})`
                      : activeModel.name}
                  </span>
                </span>
                <span className={`transition-transform ${showModelSelector ? 'rotate-180' : ''}`}>▼</span>
              </button>

              {/* ✅ قائمة الموديلات */}
              {showModelSelector && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white rounded-xl shadow-2xl border border-gray-200 max-h-[350px] overflow-y-auto z-[60]">
                  
                  {/* خيار تلقائي */}
                  <button
                    onClick={() => { setSelectedModelId('auto'); setShowModelSelector(false); }}
                    className={`w-full text-right px-3 py-2.5 text-sm flex items-center gap-2 transition border-b border-gray-100
                      ${selectedModelId === 'auto' ? 'bg-orange-50 text-orange-700 font-bold' : 'text-gray-700 hover:bg-gray-50'}`}
                  >
                    <span className="text-base">🔄</span>
                    <div className="flex-1">
                      <span className="block font-semibold">تلقائي</span>
                      <span className="block text-[10px] text-gray-400">يختار أفضل موديل متاح</span>
                    </div>
                    {selectedModelId === 'auto' && <span className="text-green-500">✓</span>}
                  </button>

                  {/* مجموعات الموديلات */}
                  {groupedModels.map((group, gi) => (
                    <div key={gi}>
                      <div className="px-3 py-1.5 bg-gray-50 text-[11px] font-bold text-gray-500 sticky top-0">
                        {group.label}
                      </div>
                      {group.models.map(m => {
                        const isFailed = failedModels.has(m.id);
                        const isSelected = selectedModelId === m.id;
                        const isAvailable = 
                          m.provider === 'gemini' ? !!GEMINI_API_KEY :
                          m.provider === 'groq' ? !!GROQ_API_KEY :
                          !!OPENROUTER_API_KEY;

                        return (
                          <button
                            key={m.id}
                            onClick={() => {
                              if (isAvailable) {
                                setSelectedModelId(m.id);
                                setShowModelSelector(false);
                              }
                            }}
                            disabled={!isAvailable}
                            className={`w-full text-right px-3 py-2 text-sm flex items-center gap-2 transition
                              ${isSelected ? 'bg-orange-50 text-orange-700 font-bold' : ''}
                              ${isFailed ? 'bg-red-50 text-red-400' : ''}
                              ${!isAvailable ? 'opacity-40 cursor-not-allowed' : 'hover:bg-gray-50'}
                              ${!isSelected && !isFailed && isAvailable ? 'text-gray-700' : ''}`}
                          >
                            <span className="text-sm">{m.emoji}</span>
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

          {/* ✅ الرسائل */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gradient-to-b from-orange-50 via-white to-pink-50">
            {messages.map(msg => (
              <div key={msg.id} className={`flex ${msg.type === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[90%] rounded-2xl p-3 shadow-sm ${
                  msg.type === 'user'
                    ? 'bg-gradient-to-br from-amber-500 to-orange-600 text-white rounded-br-sm'
                    : 'bg-white text-gray-800 border border-orange-100 rounded-bl-sm'
                }`}>
                  {msg.type === 'bot' && (
                    <div className="flex items-center gap-1 mb-1.5 text-[10px] text-orange-600 font-semibold">
                      <span>✨</span>
                      <span>المساعد الذكي</span>
                    </div>
                  )}
                  <div className="text-sm leading-relaxed whitespace-pre-wrap break-words">
                    {formatMessage(msg.content)}
                  </div>
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
                    <span className="text-xs text-gray-500">
                      {activeModel.emoji} {activeModel.name} يفكر...
                    </span>
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* ✅ خطأ */}
          {error && (
            <div className="px-3 py-2 bg-red-50 border-t border-red-200">
              <p className="text-xs text-red-700">❌ {error}</p>
            </div>
          )}

          {/* ✅ حقل الإدخال */}
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