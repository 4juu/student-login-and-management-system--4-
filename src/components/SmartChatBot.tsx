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

// ✅ خليه بالـ env
const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY as string;

// ✅ موديلات مستقرة
const GEMINI_MODELS = [
  'gemini-flash-latest',
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-2.5-pro',
  'gemini-pro-latest',
  'gemini-2.0-flash-lite',
];

const getGeminiUrl = (model: string) =>
  `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const pad2 = (n: number) => String(n).padStart(2, '0');

// ✅ توحيد التاريخ حتى ما يصير اختلاف بين 2026-05-13 و ISO
const normalizeDateKey = (value?: string | Date | null): string => {
  if (!value) return '';

  if (value instanceof Date) {
    return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(
      value.getDate()
    )}`;
  }

  const text = String(value).trim();
  if (!text) return '';

  // إذا النص بدايته YYYY-MM-DD
  const directMatch = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (directMatch) return directMatch[1];

  // إذا بصيغة YYYY/MM/DD
  const slashMatch = text.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
  if (slashMatch) {
    return `${slashMatch[1]}-${slashMatch[2]}-${slashMatch[3]}`;
  }

  // fallback parsing
  const d = new Date(text);
  if (isNaN(d.getTime())) return text;

  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};

const formatDateWithDay = (value?: string | Date | null): string => {
  const key = normalizeDateKey(value);
  if (!key) return '-';

  const days = [
    'الأحد',
    'الإثنين',
    'الثلاثاء',
    'الأربعاء',
    'الخميس',
    'الجمعة',
    'السبت',
  ];

  const months = [
    'يناير',
    'فبراير',
    'مارس',
    'أبريل',
    'مايو',
    'يونيو',
    'يوليو',
    'أغسطس',
    'سبتمبر',
    'أكتوبر',
    'نوفمبر',
    'ديسمبر',
  ];

  // نستخدم 12:00 حتى نتفادى مشاكل timezone
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
    case 400:
      return `طلب غير صحيح: ${msg}`;
    case 401:
      return 'API Key غير صحيحة';
    case 403:
      return 'API Key ما عندها صلاحية';
    case 404:
      return 'الموديل غير موجود';
    case 429:
      return 'تم تجاوز الحد المسموح';
    case 500:
      return 'خطأ داخلي من السيرفر';
    case 503:
      return 'الخدمة مزدحمة حالياً';
    default:
      return `خطأ ${status}: ${msg}`;
  }
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

  const STORAGE_KEY = `smart_chatbot_${user.uid}`;

  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>(() => {
    try {
      if (typeof window === 'undefined') return [];
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return [];

      const parsed = JSON.parse(saved) as Array<
        Omit<Message, 'timestamp'> & { timestamp: string }
      >;

      return parsed.map(m => ({
        ...m,
        timestamp: new Date(m.timestamp),
      }));
    } catch {
      return [];
    }
  });

  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentModelIndex, setCurrentModelIndex] = useState(0);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const lastRequestTime = useRef<number>(0);

  useEffect(() => {
    try {
      if (messages.length > 0) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-30)));
      }
    } catch {}
  }, [messages, STORAGE_KEY]);

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
    const accessibleColleges = colleges.filter(
      c => !!allowedStagesMap[c.id] && allowedStagesMap[c.id].length > 0
    );
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
      setMessages([
        {
          id: Date.now().toString(),
          type: 'bot',
          content: `أهلاً ${user.displayName} ✨\n\nبشنو أكدر أساعدك اليوم؟`,
          timestamp: new Date(),
        },
      ]);
    }
  }, [isOpen, messages.length, user.displayName]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [isOpen]);

  // ✅ بناء السياق بطريقة قوية
  const buildDataContext = useCallback((): string => {
    const now = new Date();
    const todayDate = normalizeDateKey(now);

    const sortedSessions = [...sessions].sort((a, b) => {
      const da = normalizeDateKey((a as any).date);
      const db = normalizeDateKey((b as any).date);
      if (da !== db) return da.localeCompare(db);
      return String(a.name || '').localeCompare(String(b.name || ''), 'ar');
    });

    const sessionById = new Map(sortedSessions.map(s => [s.id, s]));
    const studentById = new Map(students.map(s => [s.id, s]));

    // ✅ دعم أكثر من جلسة بنفس اليوم + حل مشكلة اختلاف صيغة التاريخ
    const todaySessions = sortedSessions.filter(
      s => normalizeDateKey((s as any).date) === todayDate
    );
    const todaySessionIds = new Set(todaySessions.map(s => s.id));

    const todayRecordsRaw = records.filter(r => todaySessionIds.has(r.sessionId));

    // نضمن عدم تكرار الطالب إذا حضر أكثر من جلسة بنفس اليوم
    const todayPresentMap = new Map<string, AttendanceRecord>();
    todayRecordsRaw.forEach(r => {
      if (!todayPresentMap.has(r.studentId)) {
        todayPresentMap.set(r.studentId, r);
      }
    });

    const todayPresentStudents = students.filter(s => todayPresentMap.has(s.id));
    const todayAbsentStudents = students.filter(s => !todayPresentMap.has(s.id));

    const groups = Array.from(
      new Set(students.map(s => s.group).filter(Boolean))
    ) as string[];
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
      context += `## 🌟 ملخص حضور اليوم:\n\n`;

      if (todaySessions.length > 0 || todayRecordsRaw.length > 0) {
        const todaySessionNames =
          todaySessions.length > 0
            ? todaySessions.map(s => s.name).join('، ')
            : 'جلسة اليوم';

        const todayRate =
          students.length > 0
            ? ((todayPresentStudents.length / students.length) * 100).toFixed(1)
            : '0';

        context += `- الجلسات اليوم: ${todaySessionNames}\n`;
        context += `- عدد الجلسات اليوم: ${todaySessions.length}\n`;
        context += `- الحاضرين اليوم: ${todayPresentStudents.length}/${students.length}\n`;
        context += `- الغائبين اليوم: ${todayAbsentStudents.length}\n`;
        context += `- نسبة الحضور اليوم: ${todayRate}%\n\n`;

        if (todayPresentStudents.length > 0) {
          context += `### ✅ الحاضرين اليوم:\n`;
          todayPresentStudents.forEach(student => {
            const rec = todayPresentMap.get(student.id);
            context += `- ✅ **${student.name}** | كود: ${student.code} | كروب: ${
              student.group || rec?.studentGroup || '-'
            }\n`;
          });
          context += `\n`;
        }

        if (todayAbsentStudents.length > 0) {
          context += `### ❌ الغائبين اليوم:\n`;
          todayAbsentStudents.forEach(student => {
            context += `- ❌ **${student.name}** | كود: ${student.code} | كروب: ${
              student.group || '-'
            }\n`;
          });
          context += `\n`;
        }

        if (todaySessions.length > 0) {
          context += `### 📅 تفاصيل جلسات اليوم:\n`;
          todaySessions.forEach(session => {
            const sessionRecords = records.filter(r => r.sessionId === session.id);
            const sessionPresentIds = new Set(sessionRecords.map(r => r.studentId));
            const sessionAbsent = students.filter(s => !sessionPresentIds.has(s.id));

            context += `- **${session.name}** | ${formatDateWithDay((session as any).date)}\n`;
            context += `  - حاضر: ${sessionRecords.length}/${students.length}\n`;
            context += `  - غائب: ${sessionAbsent.length}\n`;
          });
          context += `\n`;
        }
      } else {
        context += `- ⚠️ لا توجد جلسة اليوم\n`;
        context += `- تاريخ اليوم: ${todayDate}\n\n`;
      }

      context += `## 📅 جميع الجلسات (${sortedSessions.length}):\n`;
      sortedSessions.forEach((session, index) => {
        const presentCount = records.filter(r => r.sessionId === session.id).length;
        const isToday = normalizeDateKey((session as any).date) === todayDate ? ' 🌟' : '';
        context += `${index + 1}. **${session.name}** | ${formatDateWithDay(
          (session as any).date
        )} | ${presentCount}/${students.length}${isToday}\n`;
      });
      context += `\n`;

      context += `## 👥 تفاصيل الطلاب:\n\n`;

      const sortedStudents = [...students].sort((a, b) => {
        const ga = a.group || 'ZZZ';
        const gb = b.group || 'ZZZ';
        if (ga !== gb) return ga.localeCompare(gb, 'ar');
        return a.name.localeCompare(b.name, 'ar');
      });

      sortedStudents.forEach(student => {
        const studentRecords = records.filter(r => r.studentId === student.id);
        const attendedSessionIds = new Set(studentRecords.map(r => r.sessionId));
        const attendedCount = sortedSessions.filter(s =>
          attendedSessionIds.has(s.id)
        ).length;
        const absentCount = sortedSessions.length - attendedCount;
        const percentage =
          sortedSessions.length > 0
            ? ((attendedCount / sortedSessions.length) * 100).toFixed(1)
            : '0';

        context += `### 👤 **${student.name}**\n`;
        context += `- الكود: ${student.code}\n`;
        context += `- الكروب: ${student.group || '-'}\n`;
        context += `- الحضور: ${attendedCount}\n`;
        context += `- الغياب: ${absentCount}\n`;
        context += `- النسبة: ${percentage}%\n`;
        context += `- سجل الحضور الكامل:\n`;

        sortedSessions.forEach(session => {
          const isPresent = attendedSessionIds.has(session.id);
          const icon = isPresent ? '✅' : '❌';
          const status = isPresent ? 'حاضر' : 'غائب';
          const isToday = normalizeDateKey((session as any).date) === todayDate ? ' 🌟' : '';
          context += `  - ${icon} ${formatDateWithDay((session as any).date)} | ${
            session.name
          } | ${status}${isToday}\n`;
        });

        context += `\n`;
      });

      if (groups.length > 0) {
        context += `## 📊 إحصائيات الكروبات:\n`;
        groups.forEach(group => {
          const groupStudents = students.filter(s => s.group === group);
          const groupStudentIds = new Set(groupStudents.map(s => s.id));
          const groupRecords = records.filter(r => groupStudentIds.has(r.studentId));
          const possible = groupStudents.length * sortedSessions.length;
          const groupPercentage =
            possible > 0 ? ((groupRecords.length / possible) * 100).toFixed(1) : '0';

          context += `- **${group}**: ${groupStudents.length} طالب | نسبة حضور ${groupPercentage}%\n`;
        });
        context += `\n`;
      }

      const totalPossible = students.length * sortedSessions.length;
      const overallRate =
        totalPossible > 0 ? ((records.length / totalPossible) * 100).toFixed(2) : '0';

      context += `## 📈 الإحصائيات العامة:\n`;
      context += `- عدد الطلاب: ${students.length}\n`;
      context += `- عدد الجلسات: ${sortedSessions.length}\n`;
      context += `- مجموع سجلات الحضور: ${records.length}\n`;
      context += `- نسبة الحضور العامة: ${overallRate}%\n\n`;
    } else {
      context += `## ⚠️ لا توجد مرحلة مختارة حالياً\n`;
      context += `### الكليات والمراحل المتاحة:\n`;

      accessibleData.accessibleColleges.forEach(college => {
        const collegeStages = accessibleData.accessibleStages.filter(
          stage => stage.collegeId === college.id
        );
        context += `- ${college.name}: ${collegeStages.map(s => s.name).join('، ')}\n`;
      });

      context += `\n`;
    }

    // ✅ للأدمن: ملخص سريع للمراحل إذا ماكو مرحلة محددة
    if (isAdmin && !currentStageId && Object.keys(accessibleData.stagesMap).length > 0) {
      context += `## 🏛️ ملخص المراحل المتاحة للأدمن:\n`;
      Object.entries(accessibleData.stagesMap).forEach(([stageId, stageData]) => {
        const totalPossible = stageData.students.length * stageData.sessions.length;
        const rate =
          totalPossible > 0
            ? ((stageData.records.length / totalPossible) * 100).toFixed(1)
            : '0';

        context += `- **${stageData.collegeName} / ${stageData.stageName}**: `;
        context += `${stageData.students.length} طالب | ${stageData.sessions.length} جلسة | ${rate}%\n`;
      });
      context += `\n`;
    }

    return context;
  }, [
    sessions,
    records,
    students,
    user.displayName,
    isAdmin,
    currentCollege,
    currentStage,
    currentStageId,
    accessibleData,
  ]);

const callGeminiAPI = useCallback(
  async (userMessage: string, conversationHistory: Message[]): Promise<string> => {
    if (!GEMINI_API_KEY) {
      return `⚠️ لازم تضيف Gemini API Key بالـ .env\n\nمثال:\nVITE_GEMINI_API_KEY=YOUR_KEY`;
    }

    const dataContext = buildDataContext();

    const systemInstruction = `أنت مساعد ذكي متخصص فقط بنظام حضور الطلاب.

## قواعد مهمة جداً:

1) استخدم فقط البيانات المرفقة، ولا تخمّن.
2) عند السؤال عن "حضور اليوم" أو "منو حضر اليوم":
   - اعتمد أولاً على قسم "🌟 ملخص حضور اليوم"
   - إذا يوجد طلاب حاضرين اليوم، لا تقل "لا توجد جلسة اليوم"
   - اذكر:
     - اسم الطالب الكامل
     - الكود
     - الكروب
   - استخدم ✅ للحاضر و ❌ للغائب

3) عند السؤال عن طالب معيّن:
   - اعرض معلوماته كاملة:
     - الاسم
     - الكود
     - الكروب
     - عدد الحضور
     - عدد الغياب
     - النسبة
   - ثم اعرض سجل حضوره الكامل لكل الجلسات مع:
     - اليوم والتاريخ
     - اسم الجلسة
     - ✅ حاضر أو ❌ غائب
     - وإذا كانت جلسة اليوم ضيف 🌟

4) إذا كان بالسياق أكثر من جلسة بنفس اليوم:
   - اعتبرها كلها "جلسات اليوم"
   - وإذا الطالب حضر بأي جلسة اليوم، ممكن تذكره ضمن الحاضرين اليوم

5) أسلوب الجواب:
   - بالعربية العراقية
   - مرتب وواضح
   - استخدم emojis مثل: 📅 👥 📊 📈 🌟
   - استخدم **bold** للأسماء والعناوين المهمة

## البيانات:
${dataContext}`;

    // ✅ نبني المحادثة - نضيف system كأول رسالة من user مع رد من model
    const contents: any[] = [
      {
        role: 'user',
        parts: [{ text: systemInstruction }],
      },
      {
        role: 'model',
        parts: [{ text: 'تمام، فهمت. أنا جاهز للإجابة على أسئلتك حول نظام حضور الطلاب باستخدام البيانات المرفقة فقط.' }],
      },
    ];

    // أضف تاريخ المحادثة
    conversationHistory.slice(-6).forEach(msg => {
      contents.push({
        role: msg.type === 'user' ? 'user' : 'model',
        parts: [{ text: msg.content }],
      });
    });

    // الرسالة الجديدة
    contents.push({
      role: 'user',
      parts: [{ text: userMessage }],
    });

    const requestBody = {
      contents,
      generationConfig: {
        temperature: 0.25,
        topK: 40,
        topP: 0.95,
        maxOutputTokens: 4096,
      },
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
      ],
    };

    let lastError = '';

    for (let i = currentModelIndex; i < GEMINI_MODELS.length; i++) {
      const model = GEMINI_MODELS[i];

      try {
        const response = await fetch(getGeminiUrl(model), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          const errMsg = getErrorMessage(response.status, errorData);
          lastError = errMsg;

          console.warn(`⚠️ ${model}: ${errMsg}`);

          if (response.status === 401 || response.status === 403) {
            return `🔑 مشكلة بالـ API Key\n\n${errMsg}`;
          }

          if (response.status === 404) {
            continue;
          }

          if (response.status === 429 || response.status === 503) {
            if (i < GEMINI_MODELS.length - 1) {
              await sleep(1200);
              continue;
            }
            return `⏱️ الخدمة مزدحمة حالياً، حاول بعد شوي`;
          }

          if (i < GEMINI_MODELS.length - 1) {
            continue;
          }

          return `❌ ${errMsg}`;
        }

        const data = await response.json();
        const text = getGeminiText(data);

        if (!text) {
          const finishReason = data?.candidates?.[0]?.finishReason;
          if (finishReason === 'SAFETY') {
            return '⚠️ تم حجب الرد بسبب إعدادات الأمان';
          }

          if (i < GEMINI_MODELS.length - 1) {
            continue;
          }

          return '⚠️ ما وصل رد واضح من Gemini';
        }

        if (i !== currentModelIndex) {
          setCurrentModelIndex(i);
          console.log(`✅ تبديل للموديل: ${model}`);
        }

        return text;
      } catch (err: any) {
        lastError = err?.message || 'خطأ غير معروف';
        console.error(`❌ ${model}:`, lastError);

        if (i < GEMINI_MODELS.length - 1) {
          await sleep(500);
          continue;
        }
      }
    }

    return `🌐 فشلت جميع المحاولات\n\nآخر خطأ: ${lastError || 'غير معروف'}`;
  },
  [buildDataContext, currentModelIndex]
);

  const sendMessage = useCallback(
    async (text: string) => {
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
      if (inputRef.current) {
        inputRef.current.style.height = '40px';
      }
      setIsTyping(true);

      try {
        const response = await callGeminiAPI(text.trim(), messages);

        setMessages(prev => [
          ...prev,
          {
            id: `${Date.now()}_bot`,
            type: 'bot',
            content: response,
            timestamp: new Date(),
          },
        ]);
      } catch (err: any) {
        setError(err?.message || 'حدث خطأ غير متوقع');
      } finally {
        setIsTyping(false);
      }
    },
    [messages, isTyping, callGeminiAPI]
  );

  const handleSend = useCallback(() => {
    sendMessage(input);
  }, [input, sendMessage]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleReset = useCallback(() => {
    if (window.confirm('متأكد من مسح المحادثة؟')) {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {}
      setMessages([]);
      setError(null);
      setCurrentModelIndex(0);
    }
  }, [STORAGE_KEY]);

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
          parts.push(
            <React.Fragment key={`t-${i}-${key++}`}>
              {line.substring(lastIndex, match.index)}
            </React.Fragment>
          );
        }

        let boldClass = 'font-bold text-gray-900';
        if (lineHasCheck) boldClass = 'font-bold text-green-800';
        if (lineHasCross) boldClass = 'font-bold text-red-800';

        parts.push(
          <strong key={`b-${i}-${key++}`} className={boldClass}>
            {match[1]}
          </strong>
        );

        lastIndex = match.index + match[0].length;
      }

      if (lastIndex < line.length) {
        parts.push(
          <React.Fragment key={`e-${i}-${key++}`}>
            {line.substring(lastIndex)}
          </React.Fragment>
        );
      }

      if (parts.length === 0) {
        parts.push(
          <React.Fragment key={`l-${i}`}>{line}</React.Fragment>
        );
      }

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
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-6 right-6 w-16 h-16 bg-gradient-to-br from-amber-500 via-orange-500 to-pink-600 hover:from-amber-600 hover:via-orange-600 hover:to-pink-700 text-white rounded-full shadow-2xl flex items-center justify-center transition-all hover:scale-110 z-50 group"
          title="المساعد الذكي"
        >
          <span className="text-3xl group-hover:rotate-12 transition-transform">✨</span>
          <span className="absolute -top-2 -left-2 bg-gradient-to-r from-yellow-400 to-orange-500 text-white text-[10px] px-2 py-0.5 rounded-full font-bold shadow-lg animate-pulse">
            AI
          </span>
        </button>
      )}

      {isOpen && (
        <div className="fixed bottom-6 right-6 w-[450px] max-w-[calc(100vw-3rem)] h-[680px] max-h-[calc(100vh-3rem)] bg-white rounded-2xl shadow-2xl flex flex-col z-50 border-2 border-amber-200 overflow-hidden">
          <div className="bg-gradient-to-r from-amber-500 via-orange-500 to-pink-600 text-white p-4 flex justify-between items-center">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-white bg-opacity-20 rounded-full flex items-center justify-center text-2xl shadow-lg border border-white border-opacity-30">
                ✨
              </div>

              <div>
                <h3 className="font-bold flex items-center gap-2">
                  المساعد الذكي
                  <span className="text-[10px] bg-white text-orange-600 px-2 py-0.5 rounded-full font-bold">
                    AI
                  </span>
                </h3>
                <p className="text-xs opacity-95 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 bg-green-300 rounded-full animate-pulse"></span>
                  {GEMINI_MODELS[currentModelIndex]?.replace('gemini-', '')}
                  {currentStage && ` • ${currentStage.name}`}
                </p>
              </div>
            </div>

            <div className="flex gap-1 items-center">
              <button
                onClick={handleReset}
                className="text-white hover:bg-white hover:bg-opacity-20 rounded-lg p-2 transition"
                title="محادثة جديدة"
              >
                🔄
              </button>
              <button
                onClick={() => setIsOpen(false)}
                className="text-white hover:bg-white hover:bg-opacity-20 rounded-lg p-2 transition text-xl leading-none w-8 h-8 flex items-center justify-center"
              >
                ×
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gradient-to-b from-orange-50 via-white to-pink-50">
            {messages.map(msg => (
              <div
                key={msg.id}
                className={`flex ${msg.type === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[90%] rounded-2xl p-3 shadow-sm ${
                    msg.type === 'user'
                      ? 'bg-gradient-to-br from-amber-500 to-orange-600 text-white rounded-br-sm'
                      : 'bg-white text-gray-800 border border-orange-100 rounded-bl-sm'
                  }`}
                >
                  {msg.type === 'bot' && (
                    <div className="flex items-center gap-1 mb-1.5 text-[10px] text-orange-600 font-semibold">
                      <span>✨</span>
                      <span>المساعد الذكي</span>
                    </div>
                  )}

                  <div className="text-sm leading-relaxed whitespace-pre-wrap break-words">
                    {formatMessage(msg.content)}
                  </div>

                  <p
                    className={`text-[10px] mt-1.5 ${
                      msg.type === 'user' ? 'text-orange-100' : 'text-gray-400'
                    }`}
                  >
                    {msg.timestamp.toLocaleTimeString('ar-EG', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                </div>
              </div>
            ))}

            {isTyping && (
              <div className="flex justify-start">
                <div className="bg-white border border-orange-100 rounded-2xl rounded-bl-sm p-3 shadow-sm">
                  <div className="flex items-center gap-2">
                    <div className="flex gap-1">
                      <span
                        className="w-2 h-2 bg-amber-500 rounded-full animate-bounce"
                        style={{ animationDelay: '0ms' }}
                      />
                      <span
                        className="w-2 h-2 bg-orange-500 rounded-full animate-bounce"
                        style={{ animationDelay: '150ms' }}
                      />
                      <span
                        className="w-2 h-2 bg-pink-500 rounded-full animate-bounce"
                        style={{ animationDelay: '300ms' }}
                      />
                    </div>
                    <span className="text-xs text-gray-500">يفكر...</span>
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
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                    />
                  </svg>
                ) : (
                  <svg
                    className="w-5 h-5 transform -scale-x-100"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                    />
                  </svg>
                )}
              </button>
            </div>

            <p className="text-[10px] text-gray-400 mt-1.5 text-center">
              مدعوم بـ <span className="text-orange-600 font-semibold">Google Gemini</span> ✨
            </p>
          </div>
        </div>
      )}
    </>
  );
};