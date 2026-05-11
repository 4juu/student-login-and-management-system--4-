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
  | 'student_full_record' | 'student_full_attendance' | 'student_full_absence'
  | 'top_absent' | 'top_present' | 'worst_students' | 'best_students'
  | 'students_count' | 'students_list' | 'students_by_group'
  | 'group_info' | 'group_count' | 'group_attendance' | 'groups_list'
  | 'group_cumulative_present' | 'group_cumulative_absent'
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
  | 'cumulative_present' | 'cumulative_absent'
  | 'total_attendance_sum' | 'total_absence_sum'
  | 'last_week_present' | 'last_week_absent'
  | 'last_month_present' | 'last_month_absent'
  | 'this_week_present' | 'this_week_absent'
  | 'this_month_present' | 'this_month_absent'
  | 'day_of_month_present' | 'day_of_month_absent'
  | 'unknown';

interface ParsedQuery {
  intent: Intent;
  studentName?: string;
  studentCode?: string;
  groupName?: string;
  date?: string;
  number?: number;
  dayOfMonth?: number;
}

// ============================================================
// 🛠️ دوال مساعدة عامة
// ============================================================
const ARABIC_DAYS = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const ARABIC_MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

const normalizeDate = (dateStr: string): string => {
  if (!dateStr) return '';
  const arabicNumbers = '٠١٢٣٤٥٦٧٨٩';
  const englishNumbers = '0123456789';
  let normalized = dateStr.replace(/[٠-٩]/g, (d) => englishNumbers[arabicNumbers.indexOf(d)]);
  normalized = normalized.replace(/[‏‎\u200E\u200F]/g, '').trim();
  
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return normalized;
  
  const slashMatch = normalized.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const [, day, month, year] = slashMatch;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  
  const slashMatchYMD = normalized.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (slashMatchYMD) {
    const [, year, month, day] = slashMatchYMD;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  
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

const getLocalToday = (): string => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

const getLocalDateFromTimestamp = (timestamp: string): string => {
  const d = new Date(timestamp);
  if (isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// 🆕 حساب نطاق الأسبوع/الشهر
const getDateRange = (period: 'this_week' | 'last_week' | 'this_month' | 'last_month'): { start: string; end: string } => {
  const now = new Date();
  let start = new Date(now);
  let end = new Date(now);

  if (period === 'this_week') {
    const day = now.getDay();
    start.setDate(now.getDate() - day);
    end = new Date(now);
  } else if (period === 'last_week') {
    const day = now.getDay();
    start.setDate(now.getDate() - day - 7);
    end = new Date(start);
    end.setDate(start.getDate() + 6);
  } else if (period === 'this_month') {
    start = new Date(now.getFullYear(), now.getMonth(), 1);
    end = new Date(now);
  } else if (period === 'last_month') {
    start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    end = new Date(now.getFullYear(), now.getMonth(), 0);
  }

  const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { start: fmt(start), end: fmt(end) };
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

  useEffect(() => {
    if (messages.length > 0) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-50)));
      } catch (e) {
        console.error('خطأ في حفظ المحادثة:', e);
      }
    }
  }, [messages, STORAGE_KEY]);

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
          `تكدر تسألني بأي طريقة تحبها:\n` +
          `• منو حاضر اليوم؟\n` +
          `• منو غاب الاسبوع الماضي؟\n` +
          `• حضور احمد لكل الايام\n` +
          `• مجموع حضور كروب A1\n` +
          `• منو حضر يوم 10`,
        timestamp: new Date(),
      }]);
    }
  }, [isOpen]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

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
      'مجموع', 'اجمالي', 'كل', 'الايام', 'الفترة', 'البداية',
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

  const findDateInQuery = useCallback((_query: string, lowercaseQuery: string): string | undefined => {
    const dateRegex = /\d{4}-\d{2}-\d{2}/;
    const match = lowercaseQuery.match(dateRegex);
    if (match) return match[0];
    
    const slashRegex = /(\d{1,2})\/(\d{1,2})\/(\d{4})/;
    const slashMatch = lowercaseQuery.match(slashRegex);
    if (slashMatch) {
      const [, day, month, year] = slashMatch;
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
    
    if (matchesAny(lowercaseQuery, ['امس', 'أمس', 'البارحة', 'yesterday'])) {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      return `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
    }
    
    const dayNames: { [key: string]: number } = {
      'الاحد': 0, 'احد': 0, 'الأحد': 0, 'sunday': 0,
      'الاثنين': 1, 'اثنين': 1, 'الإثنين': 1, 'الاتنين': 1, 'monday': 1,
      'الثلاثاء': 2, 'ثلاثاء': 2, 'الثلثاء': 2, 'tuesday': 2,
      'الاربعاء': 3, 'اربعاء': 3, 'الأربعاء': 3, 'wednesday': 3,
      'الخميس': 4, 'خميس': 4, 'thursday': 4,
      'الجمعة': 5, 'جمعة': 5, 'الجمعه': 5, 'friday': 5,
      'السبت': 6, 'سبت': 6, 'saturday': 6,
    };
    
    let targetDayOfWeek: number | undefined;
    let isPastWeek = false;
    
    if (lowercaseQuery.includes('الفائت') || lowercaseQuery.includes('الماضي') || lowercaseQuery.includes('السابق') || lowercaseQuery.includes('last')) {
      isPastWeek = true;
    }
    
    for (const dayKey of Object.keys(dayNames)) {
      if (lowercaseQuery.includes(dayKey)) {
        targetDayOfWeek = dayNames[dayKey];
        break;
      }
    }
    
    if (targetDayOfWeek !== undefined) {
      const matchingSessions = sessions
        .filter(s => {
          const normalized = normalizeDate(s.date);
          const sessionDate = new Date(normalized);
          if (isNaN(sessionDate.getTime())) return false;
          return sessionDate.getDay() === targetDayOfWeek;
        })
        .sort((a, b) => normalizeDate(b.date).localeCompare(normalizeDate(a.date)));
      
      if (matchingSessions.length > 0) {
        if (isPastWeek && matchingSessions.length > 1) {
          return normalizeDate(matchingSessions[1].date);
        }
        return normalizeDate(matchingSessions[0].date);
      }
      
      const today = new Date();
      const todayDay = today.getDay();
      let diff = todayDay - targetDayOfWeek;
      if (diff < 0) diff += 7;
      if (isPastWeek) diff += 7;
      
      const targetDate = new Date(today);
      targetDate.setDate(today.getDate() - diff);
      
      return `${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2, '0')}-${String(targetDate.getDate()).padStart(2, '0')}`;
    }
    
    return undefined;
  }, [matchesAny, sessions]);

  // 🆕 إيجاد رقم اليوم في الشهر (مثل: يوم 10، يوم 15)
  const findDayOfMonthInQuery = useCallback((lowercaseQuery: string): number | undefined => {
    const dayMatch = lowercaseQuery.match(/يوم\s+(\d{1,2})(?:\s|$)/);
    if (dayMatch) {
      const day = parseInt(dayMatch[1]);
      if (day >= 1 && day <= 31) return day;
    }
    const inMonthMatch = lowercaseQuery.match(/(\d{1,2})\s*(?:بالشهر|من الشهر|في الشهر)/);
    if (inMonthMatch) {
      const day = parseInt(inMonthMatch[1]);
      if (day >= 1 && day <= 31) return day;
    }
    return undefined;
  }, []);

  const getTodayDate = useCallback((): string => getLocalToday(), []);

  const getTodaySession = useCallback((): AttendanceSession | undefined => {
    const today = getTodayDate();
    
    if (activeSessionId) {
      const active = sessions.find(s => s.id === activeSessionId);
      if (active) {
        const activeDateNormalized = normalizeDate(active.date);
        if (activeDateNormalized === today) return active;
        if (active.createdAt) {
          const createdLocal = getLocalDateFromTimestamp(active.createdAt);
          if (createdLocal === today) return active;
        }
      }
    }
    
    let found = sessions.find(s => normalizeDate(s.date) === today);
    if (found) return found;
    
    found = sessions.find(s => {
      if (!s.createdAt) return false;
      return getLocalDateFromTimestamp(s.createdAt) === today;
    });
    
    return found;
  }, [sessions, activeSessionId, getTodayDate]);

  const findSessionByDate = useCallback((targetDate: string): AttendanceSession | undefined => {
    const normalized = normalizeDate(targetDate);
    let found = sessions.find(s => normalizeDate(s.date) === normalized);
    if (found) return found;
    
    found = sessions.find(s => {
      if (!s.createdAt) return false;
      return getLocalDateFromTimestamp(s.createdAt) === normalized;
    });
    
    return found;
  }, [sessions]);

  // 🆕 إيجاد جلسات في نطاق تاريخ
  const findSessionsInRange = useCallback((startDate: string, endDate: string): AttendanceSession[] => {
    return sessions.filter(s => {
      const normalized = normalizeDate(s.date);
      return normalized >= startDate && normalized <= endDate;
    }).sort((a, b) => normalizeDate(a.date).localeCompare(normalizeDate(b.date)));
  }, [sessions]);

  const needStageMessage = useCallback((): string => {
    if (isAdmin) {
      return `📍 لازم تختار مرحلة أولاً دكتور.\nروح للواجهة الرئيسية واختر كلية ومرحلة.`;
    }
    return `📍 اختر مرحلة من المراحل المتاحة لك دكتور`;
  }, [isAdmin]);

  const formatStudentInfo = useCallback((student: Student): string => {
    const studentRecords = allRecords.filter(r => r.studentId === student.id);
    const attendedSessionIds = new Set(studentRecords.map(r => r.sessionId));
    const attended = attendedSessionIds.size;
    const totalSessions = allSessions.length;
    const absent = totalSessions - attended;
    const percentage = totalSessions > 0 ? ((attended / totalSessions) * 100).toFixed(1) : '0';

    const pct = parseFloat(percentage);
    let status = '', statusEmoji = '';
    if (pct >= 90) { status = 'ممتاز - منتظم جداً'; statusEmoji = '🌟'; }
    else if (pct >= 75) { status = 'جيد'; statusEmoji = '✅'; }
    else if (pct >= 50) { status = 'متوسط - يحتاج متابعة'; statusEmoji = '⚠️'; }
    else { status = 'ضعيف - غياب كثير'; statusEmoji = '🚨'; }

    return (
      `👤 ${student.name}\n${'─'.repeat(25)}\n\n` +
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
    const sortedSessions = [...allSessions].sort((a, b) => normalizeDate(b.date).localeCompare(normalizeDate(a.date)));
    
    if (sortedSessions.length === 0) return `📋 ${student.name}\n\nما عدنا أيام مسجلة بعد`;

    let msg = `📋 السجل الكامل - ${student.name}\n`;
    msg += `🔢 ${student.code}${student.group ? ` | 👥 ${student.group}` : ''}\n${'─'.repeat(30)}\n\n`;

    sortedSessions.slice(0, 20).forEach((session) => {
      const isPresent = attendedSessionIds.has(session.id);
      const record = studentRecords.find(r => r.sessionId === session.id);
      const icon = isPresent ? '✅' : '❌';
      const status = isPresent ? 'حاضر' : 'غائب';
      msg += `${icon} ${formatArabicDate(session.date)}\n   ${status}`;
      if (isPresent && record) msg += ` | ⏰ ${record.time}`;
      msg += `\n\n`;
    });

    if (sortedSessions.length > 20) msg += `... و ${sortedSessions.length - 20} يوم آخر\n\n`;

    const attended = attendedSessionIds.size;
    const total = sortedSessions.length;
    const pct = total > 0 ? ((attended / total) * 100).toFixed(1) : '0';
    msg += `${'─'.repeat(30)}\n📊 الإجمالي: ✅ ${attended} | ❌ ${total - attended} | 📈 ${pct}%`;
    return msg;
  }, [allRecords, allSessions]);

  const getHelpMessage = useCallback((): string => {
    return (
      `❓ تكدر تسألني دكتور بأي طريقة:\n\n` +
      `📊 الحضور والغياب اليوم:\n` +
      `• منو حاضر اليوم\n• منو غايب اليوم\n• كم حضر اليوم\n\n` +
      `📅 حضور بأيام معينة:\n` +
      `• منو حضر الاحد الفائت\n` +
      `• منو حضر يوم 10\n` +
      `• حضور الاسبوع الماضي\n` +
      `• حضور الشهر الماضي\n\n` +
      `📋 السجل التراكمي:\n` +
      `• حضور كل الايام\n` +
      `• مجموع الحضور\n` +
      `• حضور كروب A1 من اول يوم\n\n` +
      `👤 طالب معين:\n` +
      `• حضور احمد لكل الايام\n` +
      `• مجموع غياب علي\n` +
      `• كم غاب محمد\n\n` +
      `🔍 البحث المتقدم:\n` +
      `• طلاب غابوا اكثر من 3\n` +
      `• اعرض كروب A1`
    );
  }, []);

  const SMART_PATTERNS = {
    greetings: ['hi', 'hello', 'السلام عليكم', 'شلونك', 'هاي', 'اهلا', 'مرحبا', 'هلا', 'سلام'],
    attendanceWords: ['present', 'موجود', 'دخل', 'سجل', 'دوام', 'داوم', 'حضر', 'حاضر', 'حضور', 'حضوره', 'حضرت', 'حضورهم'],
    absenceWords: ['absent', 'منقطع', 'ما حضر', 'ماحضر', 'غاب', 'غايب', 'غياب', 'غيابه', 'غيابهم', 'غايبين'],
    todayWords: ['today', 'now', 'الان', 'هسه', 'هسة', 'الحين', 'اليوم'],
    countWords: ['how many', 'count', 'شكد', 'عدد', 'كم'],
    studentWords: ['الطلبه', 'الطلبة', 'student', 'students', 'طالب', 'طلاب'],
    groupWords: ['group', 'groups', 'section', 'شعبه', 'شعبة', 'مجموعه', 'مجموعة', 'كروب', 'كروبات'],
    helpWords: ['help', 'how', 'طريقه', 'طريقة', 'كيف', 'شلون', 'ساعدني', 'مساعده', 'مساعدة'],
    cumulativeWords: [
      'من اول', 'من اول يوم', 'من البداية', 'كل الفترة', 'كل المدة', 'كل الايام',
      'كل الجلسات', 'تراكمي', 'الى الان', 'الى الحين', 'لحد الان', 'لحد الحين',
      'منذ البداية', 'منذ اول يوم', 'كل السنة', 'كل الشهر', 'بكل الايام',
      'بكل الفترة', 'مجموع', 'اجمالي', 'بشكل عام', 'بشكل كلي', 'كلش',
      'all time', 'cumulative', 'total', 'overall', 'كل ايام', 'لكل الايام', 'لكل الفترة',
    ],
    sumWords: ['مجموع', 'اجمالي', 'كلي', 'كامل', 'total', 'sum'],
    lastWeekWords: ['الاسبوع الماضي', 'الاسبوع الفائت', 'اسبوع الماضي', 'الاسبوع السابق', 'last week'],
    thisWeekWords: ['هذا الاسبوع', 'الاسبوع الحالي', 'بهالاسبوع', 'this week'],
    lastMonthWords: ['الشهر الماضي', 'الشهر الفائت', 'شهر الماضي', 'الشهر السابق', 'last month'],
    thisMonthWords: ['هذا الشهر', 'الشهر الحالي', 'بهالشهر', 'this month'],
  };

  // ============================================================
  // 🧠 محرك تحليل النية المتطور
  // ============================================================
  const parseQuery = useCallback((query: string): ParsedQuery => {
    const q = query
      .toLowerCase()
      .trim()
      .replace(/[؟?.,!]/g, '')
      .replace(/\s+/g, ' ')
      .replace(/أ|إ|آ/g, 'ا')
      .replace(/ة/g, 'ه')
      .replace(/ى/g, 'ي')
      .replace(/گ/g, 'ك')
      .replace(/چ/g, 'ج');

    const studentMatch = findStudentInQuery(query);
    const groupMatch = findGroupInQuery(query);
    const dateMatch = findDateInQuery(query, q);
    const dayOfMonthMatch = findDayOfMonthInQuery(q);
    const numberMatch = q.match(/\d+/);
    const number = numberMatch ? parseInt(numberMatch[0]) : undefined;

    if (matchesAny(q, SMART_PATTERNS.greetings)) return { intent: 'greeting' };
    if (matchesAny(q, ['شكر', 'مشكور', 'تسلم', 'يعطيك العافية', 'ممنون', 'thanks', 'thank you'])) return { intent: 'thanks' };
    if (matchesAny(q, ['وداع', 'مع السلامة', 'باي', 'bye', 'goodbye'])) return { intent: 'farewell' };
    if (matchesAny(q, ['من انت', 'منو انت', 'شنو انت', 'who are you'])) return { intent: 'about' };
    if (matchesAny(q, ['كم الساعة', 'الوقت', 'time'])) return { intent: 'current_time' };
    if (matchesAny(q, ['شنو التاريخ', 'التاريخ', 'date'])) return { intent: 'current_date' };

    const isAbsent = matchesAny(q, SMART_PATTERNS.absenceWords);
    const isPresent = matchesAny(q, SMART_PATTERNS.attendanceWords);
    const isToday = matchesAny(q, SMART_PATTERNS.todayWords);
    const wantsCount = matchesAny(q, SMART_PATTERNS.countWords);
    const isCumulative = matchesAny(q, SMART_PATTERNS.cumulativeWords);
    const isSum = matchesAny(q, SMART_PATTERNS.sumWords);
    const isLastWeek = matchesAny(q, SMART_PATTERNS.lastWeekWords);
    const isThisWeek = matchesAny(q, SMART_PATTERNS.thisWeekWords);
    const isLastMonth = matchesAny(q, SMART_PATTERNS.lastMonthWords);
    const isThisMonth = matchesAny(q, SMART_PATTERNS.thisMonthWords);
    const wantsFullRecord = matchesAny(q, ['سجل كامل', 'كل السجل', 'تفاصيل', 'تواريخ', 'report', 'history']);

    // ============================= 🆕 الأسبوع الماضي / هذا الأسبوع =============================
    if (isLastWeek) {
      if (isAbsent) return { intent: 'last_week_absent', groupName: groupMatch };
      if (isPresent) return { intent: 'last_week_present', groupName: groupMatch };
      return { intent: 'last_week_present', groupName: groupMatch };
    }
    if (isThisWeek) {
      if (isAbsent) return { intent: 'this_week_absent', groupName: groupMatch };
      if (isPresent) return { intent: 'this_week_present', groupName: groupMatch };
      return { intent: 'this_week_present', groupName: groupMatch };
    }
    if (isLastMonth) {
      if (isAbsent) return { intent: 'last_month_absent', groupName: groupMatch };
      if (isPresent) return { intent: 'last_month_present', groupName: groupMatch };
      return { intent: 'last_month_present', groupName: groupMatch };
    }
    if (isThisMonth) {
      if (isAbsent) return { intent: 'this_month_absent', groupName: groupMatch };
      if (isPresent) return { intent: 'this_month_present', groupName: groupMatch };
      return { intent: 'this_month_present', groupName: groupMatch };
    }

    // ============================= 🆕 يوم رقم X من الشهر =============================
    if (dayOfMonthMatch !== undefined && !dateMatch) {
      if (isAbsent) return { intent: 'day_of_month_absent', dayOfMonth: dayOfMonthMatch, groupName: groupMatch };
      return { intent: 'day_of_month_present', dayOfMonth: dayOfMonthMatch, groupName: groupMatch };
    }

    // ============================= 🆕 طالب معين - سجل كامل =============================
    if (studentMatch) {
      if (isCumulative || wantsFullRecord) {
        if (isSum && isAbsent) return { intent: 'student_full_absence', studentName: studentMatch.name };
        if (isSum && isPresent) return { intent: 'student_full_attendance', studentName: studentMatch.name };
        if (isAbsent) return { intent: 'student_full_absence', studentName: studentMatch.name };
        if (isPresent) return { intent: 'student_full_attendance', studentName: studentMatch.name };
        return { intent: 'student_full_record', studentName: studentMatch.name };
      }
      
      if (isSum) {
        if (isAbsent) return { intent: 'student_absence_count', studentName: studentMatch.name };
        if (isPresent) return { intent: 'student_attendance_count', studentName: studentMatch.name };
        return { intent: 'student_full_record', studentName: studentMatch.name };
      }
      
      if (isAbsent && matchesAny(q, ['كم'])) return { intent: 'student_absence_count', studentName: studentMatch.name };
      if (isPresent && matchesAny(q, ['كم'])) return { intent: 'student_attendance_count', studentName: studentMatch.name };
      if (isPresent || isAbsent) return { intent: 'student_attendance', studentName: studentMatch.name };
      return { intent: 'student_info', studentName: studentMatch.name };
    }

    // ============================= 🆕 الحضور التراكمي للكروب =============================
    if (groupMatch && isCumulative) {
      if (isAbsent) return { intent: 'group_cumulative_absent', groupName: groupMatch };
      return { intent: 'group_cumulative_present', groupName: groupMatch };
    }

    // ============================= 🆕 المجموع الكلي =============================
    if (isCumulative || isSum) {
      if (isAbsent) {
        if (isSum && !groupMatch) return { intent: 'total_absence_sum', groupName: groupMatch };
        return { intent: 'cumulative_absent', groupName: groupMatch };
      }
      if (isPresent) {
        if (isSum && !groupMatch) return { intent: 'total_attendance_sum', groupName: groupMatch };
        return { intent: 'cumulative_present', groupName: groupMatch };
      }
      return { intent: 'general_stats' };
    }

    if (isPresent && isToday) return wantsCount ? { intent: 'count_present_today' } : { intent: 'who_present_today' };
    if (isAbsent && isToday) return wantsCount ? { intent: 'count_absent_today' } : { intent: 'who_absent_today' };
    if (isPresent && dateMatch) return wantsCount ? { intent: 'count_present_date', date: dateMatch } : { intent: 'who_present_date', date: dateMatch };
    if (isAbsent && dateMatch) return wantsCount ? { intent: 'count_absent_date', date: dateMatch } : { intent: 'who_absent_date', date: dateMatch };

    if (q.includes('منو غايب') || q.includes('من الغايبين') || q.includes('الغياب اليوم') || q.includes('جيب الغياب')) {
      return { intent: 'who_absent_today' };
    }
    if (q.includes('منو حاضر') || q.includes('الحضور اليوم') || q.includes('جيب الحضور') || q.includes('منو داوم')) {
      return { intent: 'who_present_today' };
    }
    if (q.includes('شكد غياب') || q.includes('كم غياب') || q.includes('عدد الغياب')) {
      return { intent: 'count_absent_today' };
    }
    if (q.includes('شكد حضور') || q.includes('كم حضور') || q.includes('عدد الحضور')) {
      return { intent: 'count_present_today' };
    }
    if (q.includes('احصائيات') || q.includes('ملخص النظام') || q.includes('وضع الموقع') || q.includes('كلشي')) {
      return { intent: 'general_stats' };
    }

    const topWords = ['اكثر', 'أكثر', 'افضل', 'احسن', 'top', 'best'];
    const worstWords = ['اسوء', 'اقل', 'اضعف', 'worst'];
    if (matchesAny(q, topWords)) {
      if (isAbsent) return { intent: 'top_absent', number };
      if (isPresent || matchesAny(q, ['انتظام', 'منتظم'])) return { intent: 'top_present', number };
    }
    if (matchesAny(q, worstWords)) {
      if (isPresent) return { intent: 'worst_students', number };
      return { intent: 'top_absent', number };
    }

    if (matchesAny(q, ['ما غاب', 'منتظمين', 'كامل الحضور', 'مثاليين'])) return { intent: 'never_absent' };
    if (matchesAny(q, ['ما حضر ولا مرة', 'صفر حضور', 'منقطعين'])) return { intent: 'students_with_zero_attendance' };

    const advancedAbsentMatch = q.match(/(?:غابوا?|غياب)\s*(?:اكثر|اكبر|فوق)\s*(?:من\s*)?(\d+)/);
    const advancedAbsentLessMatch = q.match(/(?:غابوا?|غياب)\s*(?:اقل|تحت)\s*(?:من\s*)?(\d+)/);
    const advancedPresentMatch = q.match(/(?:حضروا?|حضور)\s*(?:اكثر|اكبر|فوق)\s*(?:من\s*)?(\d+)/);
    const advancedPresentLessMatch = q.match(/(?:حضروا?|حضور)\s*(?:اقل|تحت)\s*(?:من\s*)?(\d+)/);

    if (advancedAbsentMatch) return { intent: 'advanced_search_absent', number: parseInt(advancedAbsentMatch[1]), groupName: groupMatch, studentCode: 'more' };
    if (advancedAbsentLessMatch) return { intent: 'advanced_search_absent', number: parseInt(advancedAbsentLessMatch[1]), groupName: groupMatch, studentCode: 'less' };
    if (advancedPresentMatch) return { intent: 'advanced_search_present', number: parseInt(advancedPresentMatch[1]), groupName: groupMatch, studentCode: 'more' };
    if (advancedPresentLessMatch) return { intent: 'advanced_search_present', number: parseInt(advancedPresentLessMatch[1]), groupName: groupMatch, studentCode: 'less' };

    if (matchesAny(q, SMART_PATTERNS.studentWords)) {
      if (wantsCount) return { intent: 'students_count' };
      if (matchesAny(q, ['اسماء', 'قائمة', 'list'])) return { intent: 'students_list' };
      if (groupMatch) return { intent: 'students_by_group', groupName: groupMatch };
      return { intent: 'students_count' };
    }

    if (matchesAny(q, SMART_PATTERNS.groupWords)) {
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

    if (matchesAny(q, ['يوم', 'جلسة', 'جلسات', 'محاضرة', 'session'])) {
      if (matchesAny(q, ['اخر', 'آخر', 'last'])) return { intent: 'last_session' };
      if (matchesAny(q, ['اول', 'first'])) return { intent: 'first_session' };
      if (isToday) return { intent: 'session_today' };
      if (wantsCount) return { intent: 'session_count' };
      return { intent: 'session_list' };
    }

    if (matchesAny(q, ['نسبة', 'معدل', 'rate', '%'])) {
      if (isAbsent) return { intent: 'absence_rate' };
      return { intent: 'attendance_rate' };
    }
    if (matchesAny(q, ['متوسط', 'average'])) return { intent: 'average_attendance' };

    if (matchesAny(q, ['كلية', 'كليات', 'قسم', 'college'])) {
      if (wantsCount) return { intent: 'colleges_count' };
      return { intent: 'colleges_list' };
    }
    if (matchesAny(q, ['مرحلة', 'مراحل', 'stage'])) {
      if (wantsCount) return { intent: 'stages_count' };
      return { intent: 'stages_list' };
    }

    if (matchesAny(q, ['تدريسي', 'استاذ', 'دكتور', 'مدرس', 'teacher'])) {
      if (wantsCount) return { intent: 'teachers_count' };
      if (matchesAny(q, ['قائمة', 'اسماء', 'list'])) return { intent: 'teachers_list' };
      return { intent: 'teachers_info' };
    }

    if (matchesAny(q, ['تصدير', 'صدر', 'حمل', 'اكسل', 'excel', 'export'])) return { intent: 'how_to_export' };
    if (matchesAny(q, ['سجل', 'سجلات', 'records'])) {
      if (wantsCount) return { intent: 'records_count' };
      return { intent: 'records_list' };
    }

    if (matchesAny(q, SMART_PATTERNS.helpWords)) {
      if (matchesAny(q, ['اضيف', 'اضافة', 'add'])) {
        if (matchesAny(q, ['طالب'])) return { intent: 'how_to_add_student' };
        if (matchesAny(q, ['كلية'])) return { intent: 'how_to_add_college' };
        if (matchesAny(q, ['تدريسي', 'استاذ'])) return { intent: 'how_to_add_teacher' };
        if (matchesAny(q, ['مرحلة'])) return { intent: 'how_to_add_stage' };
      }
      if (matchesAny(q, ['تسجيل', 'attendance'])) return { intent: 'how_to_take_attendance' };
      if (matchesAny(q, ['صدر', 'تصدير', 'export'])) return { intent: 'how_to_export' };
      if (matchesAny(q, ['حذف', 'delete'])) return { intent: 'how_to_delete' };
      if (matchesAny(q, ['دخول', 'login'])) return { intent: 'how_to_login' };
      return { intent: 'help' };
    }

    return { intent: 'unknown' };
  }, [matchesAny, findStudentInQuery, findGroupInQuery, findDateInQuery, findDayOfMonthInQuery, SMART_PATTERNS]);
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
    if (parsed.intent === 'about') return `أنا المساعد الذكي 🤖\nأقدر أساعدك بكل شي يخص الحضور والغياب.`;
    if (parsed.intent === 'current_time') return `🕐 الوقت:\n${formatArabicTime()}\n\n📅 ${formatArabicDate()}`;
    if (parsed.intent === 'current_date') return `📅 التاريخ:\n${formatArabicDate()}\n\n🕐 ${formatArabicTime()}`;

    if (!isAdmin) {
      const restrictedIntents: Intent[] = [
        'teachers_info', 'teachers_count', 'teachers_list',
        'how_to_add_student', 'how_to_add_college',
        'how_to_add_teacher', 'how_to_add_stage', 'how_to_delete',
      ];
      if (restrictedIntents.includes(parsed.intent)) {
        return `🚫 صلاحيات الأدمن فقط دكتور.`;
      }
    }

    // ===== سجل الطالب الكامل (حضور فقط) =====
    if (parsed.intent === 'student_full_attendance') {
      const student = allStudents.find(s => s.name === parsed.studentName);
      if (!student) return `🔍 ما لكيت الطالب`;
      
      const studentRecords = allRecords.filter(r => r.studentId === student.id);
      const attendedSessionIds = new Set(studentRecords.map(r => r.sessionId));
      const attendedSessions = allSessions
        .filter(s => attendedSessionIds.has(s.id))
        .sort((a, b) => normalizeDate(b.date).localeCompare(normalizeDate(a.date)));
      
      if (attendedSessions.length === 0) return `❌ ${student.name}\nما حضر ولا يوم من ${allSessions.length} يوم`;
      
      let msg = `✅ كل أيام حضور - ${student.name}\n`;
      msg += `🔢 ${student.code}${student.group ? ` | 👥 ${student.group}` : ''}\n${'─'.repeat(30)}\n\n`;
      
      attendedSessions.forEach((session, i) => {
        const record = studentRecords.find(r => r.sessionId === session.id);
        msg += `${i + 1}. ✅ ${formatArabicDate(session.date)}\n`;
        if (record) msg += `   ⏰ ${record.time}\n`;
        msg += `\n`;
      });
      
      const pct = allSessions.length > 0 ? ((attendedSessions.length / allSessions.length) * 100).toFixed(1) : '0';
      msg += `${'─'.repeat(30)}\n📊 الإجمالي: حضر ${attendedSessions.length}/${allSessions.length} (${pct}%)`;
      return msg;
    }

    // ===== سجل الطالب الكامل (غياب فقط) =====
    if (parsed.intent === 'student_full_absence') {
      const student = allStudents.find(s => s.name === parsed.studentName);
      if (!student) return `🔍 ما لكيت الطالب`;
      
      const studentRecords = allRecords.filter(r => r.studentId === student.id);
      const attendedSessionIds = new Set(studentRecords.map(r => r.sessionId));
      const absentSessions = allSessions
        .filter(s => !attendedSessionIds.has(s.id))
        .sort((a, b) => normalizeDate(b.date).localeCompare(normalizeDate(a.date)));
      
      if (absentSessions.length === 0) return `🌟 ممتاز! ${student.name}\nما غاب ولا يوم!`;
      
      let msg = `❌ كل أيام غياب - ${student.name}\n`;
      msg += `🔢 ${student.code}${student.group ? ` | 👥 ${student.group}` : ''}\n${'─'.repeat(30)}\n\n`;
      
      absentSessions.forEach((session, i) => {
        msg += `${i + 1}. ❌ ${formatArabicDate(session.date)}\n\n`;
      });
      
      const pct = allSessions.length > 0 ? ((absentSessions.length / allSessions.length) * 100).toFixed(1) : '0';
      msg += `${'─'.repeat(30)}\n📊 الإجمالي: غاب ${absentSessions.length}/${allSessions.length} (${pct}%)`;
      return msg;
    }

    // ===== الكروب التراكمي - حضور =====
    if (parsed.intent === 'group_cumulative_present' && parsed.groupName) {
      if (!currentStageId) return needStageMessage();
      if (sessions.length === 0) return `📅 ما عدنا أيام بعد`;
      
      const groupStudents = students.filter(s => s.group === parsed.groupName);
      if (groupStudents.length === 0) return `🔍 ما عدنا كروب ${parsed.groupName}`;
      
      const studentsAttendance = groupStudents.map(s => {
        const attended = new Set(records.filter(r => r.studentId === s.id).map(r => r.sessionId)).size;
        return { student: s, attended };
      }).sort((a, b) => b.attended - a.attended);
      
      let msg = `📊 سجل حضور كروب ${parsed.groupName} - تراكمي\n`;
      msg += `📅 من ${sessions.length} يوم\n${getCurrentDateTimeHeader()}\n${'─'.repeat(30)}\n\n`;
      
      studentsAttendance.forEach((item, i) => {
        const pct = ((item.attended / sessions.length) * 100).toFixed(0);
        const icon = parseFloat(pct) >= 75 ? '✅' : parseFloat(pct) >= 50 ? '⚠️' : '🚨';
        msg += `${i + 1}. ${icon} ${item.student.name}\n`;
        msg += `   🔢 ${item.student.code} | 📈 ${item.attended}/${sessions.length} (${pct}%)\n\n`;
      });
      
      const totalAttendance = studentsAttendance.reduce((sum, item) => sum + item.attended, 0);
      const possible = groupStudents.length * sessions.length;
      const groupPct = possible > 0 ? ((totalAttendance / possible) * 100).toFixed(1) : '0';
      msg += `${'─'.repeat(30)}\n📊 إجمالي حضور الكروب: ${totalAttendance}/${possible} (${groupPct}%)`;
      return msg;
    }

    // ===== الكروب التراكمي - غياب =====
    if (parsed.intent === 'group_cumulative_absent' && parsed.groupName) {
      if (!currentStageId) return needStageMessage();
      if (sessions.length === 0) return `📅 ما عدنا أيام بعد`;
      
      const groupStudents = students.filter(s => s.group === parsed.groupName);
      if (groupStudents.length === 0) return `🔍 ما عدنا كروب ${parsed.groupName}`;
      
      const studentsAbsence = groupStudents.map(s => {
        const attended = new Set(records.filter(r => r.studentId === s.id).map(r => r.sessionId)).size;
        return { student: s, absent: sessions.length - attended };
      }).sort((a, b) => b.absent - a.absent);
      
      let msg = `📊 سجل غياب كروب ${parsed.groupName} - تراكمي\n`;
      msg += `📅 من ${sessions.length} يوم\n${getCurrentDateTimeHeader()}\n${'─'.repeat(30)}\n\n`;
      
      studentsAbsence.forEach((item, i) => {
        const pct = ((item.absent / sessions.length) * 100).toFixed(0);
        const icon = parseFloat(pct) >= 50 ? '🚨' : parseFloat(pct) >= 25 ? '⚠️' : '❌';
        msg += `${i + 1}. ${icon} ${item.student.name}\n`;
        msg += `   🔢 ${item.student.code} | 📉 ${item.absent}/${sessions.length} (${pct}%)\n\n`;
      });
      
      const totalAbsence = studentsAbsence.reduce((sum, item) => sum + item.absent, 0);
      const possible = groupStudents.length * sessions.length;
      const groupPct = possible > 0 ? ((totalAbsence / possible) * 100).toFixed(1) : '0';
      msg += `${'─'.repeat(30)}\n📉 إجمالي غياب الكروب: ${totalAbsence}/${possible} (${groupPct}%)`;
      return msg;
    }

    // ===== المجموع الكلي - حضور =====
    if (parsed.intent === 'total_attendance_sum') {
      if (!currentStageId) return needStageMessage();
      if (sessions.length === 0) return `📅 ما عدنا أيام بعد`;
      
      const totalAttendance = records.length;
      const possible = students.length * sessions.length;
      const pct = possible > 0 ? ((totalAttendance / possible) * 100).toFixed(2) : '0';
      const groups = Array.from(new Set(students.map(s => s.group).filter(Boolean))) as string[];
      
      let msg = `📊 المجموع الكلي للحضور\n${getCurrentDateTimeHeader()}\n${'─'.repeat(30)}\n\n`;
      msg += `✅ إجمالي الحضور: ${totalAttendance}\n`;
      msg += `📅 عدد الأيام: ${sessions.length}\n`;
      msg += `👥 عدد الطلاب: ${students.length}\n`;
      msg += `📈 الحد الأقصى: ${possible}\n`;
      msg += `📊 النسبة: ${pct}%\n\n`;
      
      if (groups.length > 0) {
        msg += `🏷️ تفصيل حسب الكروبات:\n`;
        groups.sort().forEach(g => {
          const gStudents = students.filter(s => s.group === g);
          const gAttended = records.filter(r => r.studentGroup === g).length;
          const gPossible = gStudents.length * sessions.length;
          const gPct = gPossible > 0 ? ((gAttended / gPossible) * 100).toFixed(1) : '0';
          msg += `   • ${g}: ${gAttended}/${gPossible} (${gPct}%)\n`;
        });
      }
      return msg;
    }

    // ===== المجموع الكلي - غياب =====
    if (parsed.intent === 'total_absence_sum') {
      if (!currentStageId) return needStageMessage();
      if (sessions.length === 0) return `📅 ما عدنا أيام بعد`;
      
      const totalAttendance = records.length;
      const possible = students.length * sessions.length;
      const totalAbsence = possible - totalAttendance;
      const pct = possible > 0 ? ((totalAbsence / possible) * 100).toFixed(2) : '0';
      const groups = Array.from(new Set(students.map(s => s.group).filter(Boolean))) as string[];
      
      let msg = `📊 المجموع الكلي للغياب\n${getCurrentDateTimeHeader()}\n${'─'.repeat(30)}\n\n`;
      msg += `❌ إجمالي الغياب: ${totalAbsence}\n`;
      msg += `📅 عدد الأيام: ${sessions.length}\n`;
      msg += `👥 عدد الطلاب: ${students.length}\n`;
      msg += `📉 النسبة: ${pct}%\n\n`;
      
      if (groups.length > 0) {
        msg += `🏷️ تفصيل حسب الكروبات:\n`;
        groups.sort().forEach(g => {
          const gStudents = students.filter(s => s.group === g);
          const gAttended = records.filter(r => r.studentGroup === g).length;
          const gPossible = gStudents.length * sessions.length;
          const gAbsent = gPossible - gAttended;
          const gPct = gPossible > 0 ? ((gAbsent / gPossible) * 100).toFixed(1) : '0';
          msg += `   • ${g}: ${gAbsent}/${gPossible} (${gPct}%)\n`;
        });
      }
      return msg;
    }

    // ===== الفترات الزمنية (أسبوع/شهر) =====
    const handlePeriodQuery = (period: 'this_week' | 'last_week' | 'this_month' | 'last_month', isAbsentQuery: boolean, groupFilter?: string): string => {
      if (!currentStageId) return needStageMessage();
      
      const range = getDateRange(period);
      const periodSessions = findSessionsInRange(range.start, range.end);
      
      const periodNames: { [key: string]: string } = {
        'this_week': 'هذا الأسبوع',
        'last_week': 'الأسبوع الماضي',
        'this_month': 'هذا الشهر',
        'last_month': 'الشهر الماضي',
      };
      const periodName = periodNames[period];
      
      if (periodSessions.length === 0) {
        return `📅 ${periodName}\n\n❗ ما عدنا جلسات\n📌 من ${formatArabicDate(range.start)}\n📌 إلى ${formatArabicDate(range.end)}`;
      }
      
      let targetStudents = groupFilter ? students.filter(s => s.group === groupFilter) : students;
      if (groupFilter && targetStudents.length === 0) return `🔍 ما عدنا كروب ${groupFilter}`;
      
      const periodSessionIds = new Set(periodSessions.map(s => s.id));
      const periodRecords = records.filter(r => periodSessionIds.has(r.sessionId));
      
      const studentsStats = targetStudents.map(s => {
        const attended = new Set(periodRecords.filter(r => r.studentId === s.id).map(r => r.sessionId)).size;
        return { student: s, attended, absent: periodSessions.length - attended };
      });
      
      const groupText = groupFilter ? ` - كروب ${groupFilter}` : '';
      let msg = `📅 ${isAbsentQuery ? 'غياب' : 'حضور'} ${periodName}${groupText}\n`;
      msg += `📌 ${formatArabicDate(range.start)} → ${formatArabicDate(range.end)}\n`;
      msg += `📋 الجلسات: ${periodSessions.length}\n${'─'.repeat(30)}\n\n`;
      
      if (isAbsentQuery) {
        const absentees = studentsStats.filter(s => s.absent > 0).sort((a, b) => b.absent - a.absent);
        if (absentees.length === 0) return msg + `🎉 كل الطلاب حضروا!`;
        
        absentees.slice(0, 50).forEach((item, i) => {
          const pct = ((item.absent / periodSessions.length) * 100).toFixed(0);
          msg += `${i + 1}. ❌ ${item.student.name}`;
          if (item.student.group) msg += ` (${item.student.group})`;
          msg += `\n   🔢 ${item.student.code} | 📉 ${item.absent}/${periodSessions.length} (${pct}%)\n\n`;
        });
        if (absentees.length > 50) msg += `... و ${absentees.length - 50} آخرين\n`;
      } else {
        const presentees = studentsStats.filter(s => s.attended > 0).sort((a, b) => b.attended - a.attended);
        if (presentees.length === 0) return msg + `❌ ما حضر ولا طالب`;
        
        presentees.slice(0, 50).forEach((item, i) => {
          const pct = ((item.attended / periodSessions.length) * 100).toFixed(0);
          const icon = parseFloat(pct) >= 75 ? '✅' : parseFloat(pct) >= 50 ? '⚠️' : '🚨';
          msg += `${i + 1}. ${icon} ${item.student.name}`;
          if (item.student.group) msg += ` (${item.student.group})`;
          msg += `\n   🔢 ${item.student.code} | 📈 ${item.attended}/${periodSessions.length} (${pct}%)\n\n`;
        });
        if (presentees.length > 50) msg += `... و ${presentees.length - 50} آخرين\n`;
      }
      return msg;
    };

    if (parsed.intent === 'this_week_present') return handlePeriodQuery('this_week', false, parsed.groupName);
    if (parsed.intent === 'this_week_absent') return handlePeriodQuery('this_week', true, parsed.groupName);
    if (parsed.intent === 'last_week_present') return handlePeriodQuery('last_week', false, parsed.groupName);
    if (parsed.intent === 'last_week_absent') return handlePeriodQuery('last_week', true, parsed.groupName);
    if (parsed.intent === 'this_month_present') return handlePeriodQuery('this_month', false, parsed.groupName);
    if (parsed.intent === 'this_month_absent') return handlePeriodQuery('this_month', true, parsed.groupName);
    if (parsed.intent === 'last_month_present') return handlePeriodQuery('last_month', false, parsed.groupName);
    if (parsed.intent === 'last_month_absent') return handlePeriodQuery('last_month', true, parsed.groupName);

    // ===== يوم رقم X =====
    if ((parsed.intent === 'day_of_month_present' || parsed.intent === 'day_of_month_absent') && parsed.dayOfMonth !== undefined) {
      if (!currentStageId) return needStageMessage();
      
      const targetDay = parsed.dayOfMonth;
      const matchingSessions = sessions.filter(s => {
        const normalized = normalizeDate(s.date);
        const d = new Date(normalized);
        if (isNaN(d.getTime())) return false;
        return d.getDate() === targetDay;
      }).sort((a, b) => normalizeDate(b.date).localeCompare(normalizeDate(a.date)));
      
      if (matchingSessions.length === 0) return `📅 ما عدنا جلسة في يوم ${targetDay} من الشهر`;
      
      const session = matchingSessions[0];
      const isAbsentQuery = parsed.intent === 'day_of_month_absent';
      const presentIds = new Set(records.filter(r => r.sessionId === session.id).map(r => r.studentId));
      
      let targetStudents = parsed.groupName ? students.filter(s => s.group === parsed.groupName) : students;
      if (parsed.groupName && targetStudents.length === 0) return `🔍 ما عدنا كروب ${parsed.groupName}`;
      
      const dateFormatted = formatArabicDate(session.date);
      const groupText = parsed.groupName ? ` - كروب ${parsed.groupName}` : '';
      
      if (isAbsentQuery) {
        const absent = targetStudents.filter(s => !presentIds.has(s.id));
        if (absent.length === 0) return `🎉 ${dateFormatted}${groupText}\n\nكل الطلاب حضروا!`;
        
        let msg = `❌ الغائبين يوم ${targetDay} - ${dateFormatted}${groupText}\n`;
        msg += `📋 ${session.name}\nالعدد: ${absent.length}/${targetStudents.length}\n${'─'.repeat(30)}\n\n`;
        absent.sort((a, b) => a.name.localeCompare(b.name, 'ar')).forEach((s, i) => {
          msg += `${i + 1}. ❌ ${s.name}${s.group ? ` (${s.group})` : ''}\n`;
        });
        return msg;
      } else {
        const present = targetStudents.filter(s => presentIds.has(s.id));
        if (present.length === 0) return `❌ ${dateFormatted}${groupText}\n\nما حضر ولا طالب`;
        
        let msg = `✅ الحاضرين يوم ${targetDay} - ${dateFormatted}${groupText}\n`;
        msg += `📋 ${session.name}\nالعدد: ${present.length}/${targetStudents.length}\n${'─'.repeat(30)}\n\n`;
        present.sort((a, b) => a.name.localeCompare(b.name, 'ar')).forEach((s, i) => {
          const record = records.find(r => r.sessionId === session.id && r.studentId === s.id);
          msg += `${i + 1}. ✅ ${s.name}${s.group ? ` (${s.group})` : ''}\n`;
          if (record) msg += `   ⏰ ${record.time}\n`;
        });
        return msg;
      }
    }

    // ===== الحضور التراكمي العام =====
    if (parsed.intent === 'cumulative_present') {
      if (!currentStageId) return needStageMessage();
      if (sessions.length === 0) return `📅 ما عدنا أيام بعد`;
      
      const groupFilter = parsed.groupName;
      let targetStudents = groupFilter ? students.filter(s => s.group === groupFilter) : students;
      if (groupFilter && targetStudents.length === 0) return `🔍 ما عدنا كروب ${groupFilter}`;
      
      const studentsAttendance = targetStudents.map(s => {
        const attended = new Set(records.filter(r => r.studentId === s.id).map(r => r.sessionId)).size;
        return { student: s, attended };
      }).filter(item => item.attended > 0).sort((a, b) => b.attended - a.attended);
      
      if (studentsAttendance.length === 0) return `❌ ما حضر ولا طالب ولا مرة`;
      
      const groupText = groupFilter ? ` - كروب ${groupFilter}` : '';
      let msg = `📊 سجل الحضور التراكمي${groupText}\n📅 من ${sessions.length} يوم\n${getCurrentDateTimeHeader()}\n${'─'.repeat(30)}\n\n`;
      
      const sortedAlpha = [...studentsAttendance].sort((a, b) => a.student.name.localeCompare(b.student.name, 'ar'));
      
      sortedAlpha.slice(0, 50).forEach((item, i) => {
        const pct = ((item.attended / sessions.length) * 100).toFixed(0);
        const icon = parseFloat(pct) >= 75 ? '✅' : parseFloat(pct) >= 50 ? '⚠️' : '🚨';
        msg += `${i + 1}. ${icon} ${item.student.name}`;
        if (item.student.group) msg += ` (${item.student.group})`;
        msg += `\n   🔢 ${item.student.code} | 📈 ${item.attended}/${sessions.length} (${pct}%)\n\n`;
      });
      
      if (sortedAlpha.length > 50) msg += `... و ${sortedAlpha.length - 50} آخرين\n\n`;
      msg += `${'─'.repeat(30)}\n📊 الإجمالي: ${sortedAlpha.length} من ${targetStudents.length}`;
      return msg;
    }

    if (parsed.intent === 'cumulative_absent') {
      if (!currentStageId) return needStageMessage();
      if (sessions.length === 0) return `📅 ما عدنا أيام بعد`;
      
      const groupFilter = parsed.groupName;
      let targetStudents = groupFilter ? students.filter(s => s.group === groupFilter) : students;
      if (groupFilter && targetStudents.length === 0) return `🔍 ما عدنا كروب ${groupFilter}`;
      
      const studentsAbsence = targetStudents.map(s => {
        const attended = new Set(records.filter(r => r.studentId === s.id).map(r => r.sessionId)).size;
        return { student: s, absent: sessions.length - attended };
      }).filter(item => item.absent > 0).sort((a, b) => b.absent - a.absent);
      
      if (studentsAbsence.length === 0) return `🎉 ممتاز! ما عدنا طالب غاب`;
      
      const groupText = groupFilter ? ` - كروب ${groupFilter}` : '';
      let msg = `📊 سجل الغياب التراكمي${groupText}\n📅 من ${sessions.length} يوم\n${getCurrentDateTimeHeader()}\n${'─'.repeat(30)}\n\n`;
      
      studentsAbsence.slice(0, 50).forEach((item, i) => {
        const pct = ((item.absent / sessions.length) * 100).toFixed(0);
        const icon = parseFloat(pct) >= 50 ? '🚨' : parseFloat(pct) >= 25 ? '⚠️' : '❌';
        msg += `${i + 1}. ${icon} ${item.student.name}`;
        if (item.student.group) msg += ` (${item.student.group})`;
        msg += `\n   🔢 ${item.student.code} | 📉 ${item.absent}/${sessions.length} (${pct}%)\n\n`;
      });
      
      if (studentsAbsence.length > 50) msg += `... و ${studentsAbsence.length - 50} آخرين\n\n`;
      msg += `${'─'.repeat(30)}\n📊 الإجمالي: ${studentsAbsence.length} من ${targetStudents.length}`;
      return msg;
    }

    // ===== حضور وغياب اليوم =====
    if (parsed.intent === 'who_present_today' || parsed.intent === 'count_present_today') {
      if (!currentStageId) return needStageMessage();
      const todaySession = getTodaySession();
      if (!todaySession) return `📅 ${formatArabicDate()}\n\n❗ ما عدنا جلسة لليوم بعد`;
      
      const presentRecords = records.filter(r => r.sessionId === todaySession.id);

      if (parsed.intent === 'count_present_today') {
        const total = students.length;
        const present = presentRecords.length;
        const percent = total > 0 ? ((present / total) * 100).toFixed(1) : '0';
        return `📊 إحصائيات الحضور اليوم\n${getCurrentDateTimeHeader()}\n📋 ${todaySession.name}\n${'─'.repeat(25)}\n\n✅ الحاضرين: ${present}\n❌ الغائبين: ${total - present}\n👥 الإجمالي: ${total}\n📈 النسبة: ${percent}%`;
      }

      if (presentRecords.length === 0) return `📅 ${formatArabicDate()}\n📋 ${todaySession.name}\n\n😕 ما حضر ولا طالب لحد الحين`;

      let msg = `✅ الحاضرين اليوم (${presentRecords.length} طالب)\n${getCurrentDateTimeHeader()}\n📋 ${todaySession.name}\n${'─'.repeat(25)}\n\n`;
      const sorted = [...presentRecords].sort((a, b) => a.studentName.localeCompare(b.studentName, 'ar'));
      sorted.slice(0, 30).forEach((r, i) => {
        msg += `${i + 1}. ✅ ${r.studentName}`;
        if (r.studentGroup) msg += ` (${r.studentGroup})`;
        msg += `\n   🔢 ${r.studentCode} | ⏰ ${r.time}\n\n`;
      });
      if (sorted.length > 30) msg += `... و ${sorted.length - 30} آخرين`;
      return msg;
    }

    if (parsed.intent === 'who_absent_today' || parsed.intent === 'count_absent_today') {
      if (!currentStageId) return needStageMessage();
      const todaySession = getTodaySession();
      if (!todaySession) return `📅 ${formatArabicDate()}\n\n❗ ما عدنا جلسة لليوم بعد`;

      const presentIds = new Set(records.filter(r => r.sessionId === todaySession.id).map(r => r.studentId));
      const absentStudents = students.filter(s => !presentIds.has(s.id));

      if (parsed.intent === 'count_absent_today') {
        const percent = students.length > 0 ? ((absentStudents.length / students.length) * 100).toFixed(1) : '0';
        return `📊 إحصائيات الغياب اليوم\n${getCurrentDateTimeHeader()}\n📋 ${todaySession.name}\n${'─'.repeat(25)}\n\n❌ الغائبين: ${absentStudents.length}\n✅ الحاضرين: ${students.length - absentStudents.length}\n📉 نسبة الغياب: ${percent}%`;
      }

      if (absentStudents.length === 0) return `🎉 ممتاز!\n${getCurrentDateTimeHeader()}\n📋 ${todaySession.name}\n\nكل الطلاب حاضرين! ✅`;

      let msg = `❌ الغائبين اليوم (${absentStudents.length} طالب)\n${getCurrentDateTimeHeader()}\n📋 ${todaySession.name}\n${'─'.repeat(25)}\n\n`;
      const sorted = [...absentStudents].sort((a, b) => a.name.localeCompare(b.name, 'ar'));
      sorted.slice(0, 30).forEach((s, i) => {
        msg += `${i + 1}. ❌ ${s.name}`;
        if (s.group) msg += ` (${s.group})`;
        msg += `\n   🔢 ${s.code}\n\n`;
      });
      if (sorted.length > 30) msg += `... و ${sorted.length - 30} آخرين`;
      return msg;
    }

    // ===== حضور وغياب بتاريخ معين =====
    if ((parsed.intent === 'who_present_date' || parsed.intent === 'count_present_date') && parsed.date) {
      if (!currentStageId) return needStageMessage();
      const session = findSessionByDate(parsed.date);
      if (!session) return `📅 ما عدنا جلسة بتاريخ ${parsed.date}`;

      const presentRecords = records.filter(r => r.sessionId === session.id);
      const dateFormatted = formatArabicDate(parsed.date);
      
      if (parsed.intent === 'count_present_date') {
        const percent = students.length > 0 ? ((presentRecords.length / students.length) * 100).toFixed(1) : '0';
        return `📊 ${dateFormatted}\n📋 ${session.name}\n${'─'.repeat(25)}\n\n✅ الحاضرين: ${presentRecords.length}/${students.length}\n📈 النسبة: ${percent}%`;
      }
      
      if (presentRecords.length === 0) return `❌ ${dateFormatted}\n\nما حضر ولا طالب`;

      let msg = `✅ الحاضرين - ${dateFormatted}\n📋 ${session.name}\nالعدد: ${presentRecords.length} طالب\n${'─'.repeat(25)}\n\n`;
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
        return `📊 ${dateFormatted}\n📋 ${session.name}\n${'─'.repeat(25)}\n\n❌ الغائبين: ${absentStudents.length}/${students.length}\n📉 النسبة: ${percent}%`;
      }
      if (absentStudents.length === 0) return `🎉 ${dateFormatted}\n\nكل الطلاب حضروا!`;

      let msg = `❌ الغائبين - ${dateFormatted}\n📋 ${session.name}\nالعدد: ${absentStudents.length} طالب\n${'─'.repeat(25)}\n\n`;
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
      return `❌ ${student.name}\n${'─'.repeat(25)}\n\n🔢 ${student.code}\n📊 الغياب: ${absent}/${total}\n📉 النسبة: ${pct}%`;
    }

    if (parsed.intent === 'student_attendance_count') {
      const student = allStudents.find(s => s.name === parsed.studentName);
      if (!student) return `🔍 ما لكيت الطالب`;
      const attended = new Set(allRecords.filter(r => r.studentId === student.id).map(r => r.sessionId)).size;
      const total = allSessions.length;
      const pct = total > 0 ? ((attended / total) * 100).toFixed(1) : '0';
      return `✅ ${student.name}\n${'─'.repeat(25)}\n\n🔢 ${student.code}\n📊 الحضور: ${attended}/${total}\n📈 النسبة: ${pct}%`;
    }

    // ===== الترتيب =====
    if (parsed.intent === 'top_absent') {
      if (!currentStageId) return needStageMessage();
      if (sessions.length === 0) return `📅 ما عدنا أيام بعد`;
      const limit = parsed.number || 5;
      const ranking = students.map(s => {
        const attended = new Set(records.filter(r => r.studentId === s.id).map(r => r.sessionId)).size;
        return { student: s, absent: sessions.length - attended };
      }).filter(x => x.absent > 0).sort((a, b) => b.absent - a.absent).slice(0, limit);

      if (ranking.length === 0) return `🎉 ممتاز! كل الطلاب منتظمين!`;
      let msg = `📊 أكثر ${ranking.length} طلاب غياباً:\n${'─'.repeat(25)}\n\n`;
      ranking.forEach((item, i) => {
        const pct = ((item.absent / sessions.length) * 100).toFixed(0);
        msg += `${i + 1}. ❌ ${item.student.name}\n   🔢 ${item.student.code} | 👥 ${item.student.group || '-'}\n   📉 ${item.absent}/${sessions.length} (${pct}%)\n\n`;
      });
      return msg;
    }

    if (parsed.intent === 'top_present' || parsed.intent === 'best_students') {
      if (!currentStageId) return needStageMessage();
      if (sessions.length === 0) return `📅 ما عدنا أيام بعد`;
      const limit = parsed.number || 5;
      const ranking = students.map(s => ({
        student: s,
        attended: new Set(records.filter(r => r.studentId === s.id).map(r => r.sessionId)).size,
      })).sort((a, b) => b.attended - a.attended).slice(0, limit);

      let msg = `🏆 أكثر ${ranking.length} طلاب انتظاماً:\n${'─'.repeat(25)}\n\n`;
      ranking.forEach((item, i) => {
        const pct = ((item.attended / sessions.length) * 100).toFixed(0);
        msg += `${i + 1}. ✅ ${item.student.name}\n   🔢 ${item.student.code} | 👥 ${item.student.group || '-'}\n   📈 ${item.attended}/${sessions.length} (${pct}%)\n\n`;
      });
      return msg;
    }

    if (parsed.intent === 'worst_students') {
      if (!currentStageId) return needStageMessage();
      if (sessions.length === 0) return `📅 ما عدنا أيام بعد`;
      const limit = parsed.number || 5;
      const ranking = students.map(s => ({
        student: s,
        attended: new Set(records.filter(r => r.studentId === s.id).map(r => r.sessionId)).size,
      })).sort((a, b) => a.attended - b.attended).slice(0, limit);

      let msg = `📉 أقل ${ranking.length} طلاب حضوراً:\n${'─'.repeat(25)}\n\n`;
      ranking.forEach((item, i) => {
        const pct = ((item.attended / sessions.length) * 100).toFixed(0);
        msg += `${i + 1}. ❌ ${item.student.name}\n   🔢 ${item.student.code} | 👥 ${item.student.group || '-'}\n   📉 ${item.attended}/${sessions.length} (${pct}%)\n\n`;
      });
      return msg;
    }

    if (parsed.intent === 'never_absent') {
      if (!currentStageId) return needStageMessage();
      if (sessions.length === 0) return `📅 ما عدنا أيام بعد`;
      const perfect = students.filter(s =>
        new Set(records.filter(r => r.studentId === s.id).map(r => r.sessionId)).size === sessions.length
      );
      if (perfect.length === 0) return `😕 ما عدنا طالب بحضور كامل`;

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
      if (noAttendance.length === 0) return `✅ كل الطلاب حضروا على الأقل مرة`;

      let msg = `🚨 طلاب ما حضروا ولا مرة (${noAttendance.length})\n${'─'.repeat(25)}\n\n`;
      noAttendance.sort((a, b) => a.name.localeCompare(b.name, 'ar')).slice(0, 30).forEach((s, i) => {
        msg += `${i + 1}. ❌ ${s.name}${s.group ? ` (${s.group})` : ''}\n   🔢 ${s.code}\n`;
      });
      if (noAttendance.length > 30) msg += `\n... و ${noAttendance.length - 30} آخرين`;
      return msg;
    }

    // ===== البحث المتقدم =====
    if (parsed.intent === 'advanced_search_absent' && parsed.number !== undefined) {
      if (!currentStageId) return needStageMessage();
      if (sessions.length === 0) return `📅 ما عدنا أيام بعد`;
      
      const threshold = parsed.number;
      const isMore = parsed.studentCode === 'more';
      const groupFilter = parsed.groupName;
      
      let targetStudents = groupFilter ? students.filter(s => s.group === groupFilter) : students;
      if (groupFilter && targetStudents.length === 0) return `🔍 ما عدنا كروب ${groupFilter}`;
      
      const results = targetStudents.map(s => {
        const attended = new Set(records.filter(r => r.studentId === s.id).map(r => r.sessionId)).size;
        return { student: s, absent: sessions.length - attended, attended };
      });
      
      const filtered = isMore 
        ? results.filter(r => r.absent > threshold)
        : results.filter(r => r.absent < threshold && r.absent > 0);
      
      if (filtered.length === 0) {
        const condition = isMore ? `أكثر من ${threshold}` : `أقل من ${threshold}`;
        return `✅ ما عدنا طلاب غابوا ${condition} يوم`;
      }
      
      filtered.sort((a, b) => b.absent - a.absent);
      const condition = isMore ? `أكثر من ${threshold}` : `أقل من ${threshold}`;
      const groupText = groupFilter ? ` - كروب ${groupFilter}` : '';
      
      let msg = `🔍 بحث متقدم${groupText}\n📊 طلاب غابوا ${condition} يوم (${filtered.length})\n${'─'.repeat(30)}\n\n`;
      filtered.slice(0, 30).forEach((item, i) => {
        const pct = ((item.absent / sessions.length) * 100).toFixed(0);
        msg += `${i + 1}. ❌ ${item.student.name}\n   🔢 ${item.student.code}`;
        if (item.student.group) msg += ` | 👥 ${item.student.group}`;
        msg += `\n   📉 ${item.absent}/${sessions.length} (${pct}%)\n\n`;
      });
      if (filtered.length > 30) msg += `... و ${filtered.length - 30} آخرين\n`;
      return msg;
    }

    if (parsed.intent === 'advanced_search_present' && parsed.number !== undefined) {
      if (!currentStageId) return needStageMessage();
      if (sessions.length === 0) return `📅 ما عدنا أيام بعد`;
      
      const threshold = parsed.number;
      const isMore = parsed.studentCode === 'more';
      const groupFilter = parsed.groupName;
      
      let targetStudents = groupFilter ? students.filter(s => s.group === groupFilter) : students;
      if (groupFilter && targetStudents.length === 0) return `🔍 ما عدنا كروب ${groupFilter}`;
      
      const results = targetStudents.map(s => {
        const attended = new Set(records.filter(r => r.studentId === s.id).map(r => r.sessionId)).size;
        return { student: s, attended };
      });
      
      const filtered = isMore 
        ? results.filter(r => r.attended > threshold)
        : results.filter(r => r.attended < threshold);
      
      if (filtered.length === 0) {
        const condition = isMore ? `أكثر من ${threshold}` : `أقل من ${threshold}`;
        return `🔍 ما عدنا طلاب حضروا ${condition} يوم`;
      }
      
      filtered.sort((a, b) => isMore ? b.attended - a.attended : a.attended - b.attended);
      const condition = isMore ? `أكثر من ${threshold}` : `أقل من ${threshold}`;
      const groupText = groupFilter ? ` - كروب ${groupFilter}` : '';
      
      let msg = `🔍 بحث متقدم${groupText}\n${isMore ? '🏆' : '⚠️'} طلاب حضروا ${condition} يوم (${filtered.length})\n${'─'.repeat(30)}\n\n`;
      filtered.slice(0, 30).forEach((item, i) => {
        const pct = ((item.attended / sessions.length) * 100).toFixed(0);
        msg += `${i + 1}. ${isMore ? '✅' : '❌'} ${item.student.name}\n   🔢 ${item.student.code}`;
        if (item.student.group) msg += ` | 👥 ${item.student.group}`;
        msg += `\n   📈 ${item.attended}/${sessions.length} (${pct}%)\n\n`;
      });
      if (filtered.length > 30) msg += `... و ${filtered.length - 30} آخرين\n`;
      return msg;
    }

    // ===== الطلاب والكروبات =====
    if (parsed.intent === 'students_count') {
      if (!currentStageId) return needStageMessage();
      const groups = new Set(students.map(s => s.group).filter(Boolean)).size;
      return `👥 ${currentStage?.name}\n${'─'.repeat(25)}\n\n📊 عدد الطلاب: ${students.length}\n🏷️ الكروبات: ${groups}\n📅 أيام مسجلة: ${sessions.length}\n📝 سجلات حضور: ${records.length}`;
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

    if (parsed.intent === 'group_count' || parsed.intent === 'groups_list') {
      if (!currentStageId) return needStageMessage();
      const groups = Array.from(new Set(students.map(s => s.group).filter(Boolean))) as string[];
      if (groups.length === 0) return `🏷️ ما عدنا كروبات`;
      groups.sort();
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
      return `🏷️ كروب ${parsed.groupName}\n${'─'.repeat(25)}\n\n👥 عدد الطلاب: ${groupStudents.length}\n📝 سجلات: ${groupRecords.length}\n📈 المعدل: ${rate}%`;
    }

    if (parsed.intent === 'group_attendance' && parsed.groupName) {
      if (!currentStageId) return needStageMessage();
      const groupStudents = students.filter(s => s.group === parsed.groupName);
      if (groupStudents.length === 0) return `🔍 ما عدنا كروب ${parsed.groupName}`;
      if (sessions.length === 0) return `📅 ما عدنا أيام`;
      let msg = `📊 حضور كروب ${parsed.groupName}\n${'─'.repeat(25)}\n\n`;
      groupStudents.sort((a, b) => a.name.localeCompare(b.name, 'ar')).forEach((s, i) => {
        const attended = new Set(records.filter(r => r.studentId === s.id).map(r => r.sessionId)).size;
        const pct = ((attended / sessions.length) * 100).toFixed(0);
        const icon = parseFloat(pct) >= 75 ? '✅' : parseFloat(pct) >= 50 ? '⚠️' : '❌';
        msg += `${i + 1}. ${icon} ${s.name}\n   ${attended}/${sessions.length} (${pct}%)\n\n`;
      });
      return msg;
    }

    if ((parsed.intent === 'specific_group_present' || parsed.intent === 'specific_group_absent') && parsed.groupName) {
      if (!currentStageId) return needStageMessage();
      const todaySession = getTodaySession();
      if (!todaySession) return `📅 ${formatArabicDate()}\n\n❗ ما عدنا جلسة لليوم`;
      const groupStudents = students.filter(s => s.group === parsed.groupName);
      if (groupStudents.length === 0) return `🔍 كروب ${parsed.groupName} ما موجود`;
      const presentIds = new Set(records.filter(r => r.sessionId === todaySession.id).map(r => r.studentId));

      if (parsed.intent === 'specific_group_present') {
        const present = groupStudents.filter(s => presentIds.has(s.id));
        if (present.length === 0) return `❌ ما حضر ولا طالب من كروب ${parsed.groupName} اليوم`;
        let msg = `✅ الحاضرين من كروب ${parsed.groupName}\nالعدد: ${present.length}/${groupStudents.length}\n${getCurrentDateTimeHeader()}\n${'─'.repeat(25)}\n\n`;
        present.forEach((s, i) => { msg += `${i + 1}. ✅ ${s.name}\n`; });
        return msg;
      } else {
        const absent = groupStudents.filter(s => !presentIds.has(s.id));
        if (absent.length === 0) return `🎉 كل طلاب كروب ${parsed.groupName} حاضرين!`;
        let msg = `❌ الغائبين من كروب ${parsed.groupName}\nالعدد: ${absent.length}/${groupStudents.length}\n${getCurrentDateTimeHeader()}\n${'─'.repeat(25)}\n\n`;
        absent.forEach((s, i) => { msg += `${i + 1}. ❌ ${s.name}\n`; });
        return msg;
      }
    }

    // ===== الجلسات =====
    if (parsed.intent === 'session_count' || parsed.intent === 'session_list') {
      if (!currentStageId) return needStageMessage();
      if (sessions.length === 0) return `📅 ما عدنا أيام`;
      const sorted = [...sessions].sort((a, b) => normalizeDate(b.date).localeCompare(normalizeDate(a.date)));
      let msg = `📅 الأيام المسجلة (${sessions.length})\n${'─'.repeat(25)}\n\n`;
      sorted.slice(0, 15).forEach((s, i) => {
        const presentCount = records.filter(r => r.sessionId === s.id).length;
        msg += `${i + 1}. ${s.name}\n   📌 ${formatArabicDate(s.date)}\n   ✅ ${presentCount} حاضر\n\n`;
      });
      if (sorted.length > 15) msg += `... و ${sorted.length - 15} آخرين`;
      return msg;
    }

    if (parsed.intent === 'session_today') {
      if (!currentStageId) return needStageMessage();
      const todaySession = getTodaySession();
      if (!todaySession) return `📅 ${formatArabicDate()}\n\n❗ ما عدنا جلسة لليوم`;
      const present = records.filter(r => r.sessionId === todaySession.id).length;
      return `📅 جلسة اليوم: ${todaySession.name}\n${getCurrentDateTimeHeader()}\n${'─'.repeat(25)}\n\n✅ الحاضرين: ${present}/${students.length}\n❌ الغائبين: ${students.length - present}\n📈 النسبة: ${students.length > 0 ? ((present / students.length) * 100).toFixed(1) : 0}%`;
    }

    if (parsed.intent === 'last_session') {
      if (sessions.length === 0) return `📅 ما عدنا جلسات`;
      const last = [...sessions].sort((a, b) => normalizeDate(b.date).localeCompare(normalizeDate(a.date)))[0];
      const present = records.filter(r => r.sessionId === last.id).length;
      return `📅 آخر جلسة: ${last.name}\n${'─'.repeat(25)}\n\n📌 ${formatArabicDate(last.date)}\n✅ الحاضرين: ${present}/${students.length}\n📈 النسبة: ${students.length > 0 ? ((present / students.length) * 100).toFixed(1) : 0}%`;
    }

    if (parsed.intent === 'first_session') {
      if (sessions.length === 0) return `📅 ما عدنا جلسات`;
      const first = [...sessions].sort((a, b) => normalizeDate(a.date).localeCompare(normalizeDate(b.date)))[0];
      return `📅 أول جلسة: ${first.name}\n${'─'.repeat(25)}\n\n📌 ${formatArabicDate(first.date)}`;
    }

    // ===== النسب =====
    if (parsed.intent === 'attendance_rate') {
      if (!currentStageId) return needStageMessage();
      if (sessions.length === 0 || students.length === 0) return `📊 ما نكدر نحسب`;
      const possible = sessions.length * students.length;
      const pct = ((records.length / possible) * 100).toFixed(2);
      return `📈 نسبة الحضور العامة\n${'─'.repeat(25)}\n\n✅ ${pct}%\n\n📊 ${records.length}/${possible}\n👥 ${students.length} × ${sessions.length}`;
    }

    if (parsed.intent === 'absence_rate') {
      if (!currentStageId) return needStageMessage();
      if (sessions.length === 0 || students.length === 0) return `📊 ما نكدر نحسب`;
      const possible = sessions.length * students.length;
      const absent = possible - records.length;
      const pct = ((absent / possible) * 100).toFixed(2);
      return `📉 نسبة الغياب العامة\n${'─'.repeat(25)}\n\n❌ ${pct}%\n\n📊 ${absent}/${possible}`;
    }

    if (parsed.intent === 'average_attendance') {
      if (!currentStageId) return needStageMessage();
      if (sessions.length === 0) return `📊 ما عدنا أيام`;
      return `📊 المتوسطات\n${'─'.repeat(25)}\n\n📅 متوسط الطالب: ${students.length > 0 ? (records.length / students.length).toFixed(1) : '0'} يوم\n👥 متوسط اليوم: ${(records.length / sessions.length).toFixed(1)} طالب`;
    }

    // ===== الكليات والمراحل =====
    if (parsed.intent === 'colleges_count' || parsed.intent === 'colleges_list') {
      const list = isAdmin ? colleges : accessibleColleges;
      if (list.length === 0) return `🏛️ ما عدنا كليات`;
      let msg = `🏛️ الكليات: ${list.length}\n${'─'.repeat(25)}\n\n`;
      list.forEach((c, i) => {
        const sCount = (isAdmin ? stages : accessibleStages).filter(s => s.collegeId === c.id).length;
        msg += `${i + 1}. ${c.icon || '🏛️'} ${c.name} (${sCount} مرحلة)\n`;
      });
      return msg;
    }

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
      if (allTeachers.length === 0) return `👨‍🏫 لإدارة التدريسيين، روح لتبويب "إدارة التدريسيين"`;
      return `👨‍🏫 عدد التدريسيين: ${allTeachers.length}`;
    }

    if (parsed.intent === 'teachers_list' || parsed.intent === 'teachers_info') {
      if (allTeachers.length === 0) return `👨‍🏫 روح لتبويب "إدارة التدريسيين"`;
      let msg = `👨‍🏫 قائمة التدريسيين (${allTeachers.length})\n${'─'.repeat(25)}\n\n`;
      allTeachers.forEach((t, i) => {
        const allowedCount = Object.values(t.permissions?.allowedStages || {}).flat().length;
        msg += `${i + 1}. ${t.displayName}\n   📧 ${t.email}\n   📖 ${allowedCount} مرحلة\n\n`;
      });
      return msg;
    }

    // ===== الإرشادات =====
    if (parsed.intent === 'how_to_add_student') return `➕ إضافة طالب\n${'─'.repeat(25)}\n\n1️⃣ افتح المرحلة\n2️⃣ تبويب "إدارة الطلاب"\n3️⃣ يدوياً أو من Excel`;
    if (parsed.intent === 'how_to_add_college') return `🏛️ إضافة كلية\n${'─'.repeat(25)}\n\n1️⃣ تبويب "إدارة الكليات"\n2️⃣ "إضافة كلية"`;
    if (parsed.intent === 'how_to_add_teacher') return `👨‍🏫 إضافة تدريسي\n${'─'.repeat(25)}\n\n1️⃣ تبويب "إدارة التدريسيين"\n2️⃣ "إضافة تدريسي جديد"`;
    if (parsed.intent === 'how_to_add_stage') return `📖 إضافة مرحلة\n${'─'.repeat(25)}\n\n1️⃣ تبويب "إدارة الكليات"\n2️⃣ افتح الكلية\n3️⃣ "إضافة مرحلة"`;
    if (parsed.intent === 'how_to_take_attendance') return `📝 تسجيل الحضور\n${'─'.repeat(25)}\n\n1️⃣ افتح المرحلة\n2️⃣ "السجلات" → جلسة جديدة\n3️⃣ "تسجيل الحضور"`;
    if (parsed.intent === 'how_to_export') return `📥 تصدير السجلات\n${'─'.repeat(25)}\n\n1️⃣ تبويب "سجل الحضور"\n2️⃣ اختر المدة\n3️⃣ "تحميل كشف الحضور"`;
    if (parsed.intent === 'how_to_delete') return `🗑️ الحذف\n${'─'.repeat(25)}\n\n• طالب: "إدارة الطلاب"\n• كلية: زر 🗑️\n⚠️ نهائي!`;
    if (parsed.intent === 'how_to_login') return `🔐 الدخول\n${'─'.repeat(25)}\n\nبريد إلكتروني + كلمة مرور`;

    if (parsed.intent === 'records_count') {
      if (!currentStageId) return needStageMessage();
      return `📝 السجلات\n${'─'.repeat(25)}\n\n📊 ${records.length} سجل\n📅 ${sessions.length} يوم\n👥 ${students.length} طالب`;
    }

    if (parsed.intent === 'general_stats') {
      let msg = `📊 ملخص شامل\n${getCurrentDateTimeHeader()}\n${'─'.repeat(25)}\n\n`;
      msg += isAdmin
        ? `🏛️ الكليات: ${colleges.length}\n📖 المراحل: ${stages.length}\n👨‍🏫 التدريسيين: ${allTeachers.length}\n👥 الطلاب: ${allStudents.length}\n`
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
          msg += `\n\n📅 اليوم:\n   📋 ${todaySession.name}\n   ✅ ${presentToday}\n   ❌ ${students.length - presentToday}`;
        }
      }
      return msg;
    }

    if (parsed.intent === 'help') return getHelpMessage();

    if (parsed.intent === 'unknown') {
      return (
        '🤖 ما فهمت السؤال بالضبط، بس أكدر أساعدك بهذي:\n\n' +
        '📊 الحضور والغياب:\n' +
        '• منو حاضر اليوم\n' +
        '• منو غاب الاسبوع الماضي\n' +
        '• منو حضر يوم 10\n\n' +
        '👤 طلاب:\n' +
        '• حضور احمد لكل الايام\n' +
        '• مجموع غياب علي\n\n' +
        '🏷️ كروبات:\n' +
        '• حضور كروب A1 من اول يوم\n' +
        '• مجموع حضور كروب B2\n\n' +
        '📊 المجاميع:\n' +
        '• مجموع الحضور الكلي\n' +
        '• الحضور من اول يوم'
      );
    }

    return getHelpMessage();
  }, [
    isAdmin, user.displayName, currentStageId, currentStage,
    students, records, sessions, colleges, stages,
    accessibleColleges, accessibleStages,
    allStudents, allRecords, allSessions, allTeachers,
    getTodaySession, findSessionByDate, findSessionsInRange, needStageMessage,
    formatStudentInfo, formatStudentFullRecord, getHelpMessage,
  ]);

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

  const quickQuestions = isAdmin
    ? ['منو غايب اليوم', 'الحاضرين من اول يوم', 'مجموع الحضور', 'حضور الاسبوع الماضي']
    : ['منو غايب اليوم', 'الحاضرين من اول يوم', 'كم طالب موجود', 'منو اكثر طالب غياب'];

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