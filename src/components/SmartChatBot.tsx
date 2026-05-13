import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Student, AttendanceRecord, AttendanceSession, College, Stage } from '../types/student';
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

// 🔑 Gemini API Configuration
// ⚠️ بدّل XXXX بمفتاحك من: https://aistudio.google.com/apikey
const GEMINI_API_KEY = '';
const GEMINI_MODEL = 'gemini-2.5-flash-lite';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

export const SmartChatBot: React.FC<SmartChatBotProps> = ({
  user,
  colleges,
  stages,
  currentCollegeId,
  currentStageId,
  students,
  records,
  sessions,
  activeSessionId,
  allTeachers = [],
  allStagesData = {},
}) => {
  const isAdmin = user.role === 'admin';
  const currentCollege = colleges.find(c => c.id === currentCollegeId);
  const currentStage = stages.find(s => s.id === currentStageId);

  const STORAGE_KEY = `smart_chatbot_${user.uid}`;

  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        return parsed.map((m: Message) => ({ ...m, timestamp: new Date(m.timestamp) }));
      }
    } catch {}
    return [];
  });
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const lastRequestTime = useRef<number>(0);

  useEffect(() => {
    if (messages.length > 0) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-30)));
      } catch {}
    }
  }, [messages, STORAGE_KEY]);

  // 🔐 تحديد البيانات المتاحة حسب الصلاحيات
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

    // 🔒 التدريسي يشوف بس المراحل المسموحة له
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

  // 🎬 رسالة الترحيب البسيطة
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
  }, [isOpen]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [isOpen]);

  // 📦 بناء سياق البيانات للـ AI
  const buildDataContext = useCallback((): string => {
    const { accessibleColleges, accessibleStages, allStudents, allRecords, allSessions } = accessibleData;

    let context = `# قاعدة بيانات نظام الحضور\n\n`;

    context += `## معلومات المستخدم الحالي:\n`;
    context += `- الاسم: ${user.displayName}\n`;
    context += `- الدور: ${isAdmin ? 'أدمن (يشوف كل البيانات)' : 'تدريسي (يشوف بياناته فقط)'}\n\n`;

    const now = new Date();
    context += `## التاريخ الحالي: ${now.toLocaleDateString('ar-EG', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })}\n\n`;

    if (currentCollege && currentStage) {
      context += `## الموقع الحالي: ${currentCollege.name} > ${currentStage.name}\n\n`;
    }

    if (currentStageId && students.length > 0) {
      context += `## 📍 بيانات المرحلة الحالية بالتفصيل\n\n`;

      // الجلسات
      context += `### 📅 الجلسات (${sessions.length}):\n`;
      const sortedSessions = [...sessions].sort((a, b) => a.date.localeCompare(b.date));
      sortedSessions.forEach((s, i) => {
        const presentCount = records.filter(r => r.sessionId === s.id).length;
        context += `${i + 1}. **${s.name}** | التاريخ: ${s.date} | الحاضرين: ${presentCount}/${students.length}\n`;
      });
      context += `\n`;

      // الكروبات
      const groups = Array.from(new Set(students.map(s => s.group).filter(Boolean))) as string[];
      groups.sort();

      // 👥 جدول كامل لكل طالب وحضوره في كل جلسة
      context += `### 👥 جدول الحضور التفصيلي (كل طالب وحضوره في كل جلسة):\n\n`;
      context += `| الكود | الاسم | الكروب | `;
      sortedSessions.forEach(s => {
        context += `${s.name} | `;
      });
      context += `حضر | غاب | النسبة |\n`;

      const sortedStudents = [...students].sort((a, b) => {
        const ga = a.group || 'ZZZ';
        const gb = b.group || 'ZZZ';
        if (ga !== gb) return ga.localeCompare(gb);
        return a.name.localeCompare(b.name, 'ar');
      });

      sortedStudents.forEach(student => {
        const studentRecords = records.filter(r => r.studentId === student.id);
        const attendedSessionIds = new Set(studentRecords.map(r => r.sessionId));
        const attended = attendedSessionIds.size;
        const absent = sessions.length - attended;
        const percentage = sessions.length > 0 ? ((attended / sessions.length) * 100).toFixed(1) : '0';

        context += `| ${student.code} | ${student.name} | ${student.group || '-'} | `;
        sortedSessions.forEach(s => {
          context += attendedSessionIds.has(s.id) ? '✅ | ' : '❌ | ';
        });
        context += `${attended} | ${absent} | ${percentage}% |\n`;
      });
      context += `\n`;

      // 📊 إحصائيات كل كروب
      if (groups.length > 0) {
        context += `### 📊 إحصائيات الكروبات:\n\n`;
        groups.forEach(g => {
          const gStudents = students.filter(s => s.group === g);
          const gRecords = records.filter(r => r.studentGroup === g);
          const gPossible = gStudents.length * sessions.length;
          const gPct = gPossible > 0 ? ((gRecords.length / gPossible) * 100).toFixed(1) : '0';
          context += `**كروب ${g}:**\n`;
          context += `- عدد الطلاب: ${gStudents.length}\n`;
          context += `- مجموع الحضور: ${gRecords.length}\n`;
          context += `- مجموع الغياب: ${gPossible - gRecords.length}\n`;
          context += `- النسبة المئوية: ${gPct}%\n\n`;
        });
      }

      // 📈 إحصائيات كل جلسة
      context += `### 📈 إحصائيات كل جلسة:\n\n`;
      sortedSessions.forEach(session => {
        const sessionRecords = records.filter(r => r.sessionId === session.id);
        const presentIds = new Set(sessionRecords.map(r => r.studentId));
        const absentStudents = students.filter(s => !presentIds.has(s.id));

        context += `**${session.name}** (${session.date}):\n`;
        context += `- الحاضرين: ${sessionRecords.length}/${students.length} (${
          students.length > 0 ? ((sessionRecords.length / students.length) * 100).toFixed(1) : 0
        }%)\n`;
        context += `- الغائبين: ${absentStudents.length}\n`;

        if (groups.length > 0) {
          groups.forEach(g => {
            const gStudents = students.filter(s => s.group === g);
            const gPresent = gStudents.filter(s => presentIds.has(s.id));
            const gAbsent = gStudents.filter(s => !presentIds.has(s.id));
            context += `  - كروب ${g}: حضر ${gPresent.length}/${gStudents.length} | غاب ${gAbsent.length}\n`;
            if (gPresent.length > 0) {
              context += `    ✅ الحاضرين: ${gPresent.map(s => `${s.name} (${s.code})`).join(', ')}\n`;
            }
            if (gAbsent.length > 0) {
              context += `    ❌ الغائبين: ${gAbsent.map(s => `${s.name} (${s.code})`).join(', ')}\n`;
            }
          });
        }
        context += `\n`;
      });

      // 📊 الإحصائيات العامة
      const totalPossible = students.length * sessions.length;
      const overallRate = totalPossible > 0 ? ((records.length / totalPossible) * 100).toFixed(2) : '0';
      const totalAbsence = totalPossible - records.length;

      context += `### 📊 الإحصائيات العامة للمرحلة:\n`;
      context += `- إجمالي الطلاب: ${students.length}\n`;
      context += `- إجمالي الجلسات: ${sessions.length}\n`;
      context += `- مجموع الحضور الكلي: ${records.length}\n`;
      context += `- مجموع الغياب الكلي: ${totalAbsence}\n`;
      context += `- نسبة الحضور العامة: ${overallRate}%\n`;
      context += `- نسبة الغياب العامة: ${(100 - parseFloat(overallRate)).toFixed(2)}%\n\n`;
    } else if (!currentStageId) {
      context += `## ⚠️ المستخدم لم يختر مرحلة بعد\n`;
      context += `الكليات والمراحل المتاحة:\n`;
      accessibleColleges.forEach(c => {
        const cStages = accessibleStages.filter(s => s.collegeId === c.id);
        context += `- ${c.name}: ${cStages.map(s => s.name).join(', ')}\n`;
      });
      context += `\n`;
    }

    if (isAdmin && Object.keys(accessibleData.stagesMap).length > 0) {
      context += `## 🌐 ملخص جميع المراحل (للأدمن):\n\n`;
      Object.entries(accessibleData.stagesMap).forEach(([_stageId, data]) => {
        const total = data.students.length * data.sessions.length;
        const pct = total > 0 ? ((data.records.length / total) * 100).toFixed(1) : '0';
        context += `- ${data.collegeName} > ${data.stageName}: ${data.students.length} طالب | ${data.sessions.length} جلسة | حضور ${pct}%\n`;
      });
      context += `\n`;

      if (allTeachers.length > 0) {
        context += `## 👨‍🏫 التدريسيين (${allTeachers.length}):\n`;
        allTeachers.forEach(t => {
          const allowedCount = Object.values(t.permissions?.allowedStages || {}).flat().length;
          context += `- ${t.displayName} (${t.email}) | ${allowedCount} مرحلة\n`;
        });
      }
    }

    return context;
  }, [accessibleData, user, isAdmin, currentCollege, currentStage, currentStageId, students, records, sessions, allTeachers]);

  // 🤖 استدعاء Gemini API
  const callGeminiAPI = useCallback(
    async (userMessage: string, conversationHistory: Message[]): Promise<string> => {
      if (!GEMINI_API_KEY || GEMINI_API_KEY.includes('XXXX')) {
        return '⚠️ **خطأ في الإعداد**\n\nلازم تضيف Gemini API Key في ملف SmartChatBot.tsx\n\nاحصل على المفتاح من:\nhttps://aistudio.google.com/apikey';
      }

      const dataContext = buildDataContext();

      const systemInstruction = `أنت مساعد ذكي لنظام إدارة حضور الطلاب. اسمك "المساعد الذكي".

## ⚠️ قواعد صارمة جداً - يجب الالتزام بها 100%:

### 1. استخدم البيانات المرفقة فقط
- لا تخترع أي بيانات أو أسماء أو أرقام
- كل البيانات اللي تحتاجها موجودة في القسم اللي بالأسفل
- لو ما لكيت معلومة، قول "ما عندي هذي المعلومة بالبيانات"

### 2. الصلاحيات
- المستخدم الحالي: ${user.displayName}
- الدور: ${isAdmin ? 'أدمن - يكدر يشوف كل البيانات' : 'تدريسي - يشوف بس البيانات المرفقة له'}
- ${!isAdmin ? '⚠️ لا تذكر أبداً بيانات من مراحل أخرى غير الموجودة بالسياق' : ''}

### 3. تنسيق الإجابات (مهم جداً!)

**عند عرض الطلاب الحاضرين والغائبين:**
استخدم هذا التنسيق بالضبط:

للحاضر:
✅ **اسم الطالب** | كود: 1234 | كروب: A1

للغائب:
❌ **اسم الطالب** | كود: 5678 | كروب: B2

أو بشكل قائمة مرقمة:

1. ✅ **اسم الطالب** - كود: 1234 - كروب: A1 - النسبة: 100%
2. ❌ **اسم الطالب** - كود: 5678 - كروب: B2 - النسبة: 50%

**عند عرض الإحصائيات:**
📊 **الإحصائيات:**
- ✅ مجموع الحضور: **15 طالب**
- ❌ مجموع الغياب: **5 طلاب**
- 📈 النسبة المئوية: **75%**

### 4. المعلومات الإلزامية لكل طالب
عند ذكر أي طالب، يجب أن تذكر:
- ✅ أو ❌ (حسب الحالة)
- الاسم الكامل
- الكود
- الكروب
- النسبة المئوية (إذا مناسب)

### 5. عند طلب المجاميع
اذكر الرقم بشكل واضح وبارز:
- "مجموع الحضور: **25**
- "مجموع الحضور: **25**"
- "مجموع الغياب: **10**"
- "النسبة: **71.4%**"

### 6. عند طلب بيانات كروب معين
- اعرض كل طلاب الكروب
- مع علامة ✅ أو ❌ لكل واحد
- مع المجاميع والنسب
- قسّمهم لحاضرين وغائبين

### 7. الشخصية
- ودود ومحترف
- استخدم اللهجة العراقية أو الفصحى
- استخدم emojis: ✅ ❌ 📊 📈 📉 🎯 ⚠️ 🌟 👥 📅
- مختصر ومباشر بدون حشو

---

## 📦 البيانات المتاحة لك:

${dataContext}

---

الآن جاوب على سؤال المستخدم بدقة وحرفية تامة بناءً على هذه البيانات.`;

      const contents: any[] = [];
      const recentMessages = conversationHistory.slice(-6);
      recentMessages.forEach(msg => {
        contents.push({
          role: msg.type === 'user' ? 'user' : 'model',
          parts: [{ text: msg.content }],
        });
      });

      contents.push({
        role: 'user',
        parts: [{ text: userMessage }],
      });

      try {
        const response = await fetch(GEMINI_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents,
            systemInstruction: { parts: [{ text: systemInstruction }] },
            generationConfig: {
              temperature: 0.3,
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
          }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          if (response.status === 429) {
            return `⏱️ **تجاوزت الحد المسموح**\n\nانتظر دقيقة وحاول مرة ثانية.`;
          }
          if (response.status === 403) {
            return `🔒 **خطأ في الصلاحيات**\n\nتأكد من صحة API Key.`;
          }
          if (response.status === 400) {
            return `⚠️ **خطأ في الطلب**\n\n${errorData.error?.message || 'الطلب غير صحيح'}`;
          }
          return `❌ **خطأ من API**\nالكود: ${response.status}\n${errorData.error?.message || ''}`;
        }

        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) return '⚠️ ما حصلت على رد. حاول مرة ثانية.';
        return text;
      } catch (err: any) {
        return `🌐 **خطأ في الاتصال**\n${err.message || ''}`;
      }
    },
    [buildDataContext, user, isAdmin]
  );

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || isTyping) return;

      const now = Date.now();
      const timeSinceLastRequest = now - lastRequestTime.current;
      if (timeSinceLastRequest < 3000) {
        const waitTime = Math.ceil((3000 - timeSinceLastRequest) / 1000);
        setError(`⏱️ انتظر ${waitTime} ثانية`);
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
      setIsTyping(true);

      try {
        const response = await callGeminiAPI(text.trim(), messages);
        setMessages(prev => [
          ...prev,
          {
            id: (Date.now() + 1).toString(),
            type: 'bot',
            content: response,
            timestamp: new Date(),
          },
        ]);
      } catch (err: any) {
        setError(err.message || 'حدث خطأ');
      } finally {
        setIsTyping(false);
      }
    },
    [messages, isTyping, callGeminiAPI]
  );

  const handleSend = useCallback(() => sendMessage(input), [input, sendMessage]);

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
    }
  }, [STORAGE_KEY]);

  // 🎨 تنسيق الرسائل مع دعم الألوان
  const formatMessage = (content: string): React.ReactNode => {
    const lines = content.split('\n');
    return lines.map((line, i) => {
      // افحص إذا السطر فيه ✅ (حاضر) أو ❌ (غائب)
      const hasCheckmark = line.includes('✅');
      const hasCross = line.includes('❌');

      // معالجة الـ Bold
      const parts: React.ReactNode[] = [];
      const boldRegex = /\*\*(.+?)\*\*/g;
      let lastIndex = 0;
      let match;
      let key = 0;

      while ((match = boldRegex.exec(line)) !== null) {
        if (match.index > lastIndex) {
          parts.push(line.substring(lastIndex, match.index));
        }

        // اختر اللون حسب السياق
        let className = 'font-bold';
        if (hasCheckmark) {
          className = 'font-bold text-green-700';
        } else if (hasCross) {
          className = 'font-bold text-red-700';
        } else {
          className = 'font-bold text-gray-900';
        }

        parts.push(
          <strong key={`b-${i}-${key++}`} className={className}>
            {match[1]}
          </strong>
        );
        lastIndex = match.index + match[0].length;
      }
      if (lastIndex < line.length) {
        parts.push(line.substring(lastIndex));
      }
      if (parts.length === 0) parts.push(line);

      return (
        <React.Fragment key={i}>
          {parts}
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
                    PRO
                  </span>
                </h3>
                <p className="text-xs opacity-95 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 bg-green-300 rounded-full animate-pulse"></span>
                  Gemini AI {currentStage ? `• ${currentStage.name}` : ''}
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
                placeholder="اسألني أي شي... (Shift+Enter للسطر الجديد)"
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
                    ></circle>
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                    ></path>
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
              مدعوم بـ <span className="text-orange-600 font-semibold">Google Gemini AI</span> ✨
            </p>
          </div>
        </div>
      )}
    </>
  );
};