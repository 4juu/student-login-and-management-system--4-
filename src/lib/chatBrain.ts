// محرك ردود المحادثة — دوال نقية 100% بلا React
// (كان موزعاً داخل SmartChatBot.tsx — فُصلت هنا لسهولة الاختبار وإعادة الاستعمال)
import type { Student, AttendanceRecord, AttendanceSession } from '../types/student';
import { normalizeArabic } from '../services/nameMatching';
import { formatDateWithDay } from './date';

/** نطاق البيانات الذي يرى المحادثة (المرحلة الحالية أو كل المAccessible للإدارة) */
export interface ChatScope {
  students: Student[];
  records: AttendanceRecord[];
  sessions: AttendanceSession[];
}

export interface StudentQuickCard {
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

// ─────────────────────────────────────────────────────────────
// مطابقة أسماء الطلاب — تسجيل حسب الدقة
// ─────────────────────────────────────────────────────────────

// أفعال البحث الصريحة تسمح بالمطابقة الجزئية الضعيفة (مثال: "اسأل عن ايات")
const SEARCH_VERB_RE = /ابحث|بحث|اسأل|اسال|من هو|مين|شكد|وين|search|show|find/i;

// سياق تاريخي — يمنع اعتبار أرقام التواريخ كوداً لطالب (مثال: "...24 أغسطس 2026" لا تطابق كود 2026)
const DATE_CONTEXT_RE =
  /يناير|فبراير|مارس|أبريل|ابريل|مايو|يونيو|يوليو|أغسطس|اغسطس|سبتمبر|أكتوبر|اكتوبر|نوفمبر|ديسمبر|(?:يوم|تاريخ|بتاريخ)\s*\d|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}/i;

// الحد الأدنى لنقاط المطابقة (تطابق كلمة واحدة داخل الاسم = 15 نقطة فقط)
const MIN_STUDENT_SCORE = 25;

const hasDateContext = (text: string): boolean => DATE_CONTEXT_RE.test(text);

export const scoreStudentMatch = (q: string, student: Student): number => {
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
  if (codeL && !hasDateContext(ql) && (ql.includes(codeL) || codeL.includes(ql))) score += 50;
  if (groupL && groupL.includes(ql)) score += 20;
  const nameWords = nameL.split(/\s+/).filter(w => normalizeArabic(w).length > 2);
  score += nameWords.filter(w => qN.includes(normalizeArabic(w))).length * 15;
  return score;
};

export const pickBestStudentMatch = (q: string, students: Student[]): Student | null => {
  const ql = q.toLowerCase().trim();
  if (!ql || !students.length) return null;
  const qN = normalizeArabic(ql);
  const dateCtx = hasDateContext(ql);
  const hasVerb = SEARCH_VERB_RE.test(ql);
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
      (codeL && !dateCtx && ql.includes(codeL));
    if (!basicMatch) continue;
    const sc = scoreStudentMatch(q, s);
    // مطابقة ضعيفة (كلمة واحدة فقط) تُقبل عند وجود فعل بحث صريح
    if (sc < MIN_STUDENT_SCORE && !hasVerb) continue;
    if (sc > bestScore) {
      bestScore = sc;
      best = s;
    }
  }
  return best;
};

/** تطبيع تاريخ المحادثة (يقبل Date/نص بأرقام عربية وترتيب DMY أو YMD) */
export const fixDate = (rawDate: any): string => {
  if (!rawDate) return '';
  if (rawDate instanceof Date) {
    const y = rawDate.getFullYear();
    const m = String(rawDate.getMonth() + 1).padStart(2, '0');
    const d = String(rawDate.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  let text = String(rawDate).trim();
  text = text.replace(/[‎‏‪-‮⁦-⁩]/g, '');
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
};

/** بطاقة الطالب السريعة (حضور/غياب/نسبة/أيام) */
export const computeStudentCard = (student: Student, scope: ChatScope): StudentQuickCard => {
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
};

// 🚀 محرك الرد المحلي — يعمل 100% بدون API (يقرأ من قاعدة البيانات مباشرة)
export const buildLocalReply = (
  question: string,
  scope: ChatScope,
): { handled: boolean; text: string } => {
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

  // 1.5) أسماء السجلات — قبل مطابقة الطلاب لأن كلمة "أسماء" قد تطابق باسم طالب
  if (/سجل/i.test(q) && /(أسماء|اسماء|اسامي|اسمه|اسم|شنو|ايش|ما هي|قائمة|قائمه|كم)/i.test(q)) {
    const sorted = [...fixedSessions].sort((a, b) => b._normalizedDate.localeCompare(a._normalizedDate));
    if (sorted.length === 0) return { handled: true, text: '📋 لا توجد سجلات في هذا النطاق' };
    let text = `📋 أسماء السجلات (${sorted.length}):\n`;
    sorted.forEach(s => { text += `  • ${s.name || 'سجل بدون اسم'} — ${formatDateWithDay(s._normalizedDate)}\n`; });
    return { handled: true, text: text.trimEnd() };
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
      `  • اسأل "إحصائيات اليوم"\n` +
      `  • اسأل "شنو أسماء السجلات؟" → قائمة السجلات`,
  };
};
