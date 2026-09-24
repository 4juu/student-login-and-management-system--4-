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
import { MorphPanel } from './MorphPanel';
import { ArrowUp, ChevronLeft, CircleCheck, CircleX, ClipboardList, MessageCircle, Mic, Search, Sparkles, Square } from 'lucide-react';
import { normalizeArabic } from '../services/nameMatching';

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
      return `${ymdMatch[1] ?? ''}-${pad2(parseInt(ymdMatch[2] ?? '1'))}-${pad2(parseInt(ymdMatch[3] ?? '1'))}`;
    }
    const dmyMatch = text.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
    if (dmyMatch && (dmyMatch[3] ?? '').length === 4) {
      return `${dmyMatch[3] ?? ''}-${pad2(parseInt(dmyMatch[2] ?? '1'))}-${pad2(parseInt(dmyMatch[1] ?? '1'))}`;
    }
    const dateObj = new Date(text);
    if (!isNaN(dateObj.getTime())) {
      return `${dateObj.getFullYear()}-${pad2(dateObj.getMonth() + 1)}-${pad2(dateObj.getDate())}`;
    }
    return '';
  } catch {
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
  return `${days[d.getDay()] ?? ''} ${d.getDate()} ${months[d.getMonth()] ?? ''} ${d.getFullYear()}`;
};

// ─────────────────────────────────────────────────────────────
// مطابقة أسماء الطلاب — تسجيل حسب الدقة
// ─────────────────────────────────────────────────────────────
const scoreStudentMatch = (q: string, student: Student): number => {
  const ql = q.toLowerCase().trim();
  if (!ql) return 0;
  const nameL = (student.name || '').toLowerCase();
  const codeL = (student.code || '').toLowerCase();
  const groupL = (student.group || '').toLowerCase();

  const qN = normalizeArabic(ql);
  const nameN = normalizeArabic(nameL);

  let score = 0;
  if (qN === nameN) score += 250;
  else if (qN.includes(nameN)) score += 200;
  if (nameN.includes(qN) && nameN.length < 60) score += 100;
  if (codeL && (ql.includes(codeL) || codeL.includes(ql))) score += 50;
  if (groupL && groupL.includes(ql)) score += 20;
  const nameWords = nameL.split(/\s+/).filter(w => normalizeArabic(w).length > 2);
  score += nameWords.filter(w => qN.includes(normalizeArabic(w))).length * 15;
  return score;
};

const pickBestStudentMatch = (q: string, students: Student[]): Student | null => {
  const ql = q.toLowerCase().trim();
  if (!ql || !students.length) return null;
  const qN = normalizeArabic(ql);
  let best: Student | null = null;
  let bestScore = 0;
  for (const s of students) {
    const nameL = (s.name || '').toLowerCase();
    const nameN = normalizeArabic(nameL);
    const codeL = (s.code || '').toLowerCase();
    const firstName = normalizeArabic(nameL.split(' ')[0] ?? '');
    const basicMatch =
      (nameN && qN.includes(nameN)) ||
      (firstName.length > 2 && qN.includes(firstName)) ||
      (codeL && ql.includes(codeL));
    if (!basicMatch) continue;
    const sc = scoreStudentMatch(q, s);
    if (sc > bestScore) {
      bestScore = sc;
      best = s;
    }
  }
  return best;
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
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const [isListening, setIsListening] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [voiceSupported] = useState(() =>
    typeof window !== 'undefined' && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition),
  );
  const recognitionRef = useRef<any>(null);
  const recognitionLangIndex = useRef(0);
  const lastTranscriptRef = useRef('');
  const manualStopRef = useRef(false);

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
      if ((numbers[i] ?? '').length === 4) { yearIdx = i; break; }
    }
    let year = '', month = '', day = '';
    if (yearIdx === 0) { year = numbers[0] ?? ''; month = numbers[1] ?? ''; day = numbers[2] ?? ''; }
    else if (yearIdx === 2) { day = numbers[0] ?? ''; month = numbers[1] ?? ''; year = numbers[2] ?? ''; }
    else if (yearIdx === 1) { month = numbers[0] ?? ''; year = numbers[1] ?? ''; day = numbers[2] ?? ''; }
    else { year = numbers[0] ?? ''; month = numbers[1] ?? ''; day = numbers[2] ?? ''; }
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

    const todaySessionIds = new Set<string>();
    fixedSessions.forEach(s => { if (s._normalizedDate === todayKey) todaySessionIds.add(s.id); });
    const isPresentToday = studentRecords.some(r => r.status === 'present' && todaySessionIds.has(r.sessionId));
    const isAbsentToday = studentRecords.some(r => r.status === 'absent' && todaySessionIds.has(r.sessionId));

    // الحضور = السجلات اللي عليها حضور، الغياب = بقية السجلات
    const attendedCount = sortedSessions.filter(s => presentSessionIds.has(s.id)).length;
    const absentCount = sortedSessions.length - attendedCount;
    const percentage = sortedSessions.length > 0
      ? ((attendedCount / sortedSessions.length) * 100).toFixed(1)
      : '0';

    const attendedSessions = sortedSessions.map(s => ({
      session: s,
      present: presentSessionIds.has(s.id),
      absent: !presentSessionIds.has(s.id),
    }));

    const attendedDateMap = new Map<string, number>();
    const absentDateMap = new Map<string, number>();
    sortedSessions.forEach(s => {
      const d = s._normalizedDate;
      if (!d) return;
      if (presentSessionIds.has(s.id)) attendedDateMap.set(d, (attendedDateMap.get(d) || 0) + 1);
      else absentDateMap.set(d, (absentDateMap.get(d) || 0) + 1);
    });
    const attendedDays = [...attendedDateMap.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([date, count]) => ({
      date,
      label: formatDateWithDay(date),
      count,
    }));
    const absentDays = [...absentDateMap.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([date, count]) => ({
      date,
      label: formatDateWithDay(date),
      count,
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
    const matches = scope.students
      .map(s => ({ s, score: scoreStudentMatch(q, s) }))
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 15)
      .map(x => x.s);

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
    if (!isOpen) return;
    const timer = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, [isOpen]);

  // 🚀 محرك الرد المحلي — يعمل 100% بدون API (يقرأ من قاعدة البيانات مباشرة)
  const buildLocalReply = useCallback((question: string): { handled: boolean; text: string } => {
    const q = question.trim();
    const todayKey = fixDate(new Date());
    const scStudents = scope.students;
    const scRecords = scope.records;
    const scSessions = scope.sessions;

    const fixedSessions = scSessions.map(s => ({ ...s, _normalizedDate: fixDate((s as any).date) }));

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
    const bestStudent = pickBestStudentMatch(q, scStudents);
    if (bestStudent) {
      const student = bestStudent;

      const sRecs = scRecords.filter(r => r.studentId === student.id);
      const presentSessionIds = new Set(sRecs.filter(r => r.status === 'present').map(r => r.sessionId));

      let todayStatus = '';
      if (todaySessions.length === 0) todayStatus = 'لا توجد محاضرات اليوم';
      else if (todayPresentIds.has(student.id)) todayStatus = '✅ حاضر';
      else if (todayAbsentIds.has(student.id)) todayStatus = '❌ غائب';
      else todayStatus = 'غير مسجل اليوم';

      // كل السجلات بأسمائها الفعلية (حاضر / غائب)
      const allSessions = [...fixedSessions].sort((a, b) => {
        if (a._normalizedDate !== b._normalizedDate) return a._normalizedDate.localeCompare(b._normalizedDate);
        return String(a.name || '').localeCompare(String(b.name || ''), 'ar');
      });

      // الغياب = كل سجل ما عليه حضور
      const attendedCount = allSessions.filter(s => presentSessionIds.has(s.id)).length;
      const absentCount = allSessions.length - attendedCount;
      const pct = allSessions.length > 0 ? ((attendedCount / allSessions.length) * 100).toFixed(1) : '0';

      let text = `📋 الطالب: **${student.name}**\n`;
      text += `🆔 الكود: ${student.code || '-'} | كروب: ${student.group || '-'}\n`;
      text += `📅 اليوم: ${todayStatus}\n\n`;
      text += `📅 كل السجلات (${allSessions.length}):\n`;
      if (allSessions.length === 0) text += `  لا يوجد\n`;
      allSessions.forEach(s => {
        const isPresent = presentSessionIds.has(s.id);
        const mark = isPresent ? '✅' : '❌';
        const state = isPresent ? 'حاضر' : 'غائب';
        text += `  ${mark} ${s.name || 'سجل بدون اسم'} — ${formatDateWithDay(s._normalizedDate)} (${state})\n`;
      });
      text += `\n📊 النسبة: **${pct}%**\n`;
      text += `✅ الحضور: ${attendedCount} سجل\n`;
      text += `❌ الغياب: ${absentCount} سجل`;
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
      text: `🤖 أعمل حالياً بدون مفاتيح AI وأقدر أساعدك بـ:\n` +
        `  • اكتب اسم الطالب أو رقمه (الكود) → أيام حضوره وغيابه ${example}\n` +
        `  • اسأل "منو حضر اليوم؟" → حضور اليوم فقط\n` +
        `  • اسأل "منو غاب اليوم؟" → غياب اليوم فقط\n` +
        `  • اسأل "إحصائيات اليوم"`,
    };
  }, [scope, fixDate]);

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
    if (inputRef.current) inputRef.current.style.height = '40px';

    // الرد المحلي — يعمل 100% بدون أي API خارجي
    setIsTyping(true);
    setTimeout(() => {
      const local = buildLocalReply(text.trim());
      setMessages(prev => [...prev, { id: `${Date.now()}_bot`, type: 'bot', content: local.text, timestamp: new Date() }]);
      setIsTyping(false);
    }, 150);
  }, [isTyping, buildLocalReply]);

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

      {/* 📄 نافذة الشات — أنيميشن انسحاب الورقة */}
      {isOpen && (
        <div
          key="chat-window"
          className="fixed bottom-3 right-3 sm:bottom-6 sm:right-6 z-50 overflow-hidden border border-white/10 shadow-2xl max-w-[calc(100vw-1.5rem)] sm:max-w-[calc(100vw-3rem)] h-[min(560px,calc(100vh-3rem))] max-h-[calc(100vh-3rem)] overscroll-contain animate-modalUp"
          style={{ backgroundColor: '#0f172a' }}
          onKeyDown={e => { e.stopPropagation(); }}
          onKeyUp={e => { e.stopPropagation(); }}
        >
          <div className="flex flex-col h-full animate-fadeIn" style={{ animationDelay: '0.12s' }}>
              {/* شريط علوي: زر الإغلاق (يمين) مع خط فاصل تحته */}
              <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-white/10">
                <span className="text-xs text-slate-400 font-medium">المساعد الذكي</span>
                <button
                  onClick={() => setIsOpen(false)}
                  className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-red-500/20 text-red-400 hover:text-red-300 text-sm transition"
                >
                  ✕
                </button>
              </div>

              {/* ✅ شريط البحث — يظهر دائماً */}
              {students.length > 0 && (
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
                              onClick={() => { setStudentSearchQuery(''); setStudentSuggestions([]); setShowSuggestions(false); setShowStudentCard(false); setSelectedStudentCard(null); }}
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
                              onClick={() => { setShowStudentCard(false); setSelectedStudentCard(null); setStudentSearchQuery(''); }}
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
                <div className="px-3 py-2 bg-red-500/10 border-t border-red-500/30">
                  <p className="text-xs text-red-300 flex items-center gap-1.5"><CircleX className="w-3.5 h-3.5 shrink-0" /> {error}</p>
                </div>
              )}

              {/* ⌨️ منطقة الإدخال */}
              {(() => {
                const isInputBlocked = !isAdmin && !currentStageId;
                return (
                  <div className="border-t border-white/10" style={{ backgroundColor: '#0f172a' }}>
                    {!isTyping && !isInputBlocked && messages.length > 0 && (
                      <div className="px-3 pt-2 pb-0 flex flex-wrap gap-1.5">
                        <button
                          onClick={() => sendMessage('منو حضر اليوم؟')}
                          className="text-[11px] font-medium text-slate-300 bg-white/5 hover:bg-white/10 border border-white/10 rounded-full px-3 py-1.5 transition"
                        >
                          ✅ منو حضر اليوم؟
                        </button>
                        <button
                          onClick={() => sendMessage('منو غاب اليوم؟')}
                          className="text-[11px] font-medium text-slate-300 bg-white/5 hover:bg-white/10 border border-white/10 rounded-full px-3 py-1.5 transition"
                        >
                          ❌ منو غاب اليوم؟
                        </button>
                        <button
                          onClick={() => sendMessage('إحصائيات اليوم')}
                          className="text-[11px] font-medium text-slate-300 bg-white/5 hover:bg-white/10 border border-white/10 rounded-full px-3 py-1.5 transition"
                        >
                          📊 إحصائيات اليوم
                        </button>
                      </div>
                    )}
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
