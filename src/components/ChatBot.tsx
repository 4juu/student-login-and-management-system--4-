import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Student, AttendanceRecord, AttendanceSession, College, Stage } from '../types/student';
import { User } from '../types/user';

interface Message {
  id: string;
  type: 'user' | 'bot';
  content: string;
  timestamp: Date;
}

interface ChatBotProps {
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

type Intent =
  | 'who_present_today' | 'who_absent_today' | 'who_present_date' | 'who_absent_date'
  | 'count_present_today' | 'count_absent_today' | 'count_present_date' | 'count_absent_date'
  | 'student_info' | 'student_attendance' | 'student_absence_count' | 'student_attendance_count'
  | 'student_full_record'
  | 'top_absent' | 'top_present' | 'worst_students' | 'best_students'
  | 'students_count' | 'students_list' | 'students_by_group'
  | 'group_info' | 'group_count' | 'group_attendance' | 'groups_list'
  | 'session_count' | 'session_list' | 'session_today' | 'last_session' | 'first_session'
  | 'attendance_rate' | 'absence_rate' | 'average_attendance'
  | 'colleges_count' | 'colleges_list' | 'college_info'
  | 'stages_count' | 'stages_list' | 'stage_info'
  | 'teachers_info' | 'teachers_count' | 'teachers_list'
  | 'how_to_add_student' | 'how_to_add_college' | 'how_to_add_teacher' | 'how_to_add_stage'
  | 'how_to_take_attendance' | 'how_to_export' | 'how_to_delete' | 'how_to_login'
  | 'export_records' | 'records_count' | 'records_list'
  | 'general_stats' | 'help' | 'greeting' | 'thanks' | 'farewell' | 'about'
  | 'never_absent' | 'always_absent' | 'students_with_zero_attendance'
  | 'specific_group_present' | 'specific_group_absent'
  | 'compare_students' | 'attendance_today_specific_group'
  | 'current_time' | 'current_date'
  | 'advanced_search_absent' | 'advanced_search_present'
  | 'unknown';

interface ParsedQuery {
  intent: Intent;
  studentName?: string;
  studentCode?: string;
  groupName?: string;
  date?: string;
  number?: number;
}

// ============================================================
// 🛠️ دوال مساعدة عامة
// ============================================================
const ARABIC_DAYS = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const ARABIC_MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

// 🔧 تحويل أي صيغة تاريخ (عربية/إنجليزية) لصيغة موحدة YYYY-MM-DD
const normalizeDate = (dateStr: string): string => {
  if (!dateStr) return '';
  
  // تحويل الأرقام العربية لإنجليزية
  const arabicNumbers = '٠١٢٣٤٥٦٧٨٩';
  const englishNumbers = '0123456789';
  let normalized = dateStr.replace(/[٠-٩]/g, (d) => englishNumbers[arabicNumbers.indexOf(d)]);
  
  // إزالة الفواصل غير المرئية والمسافات الزائدة
  normalized = normalized.replace(/[‏‎\u200E\u200F]/g, '').trim();
  
  // إذا كان بصيغة YYYY-MM-DD مباشرة
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return normalized;
  }
  
  // إذا كان بصيغة DD/MM/YYYY أو D/M/YYYY
  const slashMatch = normalized.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const [, day, month, year] = slashMatch;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  
  // إذا كان بصيغة YYYY/MM/DD
  const slashMatchYMD = normalized.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (slashMatchYMD) {
    const [, year, month, day] = slashMatchYMD;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  
  // إذا كان بصيغة DD-MM-YYYY
  const dashMatch = normalized.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (dashMatch) {
    const [, day, month, year] = dashMatch;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  
  return normalized;
};

const formatArabicDate = (dateStr?: string): string => {
  let d: Date;
  if (dateStr) {
    const normalized = normalizeDate(dateStr);
    d = new Date(normalized);
    if (isNaN(d.getTime())) d = new Date();
  } else {
    d = new Date();
  }
  const dayName = ARABIC_DAYS[d.getDay()];
  const day = d.getDate();
  const month = ARABIC_MONTHS[d.getMonth()];
  const year = d.getFullYear();
  return `${dayName} ${day} ${month} ${year}`;
};

const formatArabicTime = (date?: Date): string => {
  const d = date || new Date();
  return d.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', hour12: true });
};

const getCurrentDateTimeHeader = (): string => {
  const now = new Date();
  return `📅 ${formatArabicDate()}\n🕐 ${formatArabicTime(now)}`;
};

// 🆕 الحصول على تاريخ اليوم بصيغة محلية YYYY-MM-DD
const getLocalToday = (): string => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// 🆕 تحويل createdAt لتاريخ محلي YYYY-MM-DD
const getLocalDateFromTimestamp = (timestamp: string): string => {
  const d = new Date(timestamp);
  if (isNaN(d.getTime())) return '';
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const ChatBot: React.FC<ChatBotProps> = ({
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

  const STORAGE_KEY = `chatbot_messages_${user.uid}`;

  // ============================================================
  // 📦 State
  // ============================================================
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>(() => {
    try {
      const saved = localStorage.getItem(`chatbot_messages_${user.uid}`);
      if (saved) {
        const parsed = JSON.parse(saved);
        return parsed.map((m: Message) => ({ ...m, timestamp: new Date(m.timestamp) }));
      }
    } catch (e) {
      console.error('خطأ في استرجاع المحادثة:', e);
    }
    return [];
  });
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // ============================================================
  // 💾 حفظ تلقائي
  // ============================================================
  useEffect(() => {
    if (messages.length > 0) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-50)));
      } catch (e) {
        console.error('خطأ في حفظ المحادثة:', e);
      }
    }
  }, [messages, STORAGE_KEY]);

  // ============================================================
  // 🎯 البيانات المتاحة حسب الصلاحيات
  // ============================================================
  const accessibleData = useMemo(() => {
    if (isAdmin) {
      const allStudents: Student[] = [];
      const allRecords: AttendanceRecord[] = [];
      const allSessions: AttendanceSession[] = [];
      
      Object.values(allStagesData).forEach(stageData => {
        allStudents.push(...stageData.students);
        allRecords.push(...stageData.records);
        allSessions.push(...stageData.sessions);
      });
      
      return {
        accessibleColleges: colleges,
        accessibleStages: stages,
        allStudents: allStudents.length > 0 ? allStudents : students,
        allRecords: allRecords.length > 0 ? allRecords : records,
        allSessions: allSessions.length > 0 ? allSessions : sessions,
      };
    }
    
    const allowedStagesMap = user.permissions?.allowedStages ?? {};
    const accessibleColleges = colleges.filter(c => !!allowedStagesMap[c.id]);
    const accessibleStageIds = Object.values(allowedStagesMap).flat();
    const accessibleStages = stages.filter(s => accessibleStageIds.includes(s.id));
    
    return {
      accessibleColleges,
      accessibleStages,
      allStudents: students,
      allRecords: records,
      allSessions: sessions,
    };
  }, [isAdmin, colleges, stages, user.permissions, students, records, sessions, allStagesData]);

  const { accessibleColleges, accessibleStages, allStudents, allRecords, allSessions } = accessibleData;

  // ============================================================
  // 💬 رسالة الترحيب
  // ============================================================
  useEffect(() => {
    if (isOpen && messages.length === 0) {
      const hour = new Date().getHours();
      const greeting = hour < 12 ? 'صباح الخير' : hour < 17 ? 'مساء الخير' : 'مساء النور';
      const roleLabel = isAdmin ? '👑 (أدمن)' : '👨‍🏫 (تدريسي)';
      
      setMessages([{
        id: Date.now().toString(),
        type: 'bot',
        content: 
          `${greeting} ${user.displayName} ${roleLabel} 👋\n\n` +
          `${getCurrentDateTimeHeader()}\n\n` +
          `أنا مساعدك الذكي ✨\n` +
          (isAdmin 
            ? `تكدر تسألني عن أي شي بالنظام:\n• كل الطلاب والتدريسيين\n• الحضور والغياب لأي مرحلة\n• الإحصائيات الشاملة` 
            : `تكدر تسألني عن:\n• طلابك وحضورهم\n• الغياب والإحصائيات\n• تصدير السجلات`),
        timestamp: new Date(),
      }]);
    }
  }, [isOpen]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ============================================================
  // 🛠️ دوال مساعدة
  // ============================================================
  const matchesAny = useCallback((text: string, keywords: string[]): boolean => {
    return keywords.some(kw => text.includes(kw));
  }, []);

  const findStudentInQuery = useCallback((query: string): Student | undefined => {
    const q = query.trim();

    const codeMatch = q.match(/\b\d{4}\b/);
    if (codeMatch) {
      const found = allStudents.find(s => s.code === codeMatch[0]);
      if (found) return found;
    }

    const commonWords = new Set([
      'الطالب', 'طالب', 'طلاب', 'الطلاب', 'الطلبة', 'طلبة',
      'حضور', 'غياب', 'غائب', 'حاضر', 'حاضرين', 'غائبين',
      'اليوم', 'امس', 'أمس', 'الحين', 'هسة', 'هسه',
      'اكثر', 'أكثر', 'اقل', 'أقل', 'افضل', 'أفضل', 'احسن',
      'كروب', 'مجموعة', 'مجاميع', 'شعبة', 'شعب',
      'نسبة', 'معدل', 'إحصائيات', 'احصائيات', 'متوسط',
      'سجل', 'سجلات', 'تقرير', 'ملخص',
      'كلية', 'كليات', 'مرحلة', 'مراحل', 'قسم',
      'منتظم', 'منتظمين', 'مثالي', 'مثاليين',
      'شنو', 'كيف', 'متى', 'اين', 'أين', 'منو', 'من',
      'كم', 'عدد', 'قائمة', 'اسماء', 'أسماء',
    ]);

    const sortedStudents = [...allStudents].sort((a, b) => b.name.length - a.name.length);

    for (const student of sortedStudents) {
      if (q.includes(student.name)) return student;
      const nameWords = student.name.split(/\s+/);
      for (let i = 0; i < nameWords.length - 1; i++) {
        const pair = `${nameWords[i]} ${nameWords[i + 1]}`;
        if (pair.length > 5 && q.includes(pair)) return student;
      }
      for (const word of nameWords) {
        if (word.length > 5 && !commonWords.has(word) && q.includes(word)) return student;
      }
    }
    return undefined;
  }, [allStudents]);

  const findGroupInQuery = useCallback((query: string): string | undefined => {
    const groupMatch = query.match(/\b([A-Za-z]\d+)\b/);
    if (groupMatch) {
      const group = groupMatch[1].toUpperCase();
      if (allStudents.some(s => s.group === group)) return group;
    }
    return undefined;
  }, [allStudents]);

  // ✅ محسّن: يدعم كل الصيغ
  const findDateInQuery = useCallback((_query: string, lowercaseQuery: string): string | undefined => {
    // صيغة YYYY-MM-DD
    const dateRegex = /\d{4}-\d{2}-\d{2}/;
    const match = lowercaseQuery.match(dateRegex);
    if (match) return match[0];
    
    // صيغة DD/MM/YYYY
    const slashRegex = /(\d{1,2})\/(\d{1,2})\/(\d{4})/;
    const slashMatch = lowercaseQuery.match(slashRegex);
    if (slashMatch) {
      const [, day, month, year] = slashMatch;
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
    
    if (matchesAny(lowercaseQuery, ['امس', 'أمس', 'البارحة', 'yesterday'])) {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const y = yesterday.getFullYear();
      const m = String(yesterday.getMonth() + 1).padStart(2, '0');
      const d = String(yesterday.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
    return undefined;
  }, [matchesAny]);

  const getTodayDate = useCallback((): string => getLocalToday(), []);

  // ✅ محسّن: يدعم كل صيغ التاريخ + الجلسة النشطة + createdAt
  const getTodaySession = useCallback((): AttendanceSession | undefined => {
    const today = getTodayDate();
    
    console.log('🔍 [ChatBot] البحث عن جلسة اليوم:', today);
    console.log('   📊 عدد الجلسات:', sessions.length);
    console.log('   🎯 activeSessionId:', activeSessionId);
    
    // محاولة 1: الجلسة النشطة لها أولوية إذا كانت لليوم
    if (activeSessionId) {
      const active = sessions.find(s => s.id === activeSessionId);
      if (active) {
        const activeDateNormalized = normalizeDate(active.date);
        console.log('   🟢 الجلسة النشطة:', active.name, '| date:', active.date, '| normalized:', activeDateNormalized);
        
        // مطابقة التاريخ المطبّع
        if (activeDateNormalized === today) {
          console.log('   ✅ الجلسة النشطة لليوم (مطابقة date)');
          return active;
        }
        
        // مطابقة بـ createdAt
        if (active.createdAt) {
          const createdLocal = getLocalDateFromTimestamp(active.createdAt);
          if (createdLocal === today) {
            console.log('   ✅ الجلسة النشطة منشأة اليوم (مطابقة createdAt)');
            return active;
          }
        }
      }
    }
    
    // محاولة 2: مطابقة بعد التطبيع
    let found = sessions.find(s => normalizeDate(s.date) === today);
    if (found) {
      console.log('   ✅ تم إيجاد جلسة بـ normalize date:', found.name);
      return found;
    }
    
    // محاولة 3: شوف إذا انشأت اليوم (createdAt)
    found = sessions.find(s => {
      if (!s.createdAt) return false;
      return getLocalDateFromTimestamp(s.createdAt) === today;
    });
    
    if (found) {
      console.log('   ✅ تم إيجاد جلسة بـ createdAt:', found.name);
    } else {
      console.warn('   ❌ ما لكينا أي جلسة لليوم');
      console.log('   📋 الجلسات الموجودة:', sessions.map(s => ({
        name: s.name,
        date: s.date,
        normalized: normalizeDate(s.date),
        createdAt: s.createdAt,
        createdLocal: s.createdAt ? getLocalDateFromTimestamp(s.createdAt) : 'N/A',
      })));
    }
    
    return found;
  }, [sessions, activeSessionId, getTodayDate]);

  // 🆕 البحث عن جلسة بتاريخ محدد (مع التطبيع)
  const findSessionByDate = useCallback((targetDate: string): AttendanceSession | undefined => {
    const normalized = normalizeDate(targetDate);
    
    // محاولة 1: مطابقة date بعد التطبيع
    let found = sessions.find(s => normalizeDate(s.date) === normalized);
    if (found) return found;
    
    // محاولة 2: مطابقة بـ createdAt
    found = sessions.find(s => {
      if (!s.createdAt) return false;
      return getLocalDateFromTimestamp(s.createdAt) === normalized;
    });
    
    return found;
  }, [sessions]);

  const needStageMessage = useCallback((): string => {
    if (isAdmin) {
      return `📍 لازم تختار مرحلة أولاً دكتور.\nروح للواجهة الرئيسية واختر كلية ومرحلة.\n\n💡 أو اسألني سؤال عام مثل:\n• "كم عدد الطلاب الكلي؟"\n• "كم كلية عدنا؟"`;
    }
    return `📍 اختر مرحلة من المراحل المتاحة لك دكتور`;
  }, [isAdmin]);

  const formatStudentInfo = useCallback((student: Student): string => {
    const studentRecords = allRecords.filter(r => r.studentId === student.id);
    const studentSessions = allSessions;
    
    const attendedSessionIds = new Set(studentRecords.map(r => r.sessionId));
    const attended = attendedSessionIds.size;
    const totalSessions = studentSessions.length;
    const absent = totalSessions - attended;
    const percentage = totalSessions > 0 ? ((attended / totalSessions) * 100).toFixed(1) : '0';

    const pct = parseFloat(percentage);
    let status = '';
    let statusEmoji = '';
    if (pct >= 90) { status = 'ممتاز - منتظم جداً'; statusEmoji = '🌟'; }
    else if (pct >= 75) { status = 'جيد'; statusEmoji = '✅'; }
    else if (pct >= 50) { status = 'متوسط - يحتاج متابعة'; statusEmoji = '⚠️'; }
    else { status = 'ضعيف - غياب كثير'; statusEmoji = '🚨'; }

    return (
      `👤 ${student.name}\n` +
      `${'─'.repeat(25)}\n\n` +
      `🔢 الرمز: ${student.code}\n` +
      `👥 الكروب: ${student.group || '-'}\n\n` +
      `📊 السجل الكامل:\n` +
      `   ✅ حضر: ${attended} يوم\n` +
      `   ❌ غاب: ${absent} يوم\n` +
      `   📈 النسبة: ${percentage}%\n\n` +
      `${statusEmoji} الحالة: ${status}`
    );
  }, [allRecords, allSessions]);

  const formatStudentFullRecord = useCallback((student: Student): string => {
    const studentRecords = allRecords.filter(r => r.studentId === student.id);
    const attendedSessionIds = new Set(studentRecords.map(r => r.sessionId));
    
    const sortedSessions = [...allSessions].sort((a, b) => {
      const dateA = normalizeDate(a.date);
      const dateB = normalizeDate(b.date);
      return dateB.localeCompare(dateA);
    });
    
    if (sortedSessions.length === 0) {
      return `📋 ${student.name}\n\nما عدنا أيام مسجلة بعد`;
    }

    let msg = `📋 السجل الكامل - ${student.name}\n`;
    msg += `🔢 ${student.code}${student.group ? ` | 👥 ${student.group}` : ''}\n`;
    msg += `${'─'.repeat(30)}\n\n`;

    const recent = sortedSessions.slice(0, 15);
    recent.forEach((session) => {
      const isPresent = attendedSessionIds.has(session.id);
      const record = studentRecords.find(r => r.sessionId === session.id);
      const icon = isPresent ? '✅' : '❌';
      const status = isPresent ? 'حاضر' : 'غائب';
      const dateFormatted = formatArabicDate(session.date);
      
      msg += `${icon} ${dateFormatted}\n`;
      msg += `   ${status}`;
      if (isPresent && record) msg += ` | ⏰ ${record.time}`;
      msg += `\n\n`;
    });

    if (sortedSessions.length > 15) {
      msg += `... و ${sortedSessions.length - 15} يوم آخر\n\n`;
    }

    const attended = attendedSessionIds.size;
    const total = sortedSessions.length;
    const pct = total > 0 ? ((attended / total) * 100).toFixed(1) : '0';
    msg += `${'─'.repeat(30)}\n`;
    msg += `📊 الإجمالي: ✅ ${attended} | ❌ ${total - attended} | 📈 ${pct}%`;

    return msg;
  }, [allRecords, allSessions]);

  const getHelpMessage = useCallback((): string => {
    if (isAdmin) {
      return (
        `❓ تكدر تسألني دكتور:\n\n` +
        `📊 الحضور والغياب:\n` +
        `• "من حضر اليوم؟"\n` +
        `• "من غاب اليوم؟"\n` +
        `• "كم عدد الحضور اليوم؟"\n` +
        `• "حضور كروب A1 اليوم"\n\n` +
        `🔍 البحث المتقدم:\n` +
        `• "طلاب غابوا أكثر من 3 أيام"\n` +
        `• "طلاب كروب A1 غابوا أكثر من 5"\n` +
        `• "طلاب حضروا أقل من 5 أيام"\n` +
        `• "طلاب كروب B2 حضروا أكثر من 10"\n\n` +
        `👥 الطلاب:\n` +
        `• "كم عدد الطلاب الكلي؟"\n` +
        `• "من أكثر طالب غياب؟"\n` +
        `• اكتب اسم طالب للبحث الكامل\n` +
        `• "سجل أحمد محمد الكامل"\n\n` +
        `🏛️ الإدارة:\n` +
        `• "كم كلية عدنا؟"\n` +
        `• "كم تدريسي عدنا؟"\n` +
        `• "قائمة التدريسيين"\n` +
        `• "شلون أضيف تدريسي؟"\n\n` +
        `📈 الإحصائيات:\n` +
        `• "إحصائيات شاملة"\n` +
        `• "نسبة الحضور"`
      );
    }
    return (
      `❓ تكدر تسألني دكتور:\n\n` +
      `📊 طلابك:\n` +
      `• "من حضر اليوم؟"\n` +
      `• "من غاب اليوم؟"\n` +
      `• "كم عدد طلابي؟"\n` +
      `• "من أكثر طالب غياب؟"\n\n` +
      `🔍 البحث المتقدم:\n` +
      `• "طلاب غابوا أكثر من 3 أيام"\n` +
      `• "طلاب كروب A1 غابوا أكثر من 5"\n` +
      `• "طلاب حضروا أقل من 5 أيام"\n\n` +
      `👤 طالب معين:\n` +
      `• اكتب اسم الطالب\n` +
      `• "سجل أحمد الكامل"\n` +
      `• "كم غاب علي؟"\n\n` +
      `🏷️ الكروبات:\n` +
      `• "حضور كروب A1"\n` +
      `• "غياب كروب B2 اليوم"\n\n` +
      `📥 "شلون أصدر السجلات؟"`
    );
  }, [isAdmin]);

  const getSmartFallback = useCallback((query: string): string => {
    const suggestions: string[] = [];
    const q = query.toLowerCase();

    if (q.includes('طالب') || q.includes('طلاب')) {
      suggestions.push('• "كم عدد الطلاب؟"', '• "من أكثر طالب غياب؟"', '• اكتب اسم الطالب');
    }
    if (q.includes('حضور') || q.includes('غياب')) {
      suggestions.push('• "من حضر اليوم؟"', '• "كم غاب اليوم؟"', '• "نسبة الحضور"');
    }
    if (q.includes('كروب') || q.includes('مجموعة')) {
      suggestions.push('• "شنو الكروبات؟"', '• "حضور كروب A1"');
    }

    let msg = `🤔 ما فهمت سؤالك بالضبط دكتور...\n\n`;
    if (suggestions.length > 0) {
      msg += `💡 جرب:\n${suggestions.join('\n')}`;
    } else {
      msg += (
        `💡 جرّب تسأل:\n` +
        `• "من حضر اليوم؟"\n` +
        `• "من غاب اليوم؟"\n` +
        `• "كم عدد الطلاب؟"\n` +
        `• "إحصائيات"\n\n` +
        `أو اكتب "مساعدة" لشرح كامل`
      );
    }
    return msg;
  }, []);

  // ============================================================
  // 🧠 محرك تحليل النية
  // ============================================================
  const parseQuery = useCallback((query: string): ParsedQuery => {
    const q = query.toLowerCase().trim().replace(/[؟?.,!]/g, '').replace(/\s+/g, ' ');

    const studentMatch = findStudentInQuery(query);
    const groupMatch = findGroupInQuery(query);
    const dateMatch = findDateInQuery(query, q);
    const numberMatch = q.match(/\d+/);
    const number = numberMatch ? parseInt(numberMatch[0]) : undefined;

    if (matchesAny(q, ['سلام', 'مرحب', 'هلا', 'اهلا', 'أهلا', 'هاي', 'صباح الخير', 'مساء الخير', 'صباح', 'مساء', 'hi', 'hello', 'hey', 'يا هلا', 'حياك', 'مرحبا', 'السلام عليكم', 'وعليكم السلام', 'يا مرحبا', 'اهلين'])) return { intent: 'greeting' };
    if (matchesAny(q, ['شكر', 'مشكور', 'تسلم', 'يعطيك العافية', 'ممنون', 'جزاك الله', 'thanks', 'thank you', 'thx', 'احسنت', 'برافو'])) return { intent: 'thanks' };
    if (matchesAny(q, ['وداع', 'مع السلامة', 'باي', 'الى اللقاء', 'تصبح على خير', 'bye', 'goodbye', 'see you', 'الله معك'])) return { intent: 'farewell' };
    if (matchesAny(q, ['من انت', 'منو انت', 'شنو انت', 'عرف نفسك', 'who are you', 'what are you'])) return { intent: 'about' };

    if (matchesAny(q, ['كم الساعة', 'الوقت', 'الساعة كم', 'time'])) return { intent: 'current_time' };
    if (matchesAny(q, ['شنو التاريخ', 'التاريخ', 'اي يوم', 'date', 'today date'])) return { intent: 'current_date' };

    const isToday = matchesAny(q, ['اليوم', 'هسة', 'هسه', 'الحين', 'today', 'now']);
    const isAbsent = matchesAny(q, ['غاب', 'غايب', 'غايبين', 'ما حضر', 'ماحضر', 'ما جا', 'لم يحضر', 'غياب', 'absent']);
    const isPresent = matchesAny(q, ['حضر', 'حاضر', 'حاضرين', 'دوم', 'دوام', 'يحضر', 'حضوره', 'present']);
    const wantsCount = matchesAny(q, ['كم', 'عدد', 'كم واحد', 'كم طالب', 'how many', 'count']);
    const wantsFullRecord = matchesAny(q, ['سجل كامل', 'كل السجل', 'السجل الكامل', 'تفاصيل', 'كل التواريخ', 'تواريخ']);

    if (isPresent && isToday) return wantsCount ? { intent: 'count_present_today' } : { intent: 'who_present_today' };
    if (isAbsent && isToday) return wantsCount ? { intent: 'count_absent_today' } : { intent: 'who_absent_today' };
    if (isPresent && dateMatch) return wantsCount ? { intent: 'count_present_date', date: dateMatch } : { intent: 'who_present_date', date: dateMatch };
    if (isAbsent && dateMatch) return wantsCount ? { intent: 'count_absent_date', date: dateMatch } : { intent: 'who_absent_date', date: dateMatch };

    if (studentMatch) {
      if (wantsFullRecord) return { intent: 'student_full_record', studentName: studentMatch.name };
      if (isAbsent && matchesAny(q, ['كم مرة', 'كم يوم', 'كم مره', 'كم'])) return { intent: 'student_absence_count', studentName: studentMatch.name };
      if (isPresent && matchesAny(q, ['كم مرة', 'كم يوم', 'كم مره', 'كم'])) return { intent: 'student_attendance_count', studentName: studentMatch.name };
      if (isPresent || isAbsent || matchesAny(q, ['حضور', 'سجل', 'نسبة'])) return { intent: 'student_attendance', studentName: studentMatch.name };
      return { intent: 'student_info', studentName: studentMatch.name };
    }

    const topWords = ['اكثر', 'أكثر', 'افضل', 'أفضل', 'احسن', 'أحسن', 'top', 'best'];
    const worstWords = ['اسوء', 'أسوء', 'اقل', 'أقل', 'اضعف', 'أضعف', 'worst'];
    if (matchesAny(q, topWords)) {
      if (isAbsent) return { intent: 'top_absent', number };
      if (isPresent || matchesAny(q, ['انتظام', 'منتظم', 'دوام'])) return { intent: 'top_present', number };
    }
    if (matchesAny(q, worstWords)) {
      if (isPresent || matchesAny(q, ['حضور'])) return { intent: 'worst_students', number };
      return { intent: 'top_absent', number };
    }
    if (matchesAny(q, ['ترتيب', 'رتب', 'مرتب'])) {
      if (isAbsent) return { intent: 'top_absent', number };
      if (isPresent) return { intent: 'top_present', number };
    }


    if (matchesAny(q, ['ما غاب', 'ماغاب', 'ما غابوا', 'لم يغب', 'منتظمين', 'كامل الحضور', 'حضور كامل', 'ما عندهم غياب', 'طلاب مثاليين', 'الممتازين'])) return { intent: 'never_absent' };
    if (matchesAny(q, ['ما حضر ولا مرة', 'ماحضر ولا', 'لم يحضر ابدا', 'صفر حضور', 'منقطعين', 'مغايبين'])) return { intent: 'students_with_zero_attendance' };

    // 🆕 البحث المتقدم: "طلاب كروب A1 اللي غابوا أكثر من 3 أيام"
    const advancedAbsentMatch = q.match(/(?:غابوا?|غياب|غايبين)\s*(?:اكثر|أكثر|اكبر|أكبر|فوق|بيش|اعلى|أعلى)\s*(?:من\s*)?(\d+)/);
    const advancedAbsentLessMatch = q.match(/(?:غابوا?|غياب|غايبين)\s*(?:اقل|أقل|اصغر|أصغر|تحت|دون)\s*(?:من\s*)?(\d+)/);
    const advancedPresentMatch = q.match(/(?:حضروا?|حضور|حاضرين)\s*(?:اكثر|أكثر|اكبر|أكبر|فوق|بيش|اعلى|أعلى)\s*(?:من\s*)?(\d+)/);
    const advancedPresentLessMatch = q.match(/(?:حضروا?|حضور|حاضرين)\s*(?:اقل|أقل|اصغر|أصغر|تحت|دون)\s*(?:من\s*)?(\d+)/);

    if (advancedAbsentMatch) {
      return { intent: 'advanced_search_absent', number: parseInt(advancedAbsentMatch[1]), groupName: groupMatch, studentCode: 'more' };
    }
    if (advancedAbsentLessMatch) {
      return { intent: 'advanced_search_absent', number: parseInt(advancedAbsentLessMatch[1]), groupName: groupMatch, studentCode: 'less' };
    }
    if (advancedPresentMatch) {
      return { intent: 'advanced_search_present', number: parseInt(advancedPresentMatch[1]), groupName: groupMatch, studentCode: 'more' };
    }
    if (advancedPresentLessMatch) {
      return { intent: 'advanced_search_present', number: parseInt(advancedPresentLessMatch[1]), groupName: groupMatch, studentCode: 'less' };
    }
    if (matchesAny(q, ['طالب', 'طلاب', 'الطلبة', 'student', 'students'])) {
      if (wantsCount) return { intent: 'students_count' };
      if (matchesAny(q, ['اسماء', 'أسماء', 'قائمة', 'عرض', 'list'])) return { intent: 'students_list' };
      if (groupMatch) return { intent: 'students_by_group', groupName: groupMatch };
      return { intent: 'students_count' };
    }

    if (matchesAny(q, ['كروب', 'كروبات', 'مجموعة', 'مجاميع', 'شعبة', 'شعب', 'group', 'groups'])) {
      if (groupMatch) {
        if (isAbsent && isToday) return { intent: 'specific_group_absent', groupName: groupMatch };
        if (isPresent && isToday) return { intent: 'specific_group_present', groupName: groupMatch };
        if (isAbsent || isPresent) return { intent: 'group_attendance', groupName: groupMatch };
        return { intent: 'group_info', groupName: groupMatch };
      }
      if (wantsCount) return { intent: 'group_count' };
      return { intent: 'groups_list' };
    }

    if (groupMatch) {
      if (isAbsent && isToday) return { intent: 'specific_group_absent', groupName: groupMatch };
      if (isPresent && isToday) return { intent: 'specific_group_present', groupName: groupMatch };
      if (isAbsent || isPresent) return { intent: 'group_attendance', groupName: groupMatch };
      return { intent: 'group_info', groupName: groupMatch };
    }

    if (matchesAny(q, ['يوم', 'أيام', 'ايام', 'جلسة', 'جلسات', 'محاضرة', 'محاضرات', 'تاريخ', 'session', 'lecture'])) {
      if (matchesAny(q, ['اخر', 'آخر', 'last'])) return { intent: 'last_session' };
      if (matchesAny(q, ['اول', 'أول', 'first'])) return { intent: 'first_session' };
      if (isToday) return { intent: 'session_today' };
      if (wantsCount) return { intent: 'session_count' };
      return { intent: 'session_list' };
    }

    if (matchesAny(q, ['نسبة', 'معدل', 'rate', 'percentage', '%'])) {
      if (isAbsent) return { intent: 'absence_rate' };
      return { intent: 'attendance_rate' };
    }
    if (matchesAny(q, ['متوسط', 'average', 'mean'])) return { intent: 'average_attendance' };

    if (matchesAny(q, ['كلية', 'كليات', 'قسم', 'اقسام', 'college', 'department'])) {
      if (wantsCount) return { intent: 'colleges_count' };
      return { intent: 'colleges_list' };
    }
    if (matchesAny(q, ['مرحلة', 'مراحل', 'صف', 'صفوف', 'سنة', 'stage', 'year'])) {
      if (wantsCount) return { intent: 'stages_count' };
      return { intent: 'stages_list' };
    }

    if (matchesAny(q, ['تدريسي', 'تدريسيين', 'استاذ', 'أستاذ', 'اساتذة', 'معلم', 'معلمين', 'دكتور', 'دكاترة', 'مدرس', 'teacher', 'teachers'])) {
      if (wantsCount) return { intent: 'teachers_count' };
      if (matchesAny(q, ['قائمة', 'اسماء', 'list'])) return { intent: 'teachers_list' };
      return { intent: 'teachers_info' };
    }

    if (matchesAny(q, ['تصدير', 'صدر', 'حمل', 'تحميل', 'اكسل', 'excel', 'export', 'download', 'pdf', 'طباعة'])) return { intent: 'how_to_export' };
    if (matchesAny(q, ['سجل', 'سجلات', 'records'])) {
      if (wantsCount) return { intent: 'records_count' };
      return { intent: 'records_list' };
    }

    if (matchesAny(q, ['شلون', 'كيف', 'طريقة', 'how', 'how to'])) {
      if (matchesAny(q, ['اضيف', 'أضيف', 'اضافة', 'إضافة', 'add', 'create'])) {
        if (matchesAny(q, ['طالب', 'طلاب'])) return { intent: 'how_to_add_student' };
        if (matchesAny(q, ['كلية', 'قسم'])) return { intent: 'how_to_add_college' };
        if (matchesAny(q, ['تدريسي', 'استاذ', 'معلم'])) return { intent: 'how_to_add_teacher' };
        if (matchesAny(q, ['مرحلة', 'صف'])) return { intent: 'how_to_add_stage' };
      }
      if (matchesAny(q, ['سجل حضور', 'تسجيل', 'attendance'])) return { intent: 'how_to_take_attendance' };
      if (matchesAny(q, ['صدر', 'تصدير', 'حمل', 'export'])) return { intent: 'how_to_export' };
      if (matchesAny(q, ['احذف', 'حذف', 'delete'])) return { intent: 'how_to_delete' };
      if (matchesAny(q, ['دخول', 'login'])) return { intent: 'how_to_login' };
      return { intent: 'help' };
    }

    if (matchesAny(q, ['احصائ', 'إحصائ', 'ملخص', 'تقرير', 'وضع', 'حالة', 'كل شي', 'كلشي', 'overview', 'summary', 'stats'])) return { intent: 'general_stats' };
    if (matchesAny(q, ['ساعد', 'مساعدة', 'help', 'تكدر تساعدني', 'شنو اكدر اسالك'])) return { intent: 'help' };

    return { intent: 'unknown' };
  }, [matchesAny, findStudentInQuery, findGroupInQuery, findDateInQuery]);

  // ============================================================
  // 🎯 معالج الـ Intents
  // ============================================================
  const handleIntent = useCallback((parsed: ParsedQuery, originalQuery: string): string => {

    if (parsed.intent === 'greeting') {
      const hour = new Date().getHours();
      const greeting = hour < 12 ? 'صباح الخير' : hour < 17 ? 'مساء الخير' : 'مساء النور';
      return `${greeting} ${user.displayName} 👋\n\n${getCurrentDateTimeHeader()}\n\nشلون أكدر أساعدك اليوم؟`;
    }
    if (parsed.intent === 'thanks') return `العفو! 😊\nأي وقت تحتاج، أنا موجود!`;
    if (parsed.intent === 'farewell') return `مع السلامة دكتور! 👋\nبالتوفيق!`;
    if (parsed.intent === 'about') {
      return (
        `أنا المساعد الذكي للنظام 🤖\n\n` +
        (isAdmin
          ? '👑 أنت أدمن، معاك صلاحيات كاملة على كل شي بالنظام.\nأكدر أساعدك في إدارة الكليات، التدريسيين، الطلاب، الحضور، والإحصائيات.'
          : '👨‍🏫 أنت تدريسي، أكدر أساعدك في متابعة طلابك، حضورهم، غيابهم، وإحصائياتهم.') +
        `\n\nاسألني أي شي وراح أساعدك! ✨`
      );
    }

    if (parsed.intent === 'current_time') {
      return `🕐 الوقت الحالي:\n${formatArabicTime()}\n\n📅 ${formatArabicDate()}`;
    }
    if (parsed.intent === 'current_date') {
      return `📅 التاريخ:\n${formatArabicDate()}\n\n🕐 الوقت: ${formatArabicTime()}`;
    }

    if (!isAdmin) {
      const restrictedIntents: Intent[] = [
        'teachers_info', 'teachers_count', 'teachers_list',
        'how_to_add_student', 'how_to_add_college',
        'how_to_add_teacher', 'how_to_add_stage', 'how_to_delete',
      ];
      if (restrictedIntents.includes(parsed.intent)) {
        return (
          `🚫 معذرة دكتور، هذي العملية صلاحيات الأدمن فقط.\n\n` +
          `✅ أنت تكدر تسأل عن:\n• طلابك وحضورهم\n• الغياب والإحصائيات\n• تصدير السجلات\n\n` +
          `اكتب "مساعدة" للقائمة الكاملة`
        );
      }
    }

    // ===== الحضور اليوم =====
    if (parsed.intent === 'who_present_today' || parsed.intent === 'count_present_today') {
      if (!currentStageId) return needStageMessage();
      const todaySession = getTodaySession();
      if (!todaySession) {
        return (
          `📅 ${formatArabicDate()}\n\n` +
          `❗ ما عدنا جلسة مسجلة لليوم بعد.\n\n` +
          `💡 لازم تسجل جلسة جديدة أولاً من تبويب "السجلات"`
        );
      }
      const presentRecords = records.filter(r => r.sessionId === todaySession.id);

      if (parsed.intent === 'count_present_today') {
        const total = students.length;
        const present = presentRecords.length;
        const percent = total > 0 ? ((present / total) * 100).toFixed(1) : '0';
        return (
          `📊 إحصائيات حضور اليوم\n` +
          `${getCurrentDateTimeHeader()}\n` +
          `📋 الجلسة: ${todaySession.name}\n` +
          `${'─'.repeat(25)}\n\n` +
          `✅ الحاضرين: ${present} طالب\n` +
          `❌ الغائبين: ${total - present} طالب\n` +
          `👥 إجمالي الطلاب: ${total}\n` +
          `📈 نسبة الحضور: ${percent}%`
        );
      }

      if (presentRecords.length === 0) {
        return `📅 ${formatArabicDate()}\n📋 ${todaySession.name}\n\n😕 ما حضر ولا طالب لحد الحين`;
      }

      let msg = `✅ الحاضرين اليوم (${presentRecords.length} طالب)\n`;
      msg += `${getCurrentDateTimeHeader()}\n`;
      msg += `📋 ${todaySession.name}\n`;
      msg += `${'─'.repeat(25)}\n\n`;
      
      const sorted = [...presentRecords].sort((a, b) => a.studentName.localeCompare(b.studentName, 'ar'));
      sorted.slice(0, 30).forEach((r, i) => {
        msg += `${i + 1}. ✅ ${r.studentName}`;
        if (r.studentGroup) msg += ` (${r.studentGroup})`;
        msg += `\n   🔢 ${r.studentCode} | ⏰ ${r.time}\n\n`;
      });
      if (sorted.length > 30) msg += `... و ${sorted.length - 30} طالب آخرين`;
      return msg;
    }

    // ===== الغياب اليوم =====
    if (parsed.intent === 'who_absent_today' || parsed.intent === 'count_absent_today') {
      if (!currentStageId) return needStageMessage();
      const todaySession = getTodaySession();
      if (!todaySession) {
        return `📅 ${formatArabicDate()}\n\n❗ ما عدنا جلسة مسجلة لليوم بعد`;
      }

      const presentIds = new Set(records.filter(r => r.sessionId === todaySession.id).map(r => r.studentId));
      const absentStudents = students.filter(s => !presentIds.has(s.id));

      if (parsed.intent === 'count_absent_today') {
        const percent = students.length > 0 ? ((absentStudents.length / students.length) * 100).toFixed(1) : '0';
        return (
          `📊 إحصائيات الغياب اليوم\n` +
          `${getCurrentDateTimeHeader()}\n` +
          `📋 ${todaySession.name}\n` +
          `${'─'.repeat(25)}\n\n` +
          `❌ عدد الغائبين: ${absentStudents.length} طالب\n` +
          `✅ الحاضرين: ${students.length - absentStudents.length} طالب\n` +
          `📉 نسبة الغياب: ${percent}%`
        );
      }

      if (absentStudents.length === 0) {
        return `🎉 ممتاز!\n${getCurrentDateTimeHeader()}\n📋 ${todaySession.name}\n\nكل الطلاب حاضرين اليوم! ✅`;
      }

      let msg = `❌ الغائبين اليوم (${absentStudents.length} طالب)\n`;
      msg += `${getCurrentDateTimeHeader()}\n`;
      msg += `📋 ${todaySession.name}\n`;
      msg += `${'─'.repeat(25)}\n\n`;
      
      const sorted = [...absentStudents].sort((a, b) => a.name.localeCompare(b.name, 'ar'));
      sorted.slice(0, 30).forEach((s, i) => {
        msg += `${i + 1}. ❌ ${s.name}`;
        if (s.group) msg += ` (${s.group})`;
        msg += `\n   🔢 ${s.code}\n\n`;
      });
      if (sorted.length > 30) msg += `... و ${sorted.length - 30} طالب آخرين`;
      return msg;
    }

    // ===== حضور / غياب بتاريخ معين =====
    if ((parsed.intent === 'who_present_date' || parsed.intent === 'count_present_date') && parsed.date) {
      if (!currentStageId) return needStageMessage();
      const session = findSessionByDate(parsed.date);
      if (!session) return `📅 ما عدنا جلسة مسجلة بتاريخ ${parsed.date}\n\n💡 الجلسات المتاحة: ${sessions.length}`;

      const presentRecords = records.filter(r => r.sessionId === session.id);
      const dateFormatted = formatArabicDate(parsed.date);
      
      if (parsed.intent === 'count_present_date') {
        const percent = students.length > 0 ? ((presentRecords.length / students.length) * 100).toFixed(1) : '0';
        return `📊 ${dateFormatted}\n📋 ${session.name}\n${'─'.repeat(25)}\n\n✅ الحاضرين: ${presentRecords.length} من ${students.length}\n📈 النسبة: ${percent}%`;
      }
      
      if (presentRecords.length === 0) return `❌ ${dateFormatted}\n\nما حضر ولا طالب`;

      let msg = `✅ الحاضرين - ${dateFormatted}\n`;
      msg += `📋 ${session.name}\n`;
      msg += `العدد: ${presentRecords.length} طالب\n${'─'.repeat(25)}\n\n`;
      [...presentRecords].sort((a, b) => a.studentName.localeCompare(b.studentName, 'ar')).slice(0, 30).forEach((r, i) => {
        msg += `${i + 1}. ✅ ${r.studentName}${r.studentGroup ? ` (${r.studentGroup})` : ''}\n`;
      });
      if (presentRecords.length > 30) msg += `\n... و ${presentRecords.length - 30} آخرين`;
      return msg;
    }

    if ((parsed.intent === 'who_absent_date' || parsed.intent === 'count_absent_date') && parsed.date) {
      if (!currentStageId) return needStageMessage();
      const session = findSessionByDate(parsed.date);
      if (!session) return `📅 ما عدنا جلسة بتاريخ ${parsed.date}`;

      const presentIds = new Set(records.filter(r => r.sessionId === session.id).map(r => r.studentId));
      const absentStudents = students.filter(s => !presentIds.has(s.id));
      const dateFormatted = formatArabicDate(parsed.date);

      if (parsed.intent === 'count_absent_date') {
        const percent = students.length > 0 ? ((absentStudents.length / students.length) * 100).toFixed(1) : '0';
        return `📊 ${dateFormatted}\n📋 ${session.name}\n${'─'.repeat(25)}\n\n❌ الغائبين: ${absentStudents.length} من ${students.length}\n📉 النسبة: ${percent}%`;
      }
      if (absentStudents.length === 0) return `🎉 ${dateFormatted}\n\nكل الطلاب حضروا!`;

      let msg = `❌ الغائبين - ${dateFormatted}\n`;
      msg += `📋 ${session.name}\n`;
      msg += `العدد: ${absentStudents.length} طالب\n${'─'.repeat(25)}\n\n`;
      [...absentStudents].sort((a, b) => a.name.localeCompare(b.name, 'ar')).slice(0, 30).forEach((s, i) => {
        msg += `${i + 1}. ❌ ${s.name}${s.group ? ` (${s.group})` : ''}\n`;
      });
      if (absentStudents.length > 30) msg += `\n... و ${absentStudents.length - 30} آخرين`;
      return msg;
    }

    // ===== معلومات الطالب =====
    if (parsed.intent === 'student_info' || parsed.intent === 'student_attendance') {
      const student = allStudents.find(s => s.name === parsed.studentName);
      if (!student) return `🔍 ما لكيت الطالب`;
      return formatStudentInfo(student);
    }

    if (parsed.intent === 'student_full_record') {
      const student = allStudents.find(s => s.name === parsed.studentName);
      if (!student) return `🔍 ما لكيت الطالب`;
      return formatStudentFullRecord(student);
    }

    if (parsed.intent === 'student_absence_count') {
      const student = allStudents.find(s => s.name === parsed.studentName);
      if (!student) return `🔍 ما لكيت الطالب`;
      const attended = new Set(allRecords.filter(r => r.studentId === student.id).map(r => r.sessionId)).size;
      const total = allSessions.length;
      const absent = total - attended;
      const pct = total > 0 ? ((absent / total) * 100).toFixed(1) : '0';
      return (
        `❌ ${student.name}\n${'─'.repeat(25)}\n\n` +
        `🔢 الرمز: ${student.code}\n` +
        `📊 الغياب: ${absent} يوم من ${total}\n` +
        `📉 نسبة الغياب: ${pct}%`
      );
    }

    if (parsed.intent === 'student_attendance_count') {
      const student = allStudents.find(s => s.name === parsed.studentName);
      if (!student) return `🔍 ما لكيت الطالب`;
      const attended = new Set(allRecords.filter(r => r.studentId === student.id).map(r => r.sessionId)).size;
      const total = allSessions.length;
      const pct = total > 0 ? ((attended / total) * 100).toFixed(1) : '0';
      return (
        `✅ ${student.name}\n${'─'.repeat(25)}\n\n` +
        `🔢 الرمز: ${student.code}\n` +
        `📊 الحضور: ${attended} يوم من ${total}\n` +
        `📈 نسبة الحضور: ${pct}%`
      );
    }

    // ===== الترتيب =====
    if (parsed.intent === 'top_absent') {
      if (!currentStageId) return needStageMessage();
      if (sessions.length === 0) return `📅 ما عدنا أيام حضور بعد`;
      const limit = parsed.number || 5;
      const ranking = students.map(s => {
        const attended = new Set(records.filter(r => r.studentId === s.id).map(r => r.sessionId)).size;
        return { student: s, absent: sessions.length - attended };
      }).filter(x => x.absent > 0).sort((a, b) => b.absent - a.absent).slice(0, limit);

      if (ranking.length === 0) return `🎉 ممتاز! كل الطلاب منتظمين!`;
      let msg = `📊 أكثر ${ranking.length} طلاب غياباً:\n${'─'.repeat(25)}\n\n`;
      ranking.forEach((item, i) => {
        const pct = ((item.absent / sessions.length) * 100).toFixed(0);
        msg += `${i + 1}. ❌ ${item.student.name}\n`;
        msg += `   🔢 ${item.student.code} | 👥 ${item.student.group || '-'}\n`;
        msg += `   📉 غاب: ${item.absent}/${sessions.length} (${pct}%)\n\n`;
      });
      return msg;
    }

    if (parsed.intent === 'top_present' || parsed.intent === 'best_students') {
      if (!currentStageId) return needStageMessage();
      if (sessions.length === 0) return `📅 ما عدنا أيام حضور بعد`;
      const limit = parsed.number || 5;
      const ranking = students.map(s => ({
        student: s,
        attended: new Set(records.filter(r => r.studentId === s.id).map(r => r.sessionId)).size,
      })).sort((a, b) => b.attended - a.attended).slice(0, limit);

      let msg = `🏆 أكثر ${ranking.length} طلاب انتظاماً:\n${'─'.repeat(25)}\n\n`;
      ranking.forEach((item, i) => {
        const pct = ((item.attended / sessions.length) * 100).toFixed(0);
        msg += `${i + 1}. ✅ ${item.student.name}\n`;
        msg += `   🔢 ${item.student.code} | 👥 ${item.student.group || '-'}\n`;
        msg += `   📈 حضر: ${item.attended}/${sessions.length} (${pct}%)\n\n`;
      });
      return msg;
    }

    if (parsed.intent === 'worst_students') {
      if (!currentStageId) return needStageMessage();
      if (sessions.length === 0) return `📅 ما عدنا أيام حضور بعد`;
      const limit = parsed.number || 5;
      const ranking = students.map(s => ({
        student: s,
        attended: new Set(records.filter(r => r.studentId === s.id).map(r => r.sessionId)).size,
      })).sort((a, b) => a.attended - b.attended).slice(0, limit);

      let msg = `📉 أقل ${ranking.length} طلاب حضوراً:\n${'─'.repeat(25)}\n\n`;
      ranking.forEach((item, i) => {
        const pct = ((item.attended / sessions.length) * 100).toFixed(0);
        msg += `${i + 1}. ❌ ${item.student.name}\n`;
        msg += `   🔢 ${item.student.code} | 👥 ${item.student.group || '-'}\n`;
        msg += `   📉 حضر: ${item.attended}/${sessions.length} (${pct}%)\n\n`;
      });
      return msg;
    }

    if (parsed.intent === 'never_absent') {
      if (!currentStageId) return needStageMessage();
      if (sessions.length === 0) return `📅 ما عدنا أيام بعد`;
      const perfect = students.filter(s =>
        new Set(records.filter(r => r.studentId === s.id).map(r => r.sessionId)).size === sessions.length
      );
      if (perfect.length === 0) return `😕 ما عدنا طالب بحضور كامل (${sessions.length} يوم)`;

      let msg = `🌟 الطلاب المثاليين (حضور كامل ${sessions.length}/${sessions.length})\n${'─'.repeat(25)}\n\n`;
      perfect.sort((a, b) => a.name.localeCompare(b.name, 'ar')).slice(0, 30).forEach((s, i) => {
        msg += `${i + 1}. ✅ ${s.name}${s.group ? ` (${s.group})` : ''}\n`;
      });
      if (perfect.length > 30) msg += `\n... و ${perfect.length - 30} آخرين`;
      msg += `\n\n📊 الإجمالي: ${perfect.length} من ${students.length}`;
      return msg;
    }

    if (parsed.intent === 'students_with_zero_attendance') {
      if (!currentStageId) return needStageMessage();
      const noAttendance = students.filter(s => !records.some(r => r.studentId === s.id));
      if (noAttendance.length === 0) return `✅ كل الطلاب حضروا على الأقل مرة وحدة`;

      let msg = `🚨 طلاب ما حضروا ولا مرة (${noAttendance.length})\n${'─'.repeat(25)}\n\n`;
      noAttendance.sort((a, b) => a.name.localeCompare(b.name, 'ar')).slice(0, 30).forEach((s, i) => {
        msg += `${i + 1}. ❌ ${s.name}${s.group ? ` (${s.group})` : ''}\n   🔢 ${s.code}\n`;
      });
      if (noAttendance.length > 30) msg += `\n... و ${noAttendance.length - 30} آخرين`;
      return msg;
    }

    // 🆕 البحث المتقدم - الغياب
    if (parsed.intent === 'advanced_search_absent' && parsed.number !== undefined) {
      if (!currentStageId) return needStageMessage();
      if (sessions.length === 0) return `📅 ما عدنا أيام حضور بعد`;
      
      const threshold = parsed.number;
      const isMore = parsed.studentCode === 'more';
      const groupFilter = parsed.groupName;
      
      // فلترة الطلاب حسب الكروب إذا تم تحديده
      let targetStudents = groupFilter 
        ? students.filter(s => s.group === groupFilter)
        : students;
      
      if (groupFilter && targetStudents.length === 0) {
        return `🔍 ما عدنا طلاب في كروب ${groupFilter}`;
      }
      
      // حساب الغياب لكل طالب
      const results = targetStudents.map(s => {
        const attended = new Set(records.filter(r => r.studentId === s.id).map(r => r.sessionId)).size;
        return { student: s, absent: sessions.length - attended, attended };
      });
      
      // فلترة حسب الشرط
      const filtered = isMore 
        ? results.filter(r => r.absent > threshold)
        : results.filter(r => r.absent < threshold && r.absent > 0);
      
      if (filtered.length === 0) {
        const condition = isMore ? `أكثر من ${threshold}` : `أقل من ${threshold}`;
        const groupText = groupFilter ? ` في كروب ${groupFilter}` : '';
        return `✅ ما عدنا طلاب${groupText} غابوا ${condition} يوم`;
      }
      
      // ترتيب من الأكثر غياب للأقل
      filtered.sort((a, b) => b.absent - a.absent);
      
      const condition = isMore ? `أكثر من ${threshold}` : `أقل من ${threshold}`;
      const groupText = groupFilter ? ` - كروب ${groupFilter}` : '';
      
      let msg = `🔍 بحث متقدم${groupText}\n`;
      msg += `📊 طلاب غابوا ${condition} يوم (${filtered.length})\n`;
      msg += `${'─'.repeat(30)}\n\n`;
      
      filtered.slice(0, 30).forEach((item, i) => {
        const pct = ((item.absent / sessions.length) * 100).toFixed(0);
        msg += `${i + 1}. ❌ ${item.student.name}\n`;
        msg += `   🔢 ${item.student.code}`;
        if (item.student.group) msg += ` | 👥 ${item.student.group}`;
        msg += `\n`;
        msg += `   📉 غاب: ${item.absent}/${sessions.length} يوم (${pct}%)\n`;
        msg += `   ✅ حضر: ${item.attended} يوم\n\n`;
      });
      
      if (filtered.length > 30) {
        msg += `... و ${filtered.length - 30} طالب آخرين\n\n`;
      }
      
      msg += `${'─'.repeat(30)}\n`;
      msg += `📊 الإجمالي: ${filtered.length} طالب من ${targetStudents.length}`;
      
      return msg;
    }

    // 🆕 البحث المتقدم - الحضور
    if (parsed.intent === 'advanced_search_present' && parsed.number !== undefined) {
      if (!currentStageId) return needStageMessage();
      if (sessions.length === 0) return `📅 ما عدنا أيام حضور بعد`;
      
      const threshold = parsed.number;
      const isMore = parsed.studentCode === 'more';
      const groupFilter = parsed.groupName;
      
      let targetStudents = groupFilter 
        ? students.filter(s => s.group === groupFilter)
        : students;
      
      if (groupFilter && targetStudents.length === 0) {
        return `🔍 ما عدنا طلاب في كروب ${groupFilter}`;
      }
      
      const results = targetStudents.map(s => {
        const attended = new Set(records.filter(r => r.studentId === s.id).map(r => r.sessionId)).size;
        return { student: s, attended, absent: sessions.length - attended };
      });
      
      const filtered = isMore 
        ? results.filter(r => r.attended > threshold)
        : results.filter(r => r.attended < threshold);
      
      if (filtered.length === 0) {
        const condition = isMore ? `أكثر من ${threshold}` : `أقل من ${threshold}`;
        const groupText = groupFilter ? ` في كروب ${groupFilter}` : '';
        return `🔍 ما عدنا طلاب${groupText} حضروا ${condition} يوم`;
      }
      
      // ترتيب: للحضور الأكثر من الأكثر للأقل، للحضور الأقل من الأقل للأكثر
      filtered.sort((a, b) => isMore ? b.attended - a.attended : a.attended - b.attended);
      
      const condition = isMore ? `أكثر من ${threshold}` : `أقل من ${threshold}`;
      const groupText = groupFilter ? ` - كروب ${groupFilter}` : '';
      const icon = isMore ? '🏆' : '⚠️';
      
      let msg = `🔍 بحث متقدم${groupText}\n`;
      msg += `${icon} طلاب حضروا ${condition} يوم (${filtered.length})\n`;
      msg += `${'─'.repeat(30)}\n\n`;
      
      filtered.slice(0, 30).forEach((item, i) => {
        const pct = ((item.attended / sessions.length) * 100).toFixed(0);
        const itemIcon = isMore ? '✅' : '❌';
        msg += `${i + 1}. ${itemIcon} ${item.student.name}\n`;
        msg += `   🔢 ${item.student.code}`;
        if (item.student.group) msg += ` | 👥 ${item.student.group}`;
        msg += `\n`;
        msg += `   📈 حضر: ${item.attended}/${sessions.length} يوم (${pct}%)\n`;
        msg += `   ❌ غاب: ${item.absent} يوم\n\n`;
      });
      
      if (filtered.length > 30) {
        msg += `... و ${filtered.length - 30} طالب آخرين\n\n`;
      }
      
      msg += `${'─'.repeat(30)}\n`;
      msg += `📊 الإجمالي: ${filtered.length} طالب من ${targetStudents.length}`;
      
      return msg;
    }

    // ===== الطلاب =====
    if (parsed.intent === 'students_count') {
      if (isAdmin && !currentStageId) {
        const totalStudents = allStudents.length;
        const totalGroups = new Set(allStudents.map(s => s.group).filter(Boolean)).size;
        return (
          `📊 الإحصائيات الكلية للنظام\n${'─'.repeat(25)}\n\n` +
          `🏛️ الكليات: ${colleges.length}\n` +
          `📖 المراحل: ${stages.length}\n` +
          `👥 إجمالي الطلاب: ${totalStudents}\n` +
          `🏷️ إجمالي الكروبات: ${totalGroups}\n` +
          `📅 إجمالي الأيام: ${allSessions.length}\n` +
          `📝 إجمالي السجلات: ${allRecords.length}\n\n` +
          `💡 اختر مرحلة لتفاصيل أكثر`
        );
      }
      if (!currentStageId) return needStageMessage();
      const groups = new Set(students.map(s => s.group).filter(Boolean)).size;
      return (
        `👥 ${currentStage?.name}\n${'─'.repeat(25)}\n\n` +
        `📊 عدد الطلاب: ${students.length}\n` +
        `🏷️ عدد الكروبات: ${groups}\n` +
        `📅 أيام مسجلة: ${sessions.length}\n` +
        `📝 سجلات حضور: ${records.length}`
      );
    }

    if (parsed.intent === 'students_list') {
      if (!currentStageId) return needStageMessage();
      if (students.length === 0) return `👥 ما عدنا طلاب بعد`;
      let msg = `👥 قائمة الطلاب (${students.length})\n${'─'.repeat(25)}\n\n`;
      [...students].sort((a, b) => a.name.localeCompare(b.name, 'ar')).slice(0, 25).forEach((s, i) => {
        msg += `${i + 1}. ${s.name}${s.group ? ` (${s.group})` : ''} - ${s.code}\n`;
      });
      if (students.length > 25) msg += `\n... و ${students.length - 25} آخرين`;
      return msg;
    }

    if (parsed.intent === 'students_by_group' && parsed.groupName) {
      if (!currentStageId) return needStageMessage();
      const groupStudents = students.filter(s => s.group === parsed.groupName);
      if (groupStudents.length === 0) return `🔍 ما عدنا طلاب في كروب ${parsed.groupName}`;
      let msg = `👥 طلاب كروب ${parsed.groupName} (${groupStudents.length})\n${'─'.repeat(25)}\n\n`;
      groupStudents.sort((a, b) => a.name.localeCompare(b.name, 'ar')).forEach((s, i) => {
        msg += `${i + 1}. ${s.name} - ${s.code}\n`;
      });
      return msg;
    }

    // ===== الكروبات =====
    if (parsed.intent === 'group_count' || parsed.intent === 'groups_list') {
      if (!currentStageId) return needStageMessage();
      const groups = Array.from(new Set(students.map(s => s.group).filter(Boolean))) as string[];
      if (groups.length === 0) return `🏷️ ما عدنا كروبات محددة`;
      groups.sort((a, b) => {
        if (a[0] !== b[0]) return a[0].localeCompare(b[0]);
        return (parseInt(a.slice(1)) || 0) - (parseInt(b.slice(1)) || 0);
      });
      let msg = `🏷️ الكروبات (${groups.length})\n${'─'.repeat(25)}\n\n`;
      groups.forEach(g => {
        msg += `   • ${g}: ${students.filter(s => s.group === g).length} طالب\n`;
      });
      msg += `\n📊 الإجمالي: ${students.length} طالب`;
      return msg;
    }

    if (parsed.intent === 'group_info' && parsed.groupName) {
      if (!currentStageId) return needStageMessage();
      const groupStudents = students.filter(s => s.group === parsed.groupName);
      if (groupStudents.length === 0) return `🔍 كروب ${parsed.groupName} ما موجود`;
      const groupRecords = records.filter(r => r.studentGroup === parsed.groupName);
      const possible = groupStudents.length * sessions.length;
      const rate = possible > 0 ? ((groupRecords.length / possible) * 100).toFixed(1) : '0';
      return (
        `🏷️ كروب ${parsed.groupName}\n${'─'.repeat(25)}\n\n` +
        `👥 عدد الطلاب: ${groupStudents.length}\n` +
        `📝 سجلات الحضور: ${groupRecords.length}\n` +
        `📈 معدل الحضور: ${rate}%`
      );
    }

    if (parsed.intent === 'group_attendance' && parsed.groupName) {
      if (!currentStageId) return needStageMessage();
      const groupStudents = students.filter(s => s.group === parsed.groupName);
      if (groupStudents.length === 0) return `🔍 ما عدنا كروب ${parsed.groupName}`;
      if (sessions.length === 0) return `📅 ما عدنا أيام مسجلة`;
      let msg = `📊 حضور كروب ${parsed.groupName}\n${'─'.repeat(25)}\n\n`;
      groupStudents.sort((a, b) => a.name.localeCompare(b.name, 'ar')).forEach((s, i) => {
        const attended = new Set(records.filter(r => r.studentId === s.id).map(r => r.sessionId)).size;
        const pct = ((attended / sessions.length) * 100).toFixed(0);
        const icon = parseFloat(pct) >= 75 ? '✅' : parseFloat(pct) >= 50 ? '⚠️' : '❌';
        msg += `${i + 1}. ${icon} ${s.name}\n   حضر: ${attended} | غاب: ${sessions.length - attended} | ${pct}%\n\n`;
      });
      return msg;
    }

    if ((parsed.intent === 'specific_group_present' || parsed.intent === 'specific_group_absent') && parsed.groupName) {
      if (!currentStageId) return needStageMessage();
      const todaySession = getTodaySession();
      if (!todaySession) return `📅 ${formatArabicDate()}\n\n❗ ما عدنا جلسة لليوم بعد`;
      const groupStudents = students.filter(s => s.group === parsed.groupName);
      if (groupStudents.length === 0) return `🔍 كروب ${parsed.groupName} ما موجود`;
      const presentIds = new Set(records.filter(r => r.sessionId === todaySession.id).map(r => r.studentId));

      if (parsed.intent === 'specific_group_present') {
        const present = groupStudents.filter(s => presentIds.has(s.id));
        if (present.length === 0) return `❌ ما حضر ولا طالب من كروب ${parsed.groupName} اليوم\n\n${getCurrentDateTimeHeader()}`;
        let msg = `✅ الحاضرين من كروب ${parsed.groupName}\n`;
        msg += `العدد: ${present.length}/${groupStudents.length}\n`;
        msg += `${getCurrentDateTimeHeader()}\n${'─'.repeat(25)}\n\n`;
        present.forEach((s, i) => { msg += `${i + 1}. ✅ ${s.name}\n`; });
        return msg;
      } else {
        const absent = groupStudents.filter(s => !presentIds.has(s.id));
        if (absent.length === 0) return `🎉 كل طلاب كروب ${parsed.groupName} حاضرين اليوم!\n\n${getCurrentDateTimeHeader()}`;
        let msg = `❌ الغائبين من كروب ${parsed.groupName}\n`;
        msg += `العدد: ${absent.length}/${groupStudents.length}\n`;
        msg += `${getCurrentDateTimeHeader()}\n${'─'.repeat(25)}\n\n`;
        absent.forEach((s, i) => { msg += `${i + 1}. ❌ ${s.name}\n`; });
        return msg;
      }
    }

    // ===== الجلسات =====
    if (parsed.intent === 'session_count' || parsed.intent === 'session_list') {
      if (!currentStageId) return needStageMessage();
      if (sessions.length === 0) return `📅 ما عدنا أيام حضور مسجلة بعد`;
      const sorted = [...sessions].sort((a, b) => normalizeDate(b.date).localeCompare(normalizeDate(a.date)));
      let msg = `📅 الأيام المسجلة (${sessions.length})\n${'─'.repeat(25)}\n\n`;
      sorted.slice(0, 15).forEach((s, i) => {
        const presentCount = records.filter(r => r.sessionId === s.id).length;
        msg += `${i + 1}. ${s.name}\n`;
        msg += `   📌 ${formatArabicDate(s.date)}\n`;
        msg += `   ✅ ${presentCount} حاضر\n\n`;
      });
      if (sorted.length > 15) msg += `... و ${sorted.length - 15} يوم آخر`;
      return msg;
    }

    if (parsed.intent === 'session_today') {
      if (!currentStageId) return needStageMessage();
      const todaySession = getTodaySession();
      if (!todaySession) return `📅 ${formatArabicDate()}\n\n❗ ما عدنا جلسة مسجلة لليوم`;
      const present = records.filter(r => r.sessionId === todaySession.id).length;
      return (
        `📅 جلسة اليوم: ${todaySession.name}\n${getCurrentDateTimeHeader()}\n${'─'.repeat(25)}\n\n` +
        `✅ الحاضرين: ${present}/${students.length}\n` +
        `❌ الغائبين: ${students.length - present}\n` +
        `📈 النسبة: ${students.length > 0 ? ((present / students.length) * 100).toFixed(1) : 0}%`
      );
    }

    if (parsed.intent === 'last_session') {
      if (sessions.length === 0) return `📅 ما عدنا جلسات`;
      const last = [...sessions].sort((a, b) => normalizeDate(b.date).localeCompare(normalizeDate(a.date)))[0];
      const present = records.filter(r => r.sessionId === last.id).length;
      return (
        `📅 آخر جلسة: ${last.name}\n${'─'.repeat(25)}\n\n` +
        `📌 ${formatArabicDate(last.date)}\n` +
        `✅ الحاضرين: ${present}/${students.length}\n` +
        `📈 النسبة: ${students.length > 0 ? ((present / students.length) * 100).toFixed(1) : 0}%`
      );
    }

    if (parsed.intent === 'first_session') {
      if (sessions.length === 0) return `📅 ما عدنا جلسات`;
      const first = [...sessions].sort((a, b) => normalizeDate(a.date).localeCompare(normalizeDate(b.date)))[0];
      return `📅 أول جلسة: ${first.name}\n${'─'.repeat(25)}\n\n📌 ${formatArabicDate(first.date)}`;
    }

    // ===== النسب =====
    if (parsed.intent === 'attendance_rate') {
      if (!currentStageId) return needStageMessage();
      if (sessions.length === 0 || students.length === 0) return `📊 ما نكدر نحسب نسبة بدون أيام أو طلاب`;
      const possible = sessions.length * students.length;
      const pct = ((records.length / possible) * 100).toFixed(2);
      return (
        `📈 نسبة الحضور العامة\n${'─'.repeat(25)}\n\n` +
        `✅ ${pct}%\n\n` +
        `📊 ${records.length} حضور من أصل ${possible} ممكن\n` +
        `👥 ${students.length} طالب × ${sessions.length} يوم`
      );
    }

    if (parsed.intent === 'absence_rate') {
      if (!currentStageId) return needStageMessage();
      if (sessions.length === 0 || students.length === 0) return `📊 ما نكدر نحسب نسبة بدون بيانات`;
      const possible = sessions.length * students.length;
      const absent = possible - records.length;
      const pct = ((absent / possible) * 100).toFixed(2);
      return (
        `📉 نسبة الغياب العامة\n${'─'.repeat(25)}\n\n` +
        `❌ ${pct}%\n\n` +
        `📊 ${absent} غياب من أصل ${possible}`
      );
    }

    if (parsed.intent === 'average_attendance') {
      if (!currentStageId) return needStageMessage();
      if (sessions.length === 0) return `📊 ما عدنا أيام`;
      return (
        `📊 المتوسطات\n${'─'.repeat(25)}\n\n` +
        `📅 متوسط حضور الطالب: ${students.length > 0 ? (records.length / students.length).toFixed(1) : '0'} يوم\n` +
        `👥 متوسط الحاضرين باليوم: ${(records.length / sessions.length).toFixed(1)} طالب`
      );
    }

    // ===== الكليات =====
    if (parsed.intent === 'colleges_count' || parsed.intent === 'colleges_list') {
      const list = isAdmin ? colleges : accessibleColleges;
      if (list.length === 0) return isAdmin ? `🏛️ ما عدنا كليات بعد` : `🔒 ما عندك صلاحيات لأي كلية`;
      let msg = `🏛️ ${isAdmin ? 'الكليات' : 'الكليات المتاحة لك'}: ${list.length}\n${'─'.repeat(25)}\n\n`;
      list.forEach((c, i) => {
        const sCount = (isAdmin ? stages : accessibleStages).filter(s => s.collegeId === c.id).length;
        msg += `${i + 1}. ${c.icon || '🏛️'} ${c.name} (${sCount} مرحلة)\n`;
        if (parsed.intent === 'colleges_list') {
          (isAdmin ? stages : accessibleStages)
            .filter(s => s.collegeId === c.id)
            .slice(0, 5)
            .forEach(s => { msg += `   • ${s.name}\n`; });
          msg += '\n';
        }
      });
      return msg;
    }

    // ===== المراحل =====
    if (parsed.intent === 'stages_count' || parsed.intent === 'stages_list') {
      const list = isAdmin ? stages : accessibleStages;
      if (list.length === 0) return `📖 ما عدنا مراحل`;
      let msg = `📖 المراحل (${list.length})\n${'─'.repeat(25)}\n\n`;
      (isAdmin ? colleges : accessibleColleges).forEach(c => {
        const cStages = list.filter(s => s.collegeId === c.id);
        if (cStages.length > 0) {
          msg += `${c.icon || '🏛️'} ${c.name}:\n`;
          cStages.forEach(s => { msg += `   • ${s.name}\n`; });
          msg += '\n';
        }
      });
      return msg;
    }

    // ===== التدريسيين =====
    if (parsed.intent === 'teachers_count') {
      if (allTeachers.length === 0) {
        return (
          `👨‍🏫 التدريسيين\n${'─'.repeat(25)}\n\n` +
          `لإدارة التدريسيين روح لتبويب "إدارة التدريسيين"\n\n` +
          `هناك تكدر:\n• إضافة حسابات جديدة\n• تحديد الصلاحيات\n• تغيير كلمات المرور`
        );
      }
      return `👨‍🏫 عدد التدريسيين: ${allTeachers.length}`;
    }

    if (parsed.intent === 'teachers_list' || parsed.intent === 'teachers_info') {
      if (allTeachers.length === 0) {
        return (
          `👨‍🏫 إدارة التدريسيين\n${'─'.repeat(25)}\n\n` +
          `روح لتبويب "إدارة التدريسيين" حيث تكدر:\n` +
          `• إضافة حسابات تدريسيين جدد\n` +
          `• تحديد الصلاحيات والمراحل لكل تدريسي\n` +
          `• تغيير كلمات المرور\n` +
          `• حذف الحسابات\n\n` +
          `💡 كل تدريسي يشوف فقط المراحل المسموحة له`
        );
      }
      let msg = `👨‍🏫 قائمة التدريسيين (${allTeachers.length})\n${'─'.repeat(25)}\n\n`;
      allTeachers.forEach((t, i) => {
        const allowedCount = Object.values(t.permissions?.allowedStages || {}).flat().length;
        msg += `${i + 1}. ${t.displayName}\n`;
        msg += `   📧 ${t.email}\n`;
        msg += `   📖 ${allowedCount} مرحلة مسموحة\n\n`;
      });
      return msg;
    }

    // ===== الإرشادات =====
    if (parsed.intent === 'how_to_add_student') return `➕ إضافة طالب\n${'─'.repeat(25)}\n\n1️⃣ افتح المرحلة\n2️⃣ تبويب "إدارة الطلاب"\n3️⃣ إما يدوياً (اسم + رمز 4 أرقام)\n   أو ارفع ملف Excel\n\n💡 الرمز من 1000 إلى 9999`;
    if (parsed.intent === 'how_to_add_college') return `🏛️ إضافة كلية\n${'─'.repeat(25)}\n\n1️⃣ تبويب "إدارة الكليات"\n2️⃣ "إضافة كلية / قسم جديد"\n3️⃣ اختر اسم وأيقونة ولون\n4️⃣ أضف المراحل`;
    if (parsed.intent === 'how_to_add_teacher') return `👨‍🏫 إضافة تدريسي\n${'─'.repeat(25)}\n\n1️⃣ تبويب "إدارة التدريسيين"\n2️⃣ "إضافة تدريسي جديد"\n3️⃣ أدخل: الاسم + الإيميل + كلمة المرور\n4️⃣ اضغط "⚙️ الصلاحيات" وحدد المراحل`;
    if (parsed.intent === 'how_to_add_stage') return `📖 إضافة مرحلة\n${'─'.repeat(25)}\n\n1️⃣ تبويب "إدارة الكليات"\n2️⃣ افتح الكلية المطلوبة\n3️⃣ اضغط "إضافة مرحلة"\n4️⃣ سمها (مثل: المرحلة الأولى)`;
    if (parsed.intent === 'how_to_take_attendance') return `📝 تسجيل الحضور\n${'─'.repeat(25)}\n\n1️⃣ افتح المرحلة\n2️⃣ تبويب "السجلات" → ابدأ جلسة جديدة\n3️⃣ تبويب "تسجيل الحضور"\n4️⃣ ادخل رموز الطلاب الحاضرين`;
    if (parsed.intent === 'how_to_export') return `📥 تصدير السجلات\n${'─'.repeat(25)}\n\n1️⃣ تبويب "سجل الحضور"\n2️⃣ اختر المدة (يوم أو فترة)\n3️⃣ اضغط "تحميل كشف الحضور والغياب"\n\n📊 يطلع ملف Excel فيه:\n✓ تبويب أبجدي + تبويب كروبات\n✓ ✅ حضور / ❌ غياب\n✓ حساب الغيابات تلقائياً`;
    if (parsed.intent === 'how_to_delete') return `🗑️ الحذف\n${'─'.repeat(25)}\n\n• طالب: في "إدارة الطلاب"\n• كلية: في "إدارة الكليات" - زر 🗑️\n• تدريسي: في "إدارة التدريسيين" - زر 🗑️\n\n⚠️ الحذف نهائي!`;
    if (parsed.intent === 'how_to_login') return `🔐 تسجيل الدخول\n${'─'.repeat(25)}\n\nاستخدم بريدك الإلكتروني وكلمة المرور.\nإذا نسيت كلمة المرور، تواصل مع الأدمن.`;

    if (parsed.intent === 'records_count') {
      if (!currentStageId) return needStageMessage();
      return `📝 السجلات\n${'─'.repeat(25)}\n\n📊 ${records.length} سجل حضور\n📅 ${sessions.length} يوم\n👥 ${students.length} طالب`;
    }
    if (parsed.intent === 'export_records' || parsed.intent === 'records_list') {
      return handleIntent({ intent: 'how_to_export' }, originalQuery);
    }

    // ===== إحصائيات شاملة =====
    if (parsed.intent === 'general_stats') {
      let msg = `📊 ملخص شامل\n${getCurrentDateTimeHeader()}\n${'─'.repeat(25)}\n\n`;
      
      msg += isAdmin
        ? `🏛️ الكليات: ${colleges.length}\n📖 المراحل: ${stages.length}\n👨‍🏫 التدريسيين: ${allTeachers.length}\n👥 إجمالي الطلاب: ${allStudents.length}\n`
        : `🏛️ كلياتك: ${accessibleColleges.length}\n📖 مراحلك: ${accessibleStages.length}\n`;

      if (currentStage) {
        const groups = new Set(students.map(s => s.group).filter(Boolean)).size;
        msg += `\n📍 ${currentStage.name}:\n`;
        msg += `   👥 الطلاب: ${students.length}\n`;
        msg += `   📅 الأيام: ${sessions.length}\n`;
        msg += `   📝 السجلات: ${records.length}\n`;
        if (groups > 0) msg += `   🏷️ الكروبات: ${groups}\n`;
        if (sessions.length > 0 && students.length > 0) {
          const rate = ((records.length / (sessions.length * students.length)) * 100).toFixed(1);
          msg += `\n📈 نسبة الحضور: ${rate}%`;
        }

        const todaySession = getTodaySession();
        if (todaySession) {
          const presentToday = records.filter(r => r.sessionId === todaySession.id).length;
          msg += `\n\n📅 اليوم:\n`;
          msg += `   📋 ${todaySession.name}\n`;
          msg += `   ✅ حاضر: ${presentToday}\n`;
          msg += `   ❌ غائب: ${students.length - presentToday}`;
        }
      } else {
        msg += `\n💡 اختر مرحلة لرؤية تفاصيلها`;
      }
      return msg;
    }

    if (parsed.intent === 'help') return getHelpMessage();
    return getSmartFallback(originalQuery);

  }, [
    isAdmin, user.displayName, currentStageId, currentStage,
    students, records, sessions, colleges, stages,
    accessibleColleges, accessibleStages,
    allStudents, allRecords, allSessions, allTeachers,
    getTodaySession, findSessionByDate, needStageMessage,
    formatStudentInfo, formatStudentFullRecord, getHelpMessage, getSmartFallback,
  ]);

  // ============================================================
  // 📤 إرسال
  // ============================================================
  const sendMessage = useCallback((text: string) => {
    if (!text.trim()) return;
    const userMessage: Message = {
      id: Date.now().toString(),
      type: 'user',
      content: text,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsTyping(true);
    setTimeout(() => {
      const parsedQuery = parseQuery(text);
      const botResponse = handleIntent(parsedQuery, text);
      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        type: 'bot',
        content: botResponse,
        timestamp: new Date(),
      }]);
      setIsTyping(false);
    }, 500);
  }, [parseQuery, handleIntent]);

  const handleSend = useCallback(() => sendMessage(input), [input, sendMessage]);

  const handleReset = useCallback(() => {
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) { console.error(e); }
    setMessages([]);
    setTimeout(() => {
      const hour = new Date().getHours();
      const greeting = hour < 12 ? 'صباح الخير' : hour < 17 ? 'مساء الخير' : 'مساء النور';
      setMessages([{
        id: Date.now().toString(),
        type: 'bot',
        content: `${greeting} ${user.displayName} 👋\n\n${getCurrentDateTimeHeader()}\n\nشلون أكدر أساعدك؟ ✨`,
        timestamp: new Date(),
      }]);
    }, 100);
  }, [STORAGE_KEY, user.displayName]);

  // ============================================================
  // 🎨 الواجهة
  // ============================================================
  const quickQuestions = isAdmin
    ? ['من حضر اليوم؟', 'من غاب اليوم؟', 'إحصائيات شاملة', 'قائمة التدريسيين']
    : ['من حضر اليوم؟', 'من غاب اليوم؟', 'كم عدد طلابي؟', 'أكثر طالب غياب'];

  return (
    <>
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-6 left-6 w-16 h-16 bg-gradient-to-br from-blue-600 to-purple-700 hover:from-blue-700 hover:to-purple-800 text-white rounded-full shadow-2xl flex items-center justify-center transition-all hover:scale-110 z-50"
          title="المساعد الذكي"
        >
          <span className="text-3xl">🤖</span>
          <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs w-6 h-6 rounded-full flex items-center justify-center font-bold animate-pulse">!</span>
        </button>
      )}

      {isOpen && (
        <div className="fixed bottom-6 left-6 w-96 max-w-[calc(100vw-3rem)] h-[600px] max-h-[calc(100vh-3rem)] bg-white rounded-2xl shadow-2xl flex flex-col z-50 border-2 border-blue-200">

          <div className="bg-gradient-to-r from-blue-600 to-purple-700 text-white p-4 rounded-t-2xl flex justify-between items-center">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-white bg-opacity-20 rounded-full flex items-center justify-center text-2xl">🤖</div>
              <div>
                <h3 className="font-bold">المساعد الذكي</h3>
                <p className="text-xs opacity-90">
                  {currentStage ? `📍 ${currentStage.name}` : isAdmin ? '👑 وضع الأدمن' : '👨‍🏫 وضع التدريسي'}
                </p>
              </div>
            </div>
            <div className="flex gap-2 items-center">
              <button onClick={handleReset} className="text-white hover:bg-white hover:bg-opacity-20 rounded p-1.5 transition" title="محادثة جديدة">🔄</button>
              <button onClick={() => setIsOpen(false)} className="text-white hover:bg-white hover:bg-opacity-20 rounded p-1.5 transition text-xl leading-none w-8 h-8 flex items-center justify-center">×</button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50">
            {messages.map(msg => (
              <div key={msg.id} className={`flex ${msg.type === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-2xl p-3 ${
                  msg.type === 'user'
                    ? 'bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-br-none'
                    : 'bg-white text-gray-800 border border-gray-200 rounded-bl-none shadow-sm'
                }`}>
                  <p className="text-sm whitespace-pre-line leading-relaxed">{msg.content}</p>
                  <p className={`text-xs mt-1 ${msg.type === 'user' ? 'text-blue-100' : 'text-gray-400'}`}>
                    {msg.timestamp.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </div>
            ))}

            {isTyping && (
              <div className="flex justify-start">
                <div className="bg-white border border-gray-200 rounded-2xl rounded-bl-none p-3 shadow-sm">
                  <div className="flex gap-1">
                    <span className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {messages.length <= 1 && (
            <div className="px-3 py-2 bg-white border-t border-gray-200">
              <p className="text-xs text-gray-500 mb-2">💡 أسئلة سريعة:</p>
              <div className="flex flex-wrap gap-1">
                {quickQuestions.map(q => (
                  <button key={q} onClick={() => sendMessage(q)} className="text-xs bg-blue-50 hover:bg-blue-100 text-blue-700 px-2 py-1 rounded-full border border-blue-200 transition">{q}</button>
                ))}
              </div>
            </div>
          )}

          <div className="p-3 bg-white border-t border-gray-200 rounded-b-2xl">
            <div className="flex gap-2">
              <input
                type="text"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSend()}
                placeholder="اكتب سؤالك..."
                className="flex-1 px-3 py-2 border border-gray-300 rounded-full focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                dir="rtl"
              />
              <button
                onClick={handleSend}
                disabled={!input.trim()}
                className="bg-gradient-to-r from-blue-600 to-purple-700 hover:from-blue-700 hover:to-purple-800 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-full w-10 h-10 flex items-center justify-center transition shadow-md"
              >
                <svg className="w-5 h-5 transform -scale-x-100" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};