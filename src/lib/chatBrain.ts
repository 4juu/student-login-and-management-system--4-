// محرك ردود المحادثة — دوال نقية 100% بلا React
// (كان موزعاً داخل SmartChatBot.tsx — فُصلت هنا لسهولة الاختبار وإعادة الاستعمال)
import type { Student, AttendanceRecord, AttendanceSession, College, Stage } from '../types/student';
import { normalizeArabic } from '../services/nameMatching';
import { formatDateWithDay } from './date';

/** حزمة مرحلة واحدة (تُملأ من "⚡ تحميل بيانات الجامعة" للإدارة) */
export interface ChatStageBundle {
  students: Student[];
  records: AttendanceRecord[];
  sessions: AttendanceSession[];
  stageName: string;
  collegeName: string;
}

/** نطاق البيانات الذي يرى المحادثة (المرحلة الحالية أو كل المAccessible للإدارة) */
export interface ChatScope {
  students: Student[];
  records: AttendanceRecord[];
  sessions: AttendanceSession[];
  colleges?: College[] | undefined;
  stages?: Stage[] | undefined;
  stagesMap?: { [stageId: string]: ChatStageBundle } | undefined;
  stageName?: string | undefined;
  collegeName?: string | undefined;
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
// تطبيع النص — أرقام عربية + مسافات + همزات (مصدر واحد للفهم)
// ─────────────────────────────────────────────────────────────

export const toAsciiDigits = (text: string): string => {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0x0660 && code <= 0x0669) out += String(code - 0x0660);
    else if (code >= 0x06F0 && code <= 0x06F9) out += String(code - 0x06F0);
    else out += text[i];
  }
  return out;
};

/** نص مُطبَّع للبحث: أرقام إنجليزية + أحرف صغيرة + بدون مسافات/تشكيل (شدة تُحذف) */
export const squashArabic = (text: string): string => normalizeArabic(toAsciiDigits(text.toLowerCase()));

const MONTH_RAW: [string, number][] = [
  ['يناير', 1], ['فبراير', 2], ['مارس', 3], ['أبريل', 4], ['ابريل', 4], ['مايو', 5], ['يونيو', 6],
  ['يوليو', 7], ['أغسطس', 8], ['اغسطس', 8], ['سبتمبر', 9], ['أكتوبر', 10], ['اكتوبر', 10], ['نوفمبر', 11], ['ديسمبر', 12],
  ['جانفي', 1], ['فيفري', 2], ['أفريل', 4], ['أوت', 8], ['اوت', 8], ['جوان', 6], ['جويلية', 7],
  ['كانون الثاني', 1], ['شباط', 2], ['آذار', 3], ['اذار', 3], ['نيسان', 4], ['أيار', 4], ['ايار', 4],
  ['حزيران', 6], ['تموز', 7], ['آب', 8], ['أيلول', 9], ['ايلول', 9],
  ['تشرين الأول', 10], ['تشرين الاول', 10], ['تشرين الثاني', 11], ['كانون الأول', 12], ['كانون الاول', 12],
];

const AR_MONTHS: { [name: string]: number } = (() => {
  const m: { [name: string]: number } = {};
  MONTH_RAW.forEach(([name, num]) => { m[squashArabic(name)] = num; });
  return m;
})();

const MONTH_ALT = Object.keys(AR_MONTHS).sort((a, b) => b.length - a.length).join('|');

const mkDate = (y: number, m: number, d: number): string | null => {
  if (!y || !m || !d || m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};

/** استخراج تاريخ من السؤال: 2026/09/25 — 06/11/2029 — 24 أغسطس 2026 — ٢٥/٠٩/٢٠٢٦ */
export const extractDateQuery = (question: string): string | null => {
  const qa = toAsciiDigits(question);
  const m1 = qa.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m1) return mkDate(+m1[1]!, +m1[2]!, +m1[3]!);
  const m2 = qa.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m2) {
    let year = +m2[3]!;
    if (year < 100) year += 2000;
    return mkDate(year, +m2[2]!, +m2[1]!);
  }
  const qn = squashArabic(question);
  const m3 = qn.match(new RegExp(`(?:^|\\D)(\\d{1,2})\\D{0,12}(${MONTH_ALT})(?:\\D{0,12}(\\d{4}))?`));
  if (m3) {
    const year = m3[3] ? +m3[3] : new Date().getFullYear();
    return mkDate(year, AR_MONTHS[m3[2]!] ?? 0, +m3[1]!);
  }
  return null;
};

/** استخراج رمز مجموعة (غروب A1 ← A1) */
export const extractGroupToken = (question: string): string | null => {
  const m = question.match(/([A-Za-z]{1,3})\s*-?\s*(\d{1,2})(?!\d)/);
  if (!m) return null;
  return `${m[1]}${m[2]}`.toUpperCase();
};

const GROUP_WORD_RE = /غروب|كروب|جروب|مجموعه|shareet/;

const normGroup = (g?: string | null): string => (g || '').replace(/[\s\-_]/g, '').toUpperCase();

// ─────────────────────────────────────────────────────────────
// مطابقة أسماء الطلاب — تسجيل حسب الدقة
// ─────────────────────────────────────────────────────────────

// أفعال البحث الصريحة تسمح بالمطابقة الجزئية الضعيفة (مثال: "اسأل عن ايات")
const SEARCH_VERB_RE = /ابحث|بحث|اسأل|اسال|من هو|مين|شكد|وين|منو|اسمه|اسمها|صاحب|search|show|find/i;

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
  const cleaned = toAsciiDigits(text);
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

// ─────────────────────────────────────────────────────────────
// مساعدات الردود
// ─────────────────────────────────────────────────────────────

const capNames = (names: string[], cap = 12): string => {
  if (names.length <= cap) return names.join('، ');
  return `${names.slice(0, cap).join('، ')} و${names.length - cap} آخرين`;
};

const pctOf = (present: number, absent: number): string => {
  const total = present + absent;
  if (total === 0) return '—';
  return `${((present / total) * 100).toFixed(1)}%`;
};

interface DayListPerson { name: string; code: string; group?: string | undefined }

// 🚀 محرك الرد المحلي — يعمل 100% بدون API (يقرأ من قاعدة البيانات مباشرة)

/** رد عدد الطلاب — يفلتر بالمرحلة/الكلية المذكورة في السؤال؛ وداخل مرحلة يعدّ "هذه المرحلة" افتراضياً */
const buildStudentCountText = (
  qN: string,
  entries: ChatStageBundle[],
  scStudents: Student[],
  stageName?: string | undefined,
): string => {
  const named = entries.filter(
    e => qN.includes(squashArabic(e.stageName)) || (e.collegeName && qN.includes(squashArabic(e.collegeName))),
  );
  const wantAllStages = /كلمرحله|بكلمراحل|كلالمراحل/.test(qN);
  let src = named.length > 0 ? named : entries;
  if (named.length === 0 && !wantAllStages && stageName) {
    const cur = entries.filter(e => e.stageName === stageName);
    if (cur.length > 0) src = cur;
  }
  if (src.length === 0) return `👨‍🎓 عدد الطلاب في هذا النطاق: **${scStudents.length}**`;
  if (src.length === 1 && named.length === 0) return `👨‍🎓 عدد الطلاب في هذا النطاق: **${src[0]!.students.length}**`;
  const total = src.reduce((n, e) => n + e.students.length, 0);
  let text = `👨‍🎓 عدد الطلاب: **${total}**\n`;
  src.slice(0, 15).forEach(e => {
    text += `  • ${e.stageName} (${e.collegeName}) — 👨‍🎓 ${e.students.length}\n`;
  });
  if (src.length > 15) text += `  ... و${src.length - 15} مرحلة أخرى\n`;
  return text.trimEnd();
};

export const buildLocalReply = (
  question: string,
  scope: ChatScope,
): { handled: boolean; text: string } => {
  const q = question.trim();
  const qN = squashArabic(q);
  const has = (w: string) => qN.includes(w);
  const todayKey = fixDate(new Date());
  const yesterdayKey = fixDate(new Date(Date.now() - 86400000));
  const scStudents = scope.students;
  const scRecords = scope.records;
  const scSessions = scope.sessions;

  const fixedSessions = scSessions.map(s => ({ ...s, _normalizedDate: fixDate((s as any).date) }));
  const entries: ChatStageBundle[] = scope.stagesMap && Object.keys(scope.stagesMap).length > 0
    ? Object.values(scope.stagesMap)
    : scope.stageName
      ? [{ students: scStudents, records: scRecords, sessions: scSessions, stageName: scope.stageName, collegeName: scope.collegeName || 'غير محددة' }]
      : [];

  const todaySessions = fixedSessions.filter(s => s._normalizedDate === todayKey);
  const todaySessionIdSet = new Set(todaySessions.map(s => s.id));
  const todayPresentIds = new Set(
    scRecords.filter(r => todaySessionIdSet.has(r.sessionId) && r.status === 'present').map(r => r.studentId)
  );
  const todayAbsentIds = new Set(
    scRecords.filter(r => todaySessionIdSet.has(r.sessionId) && r.status === 'absent').map(r => r.studentId)
  );

  // ── 1) من سوى الموقع / الأدمن ──
  if (/مدير|مسؤول|من سوى|من صمم|من برمج|صاحب الموقع|owner|admin|developer/i.test(q)) {
    return { handled: true, text: '👨‍⚕️ مدير الموقع/النظام هو "الدكتور الصيدلاني مجتبى هيثم محمد"' };
  }

  // ── 2) قوائم الكليات/المراحل (تعمل حتى قبل تحميل البيانات) ──
  const wantCollege = has('كليات') || has('كليه');
  const wantStage = has('مراحل') || has('مرحله');
  const statsAny = /احصا|نسبه|نسبة|حضور|غياب|غاب|حاضرين|حاضره|اكثر|أكثر|قويه|قوي|عامه|عام |اجمالي/.test(qN);
  const statsWords = /احصا|نسبه|نسبة|حضور|غياب|غاب|حاضرين|حاضره|اكثر|أكثر|قويه|قوي|طلاب|سجل/.test(qN);
  const listWords = has('كم') || has('عدد') || has('شنو') || has('ايش') || (has('قاامه') || has('قايمه')) || has('اعرض') || has('وريني') || has('ماهي') || !statsWords;
  // نية "عدّ الطلاب" — لا يجب أن تخطفها قوائم الكليات/المراحل
  const countStudents = (has('كم') || has('عدد') || has('شكد')) && (has('طالب') || has('طلاب'));

  const collegesSrc: { name: string }[] = scope.colleges?.length
    ? scope.colleges
    : [...new Set(entries.map(e => e.collegeName))].map(name => ({ name }));

  // ذكر اسم كلية مباشرة ("إحصايات الصيدلة") بدون كلمة "كلية"
  const mentionsCollege = collegesSrc.some(c => qN.includes(squashArabic(c.name)));

  if (wantCollege && !statsWords && listWords && !countStudents) {
    if (collegesSrc.length === 0) return { handled: true, text: '🏫 لا توجد كليات مسجلة بعد' };
    let text = `🏫 الكليات (${collegesSrc.length}):\n`;
    collegesSrc.slice(0, 15).forEach(c => { text += `  • ${c.name}\n`; });
    if (collegesSrc.length > 15) text += `  ... و${collegesSrc.length - 15} أخرى\n`;
    return { handled: true, text: text.trimEnd() };
  }

  const stagesSrc: { name: string }[] = scope.stages?.length
    ? scope.stages
    : entries.map(e => ({ name: e.stageName }));

  if (wantStage && !wantCollege && !statsWords && listWords && !countStudents) {
    if (stagesSrc.length === 0) return { handled: true, text: '📚 لا توجد مراحل مسجلة بعد' };
    let text = `📚 المراحل (${stagesSrc.length}):\n`;
    stagesSrc.slice(0, 20).forEach(s => { text += `  • ${s.name}\n`; });
    if (stagesSrc.length > 20) text += `  ... و${stagesSrc.length - 20} أخرى\n`;
    return { handled: true, text: text.trimEnd() };
  }

  // ── 3) بوابة البيانات: قبل "⚡ تحميل بيانات الجامعة" ──
  const hasAnyContent = scStudents.length > 0 || scRecords.length > 0 || scSessions.length > 0 || entries.length > 0;
  if (collegesSrc.length > 0 && !hasAnyContent && !scope.stageName) {
    return {
      handled: true,
      text: '📉 بيانات الجامعة غير محمّلة بعد.\n' +
        'اضغط زر "⚡ تحميل بيانات الجامعة" في أعلى الشاشة، وبعدها اسألني عن أي شيء: الطلاب، المراحل، الكليات، السجلات، الحضور والغياب.',
    };
  }

  // ── 4) أسماء السجلات — قبل مطابقة الطلاب لأن كلمة "أسماء" قد تطابق باسم طالب ──
  if (/سجل/i.test(q) && /(أسماء|اسماء|اسامي|اسمه|اسم|شنو|ايش|ما هي|قائمة|قائمه|كم)/i.test(q)) {
    const sorted = [...fixedSessions].sort((a, b) => b._normalizedDate.localeCompare(a._normalizedDate));
    if (sorted.length === 0) return { handled: true, text: '📋 لا توجد سجلات في هذا النطاق' };
    let text = `📋 أسماء السجلات (${sorted.length}):\n`;
    sorted.slice(0, 25).forEach(s => { text += `  • ${s.name || 'سجل بدون اسم'} — ${formatDateWithDay(s._normalizedDate)}\n`; });
    if (sorted.length > 25) text += `  ... و${sorted.length - 25} سجل آخر\n`;
    return { handled: true, text: text.trimEnd() };
  }

  // ── نية الأسئلة اليومية/التاريخية/الإحصاية (مُزاحة لأعلى لخدمة فروع المطابقة والأسئلة المركبة) ──
  const explicitDate = extractDateQuery(q);
  const dayWord: string | null = has('اليوم') ? todayKey : (has('امس') ? yesterdayKey : null);
  const wantPresent = /منوحضر|منحضر|الليحضر|الموجودين|شوحاضر|حاضريناليوم|الحاضريناليوم|حضوراليوم|شواليحض|الحاضرين|شكدحاضر/.test(qN);
  const wantAbsent = /منوغاب|الليماحضر|منماحضر|الغايبين|الغائبين|الناقصين|موموجودين|غياباليوم|غابتاليوم|شكدغاب/.test(qN);
  const aggWanted = (wantCollege || wantStage || mentionsCollege || /عامه|بالعام|اجمالي/.test(qN)) && (statsAny || wantCollege || wantStage);

  const groupToken = extractGroupToken(q);
  const groupIntent = groupToken ? GROUP_WORD_RE.test(qN) : false;
  const bareGroup = groupToken && qN.replace(groupToken.toLowerCase(), '').trim().length <= 2;

  // ── 5) بحث عن طالب بالاسم أو الكود (رقم الطالب) ──
  // كود مذكور صراحة → مطابقة تامة فقط (لا يُقبل بادئة كود لطالب آخر!)
  const codeDigitsInQ = has('كود') ? (qN.match(/\d{3,}/) || [])[0] : undefined;
  const bestStudent = codeDigitsInQ
    ? (scStudents.find(s => (s.code || '') === codeDigitsInQ) ?? null)
    : pickBestStudentMatch(q, scStudents);
  if (bestStudent) {
    const student = bestStudent;

    const sRecs = scRecords.filter(r => r.studentId === student.id);
    const presentSessionIds = new Set(sRecs.filter(r => r.status === 'present').map(r => r.sessionId));

    let todayStatus = '';
    if (todaySessions.length === 0) todayStatus = 'لا توجد محاضرات اليوم';
    else if (todayPresentIds.has(student.id)) todayStatus = '✅ حاضر';
    else if (todayAbsentIds.has(student.id)) todayStatus = '❌ غائب';
    else todayStatus = 'غير مسجل اليوم';

    const allSessions = [...fixedSessions].sort((a, b) => {
      if (a._normalizedDate !== b._normalizedDate) return a._normalizedDate.localeCompare(b._normalizedDate);
      return String(a.name || '').localeCompare(String(b.name || ''), 'ar');
    });

    const attendedCount = allSessions.filter(s => presentSessionIds.has(s.id)).length;
    const absentCount = allSessions.length - attendedCount;
    const pct = allSessions.length > 0 ? ((attendedCount / allSessions.length) * 100).toFixed(1) : '0';

    const homeEntry = entries.find(e => e.students.some(s => s.id === student.id));
    let text = `📋 الطالب: **${student.name}**\n`;
    text += `🆔 الكود: ${student.code || '-'} | كروب: ${student.group || '-'}\n`;
    if (homeEntry) text += `🏫 ${homeEntry.stageName} — ${homeEntry.collegeName}\n`;
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

  // ── 5أ) كود ذُكر ولم يُطابق أي طالب → رد محدد بدل الدليل العام ──
  if (codeDigitsInQ && scStudents.length > 0) {
    return {
      handled: true,
      text: `🔎 ما لقيت طالب بالكود ${codeDigitsInQ} في هذا النطاق.\nتأكد من الكود أو جرّب الاسم الكامل للطالب.`,
    };
  }

  // ── 5ب) بحث باسم/كود بدون نتيجة → رد محدد بدل "ما لقيت جواب مباشر" ──
  if (
    !bestStudent && scStudents.length > 0 &&
    (SEARCH_VERB_RE.test(q) || has('وريني')) &&
    !wantPresent && !wantAbsent && !explicitDate && !dayWord &&
    !groupToken && !statsWords && !countStudents && !/سجل/.test(q)
  ) {
    return {
      handled: true,
      text: `🔎 ما لقيت طالب يطابق «${q}» في هذا النطاق.\nجرّب الاسم الكامل أو الكود، أو اسألني مثلاً "منو حضر اليوم؟".`,
    };
  }

  // ── 6) أسئلة مركبة: عدد الطلاب + قائم حضور/غياب في سؤال واحد ──
  if (countStudents && (wantPresent || wantAbsent)) {
    const countPart = buildStudentCountText(qN, entries, scStudents, scope.stageName);
    const dayPart = buildDayList(explicitDate || dayWord || todayKey, wantAbsent ? 'absent' : 'present', scope, fixedSessions, null);
    return { handled: true, text: `${countPart}\n\n${dayPart.text}` };
  }

  // ── 7) أسئلة المجموعات (غروب A1) ──
  if (groupToken && (groupIntent || wantPresent || wantAbsent || explicitDate || dayWord || bareGroup)) {
    const date = explicitDate || dayWord;
    if (wantPresent || wantAbsent) {
      return buildDayList(date || todayKey, wantAbsent ? 'absent' : 'present', scope, fixedSessions, groupToken);
    }
    return buildGroupStats(groupToken, date, scope, fixedSessions);
  }

  // ── 8) قوائم حضور/غياب ليوم محدد (اليوم/أمس/تاريخ صريح) ──
  if ((wantPresent || wantAbsent) && !aggWanted) {
    return buildDayList(explicitDate || dayWord || todayKey, wantAbsent ? 'absent' : 'present', scope, fixedSessions, null);
  }

  // ── 9) إحصايات سجل/تاريخ محدد (تفصيل بالمجاميع والأسماء) ──
  const wantStats = /احصا|نسبه|نسبة|حال|شكد|اعرض/.test(qN) || !!explicitDate;
  if (explicitDate || (dayWord && dayWord !== todayKey && wantStats && !aggWanted)) {
    const date = explicitDate || dayWord!;
    const daySessions = fixedSessions.filter(s => s._normalizedDate === date);
    return buildSessionStats(daySessions, date, scope, scRecords, entries, null);
  }

  // ── 10) تجميعات الكليات/المراحل (إحصايات أو ترتيب) ──
  if (aggWanted && !countStudents && (wantCollege || wantStage || mentionsCollege || /عامه|بالعام|اجمالي/.test(qN))) {
    if (entries.length === 0 && collegesSrc.length > 0) {
      return {
        handled: true,
        text: '📉 بيانات الجامعة غير محمّلة بعد.\nاضغط زر "⚡ تحميل بيانات الجامعة" في أعلى الشاشة حتى أعرض لك الإحصايات.',
      };
    }
    if (entries.length === 0) return { handled: true, text: '📭 لا توجد بيانات محمّلة في هذا النطاق' };
    return buildAggReply(qN, { wantCollege, wantStage, entries, collegesSrc, scope });
  }

  // ── 11) إحصايات اليوم (الرد الكلاسيكي) ──
  if (/اليوم|احصا/i.test(qN) || /نسبة الحضور|عدد الحاضر|عدد الغايب|الحضور والغياب/i.test(q)) {
    if (todaySessions.length === 0) {
      return { handled: true, text: `📅 لا توجد محاضرات اليوم (${formatDateWithDay(todayKey)})` };
    }
    const presentCount = scStudents.filter(s => todayPresentIds.has(s.id)).length;
    const absentCount = scStudents.filter(s => todayAbsentIds.has(s.id)).length;
    const notRecordedCount = scStudents.length - presentCount - absentCount;
    const pct = scStudents.length > 0 ? ((presentCount / scStudents.length) * 100).toFixed(1) : '0';
    let text = `📊 إحصايات اليوم (${formatDateWithDay(todayKey)}):\n`;
    text += `  ✅ الحاضرون: **${presentCount}**\n`;
    text += `  ❌ الغائبون: **${absentCount}**\n`;
    if (notRecordedCount > 0) text += `  ⬜ غير مسجل اليوم: **${notRecordedCount}**\n`;
    text += `  📈 نسبة الحضور: **${pct}%**`;
    return { handled: true, text };
  }

  // ── 12) عدد الطلاب (مع فلترة بالمرحلة/الكلية إن وُردت في السؤال) ──
  if (countStudents) {
    return { handled: true, text: buildStudentCountText(qN, entries, scStudents, scope.stageName) };
  }

  // ── 13) مطابقة سؤال باسم سجل نصياً ──
  if (fixedSessions.length > 0 && qN.length >= 6) {
    const matches = fixedSessions
      .filter(s => {
        const sn = squashArabic(`${s.name || ''} ${s._normalizedDate}`);
        return sn.length > 6 && (sn.includes(qN) || qN.includes(sn));
      })
      .sort((a, b) => b._normalizedDate.localeCompare(a._normalizedDate));
    if (matches.length > 0) return buildSessionStats(matches, matches[0]!._normalizedDate, scope, scRecords, entries, null);
  }

  // ── 14) لم يتم التعرف — دليل استخدام بدون أي ذكر لمفاتيح AI ──
  const exampleStudent = scStudents[0];
  const example = exampleStudent ? `${exampleStudent.name} أو ${exampleStudent.code || 'الكود'}` : 'اسم الطالب أو الكود';
  return {
    handled: false,
    text: `🤔 ما لقيت جواب مباشر لسؤالك. جرّب تسألني وحدة من هاي:\n` +
      `  • اسم الطالب أو كوده → أيام حضوره وغيابه (${example})\n` +
      `  • "منو حضر اليوم؟" / "منو غاب أمس؟"\n` +
      `  • تاريخ السجل: "2026/09/25" → إحصايات كاملة بالمجاميع\n` +
      `  • "غروب A1" أو "غروب A1 بتاريخ 2026/09/25"\n` +
      `  • "كم كلية عندنا؟" / "إحصايات كلية الصيدلة"\n` +
      `  • "شنو أسماء السجلات؟" / "كم طلابنا؟"`,
  };
};

// ─────────────────────────────────────────────────────────────
// بناة الردود
// ─────────────────────────────────────────────────────────────

type SessionLite = AttendanceSession & { _normalizedDate: string };

const groupOfPerson = (group: string | undefined, scope: ChatScope, studentId?: string): string => {
  if (group) return normGroup(group);
  if (studentId) {
    const st = scope.students.find(s => s.id === studentId);
    if (st?.group) return normGroup(st.group);
  }
  return '';
};

/** قوائم حضور/غياب ليوم محدد (مع اختيار مجموعة) */
const buildDayList = (
  date: string,
  kind: 'present' | 'absent',
  scope: ChatScope,
  fixedSessions: SessionLite[],
  groupToken: string | null,
): { handled: boolean; text: string } => {
  const todayKey = fixDate(new Date());
  const isToday = date === todayKey;
  const label = formatDateWithDay(date);
  const daySessions = fixedSessions.filter(s => s._normalizedDate === date);
  if (daySessions.length === 0) {
    return {
      handled: true,
      text: isToday ? `📅 لا توجد بيانات حضور لليوم (${label})` : `📅 لا توجد بيانات حضور ${label}`,
    };
  }
  const ids = new Set(daySessions.map(s => s.id));
  const recs = scope.records.filter(r => ids.has(r.sessionId) && r.status === kind);
  const seen = new Set<string>();
  let recList = recs.filter(r => {
    if (seen.has(r.studentId)) return false;
    seen.add(r.studentId);
    return true;
  });
  if (groupToken) {
    const gt = normGroup(groupToken);
    recList = recList.filter(r => groupOfPerson(r.studentGroup, scope, r.studentId) === gt);
  }
  const items: DayListPerson[] = recList.map(r => ({ name: r.studentName, code: r.studentCode, group: r.studentGroup }));

  const suffix = isToday ? ' اليوم' : ` ${label}`;
  if (items.length === 0) {
    const gLabel = groupToken ? ` غروب ${groupToken}` : '';
    if (kind === 'present') return { handled: true, text: `🚨 لا يوجد حاضرين${gLabel}${suffix}` };
    return { handled: true, text: `✅ لا يوجد طلاب مسجلين غياب${gLabel}${suffix}` };
  }
  const head = kind === 'present'
    ? `✅ حضور${groupToken ? ` غروب ${groupToken}` : ''}${suffix} (${items.length}):`
    : `❌ غياب${groupToken ? ` غروب ${groupToken}` : ''}${suffix} (${items.length}):`;
  let text = `${head}\n`;
  items.slice(0, 30).forEach(p => {
    text += `  • ${p.name} (${p.code || '-'}${p.group ? `, ${p.group}` : ''})\n`;
  });
  if (items.length > 30) text += `  ... و${items.length - 30} طالب آخر\n`;
  return { handled: true, text: text.trimEnd() };
};

/** إحصايات سجل/تاريخ — تفصيل كل مجموعة بالأسماء عند إمكان */
const buildSessionStats = (
  daySessions: SessionLite[],
  date: string,
  scope: ChatScope,
  scRecords: AttendanceRecord[],
  entries: ChatStageBundle[],
  groupToken: string | null,
): { handled: boolean; text: string } => {
  const label = formatDateWithDay(date);
  if (daySessions.length === 0) {
    return { handled: true, text: `📅 لا توجد سجلات ${label}` };
  }
  const showNames = daySessions.length <= 2;
  const multiStage = entries.length > 1;
  let text = daySessions.length === 1
    ? `📅 إحصايات سجل: ${daySessions[0]!.name || 'بدون اسم'} — ${label}\n`
    : `📅 إحصايات سجلات ${label} (${daySessions.length} سجل):\n`;
  let tPresent = 0, tAbsent = 0;

  for (const s of daySessions.slice(0, 6)) {
    const recs = scRecords.filter(r => r.sessionId === s.id);
    const entry = entries.find(e => e.sessions.some(x => x.id === s.id));
    let expected = entry?.students ?? scope.students;
    if (groupToken) expected = expected.filter(st => normGroup(st.group) === groupToken);
    const recMap = new Map(recs.map(r => [r.studentId, r]));
    const pool = new Map<string, { name: string; code: string; group?: string | undefined }>();
    expected.forEach(st => pool.set(st.id, { name: st.name, code: st.code, group: st.group }));
    recs.forEach(r => {
      if (!pool.has(r.studentId)) pool.set(r.studentId, { name: r.studentName, code: r.studentCode, group: r.studentGroup });
    });
    if (groupToken) {
      Array.from(pool.entries()).forEach(([id, p]) => { if (groupOfPerson(p.group, scope, id) !== groupToken) pool.delete(id); });
    }

    const byGroup = new Map<string, { present: string[]; absent: string[] }>();
    let present = 0, absent = 0;
    pool.forEach((p, id) => {
      const g = p.group || 'بدون مجموعة';
      if (!byGroup.has(g)) byGroup.set(g, { present: [], absent: [] });
      const r = recMap.get(id);
      if (r?.status === 'present') { present++; byGroup.get(g)!.present.push(p.name); }
      else if (r?.status === 'absent') { absent++; byGroup.get(g)!.absent.push(p.name); }
    });
    tPresent += present;
    tAbsent += absent;
    const unrec = pool.size - present - absent;
    const stageTag = multiStage && entry ? `${entry.stageName}: ` : '';

    text += `  ${stageTag}👨‍🎓 المتوقع: ${pool.size} | ✅ حاضرون: ${present} | ❌ غائبون: ${absent}` +
      (unrec > 0 ? ` | ⬜ غير مسجل: ${unrec}` : '') +
      ` | 📈 نسبة الحضور: ${pctOf(present, absent)}\n`;
    const gKeys = [...byGroup.keys()].sort();
    for (const g of gKeys.slice(0, 12)) {
      const v = byGroup.get(g)!;
      text += `    🟩 ${g} — ✅ ${v.present.length} / ❌ ${v.absent.length}`;
      if (showNames) {
        if (v.present.length) text += `\n      ✅: ${capNames(v.present)}`;
        if (v.absent.length) text += `\n      ❌: ${capNames(v.absent)}`;
      }
      text += '\n';
    }
    if (gKeys.length > 12) text += `    ... و${gKeys.length - 12} مجموعة أخرى\n`;
  }
  if (daySessions.length > 6) text += `  ... و${daySessions.length - 6} سجل آخر\n`;
  if (daySessions.length > 1) {
    text += `  المجموع الكلي: ✅ ${tPresent} / ❌ ${tAbsent} | 📈 ${pctOf(tPresent, tAbsent)}\n`;
    if (!showNames) text += `  💡 لعرض الأسماء: اذكر اسم سجل واحد أو تاريخاً واحداً`;
  }
  return { handled: true, text: text.trimEnd() };
};

/** إحصايات مجموعة (غروب) — عامة أو ليوم/تاريخ */
const buildGroupStats = (
  token: string,
  date: string | null,
  scope: ChatScope,
  fixedSessions: SessionLite[],
): { handled: boolean; text: string } => {
  const expected = scope.students.filter(s => normGroup(s.group) === token);
  const daySessions = date ? fixedSessions.filter(s => s._normalizedDate === date) : fixedSessions;
  const ids = daySessions.map(s => s.id);
  const recs = scope.records.filter(r => ids.includes(r.sessionId) && groupOfPerson(r.studentGroup, scope, r.studentId) === token);
  const label = date ? formatDateWithDay(date) : '';
  if (expected.length === 0 && recs.length === 0) {
    return { handled: true, text: `📭 لا توجد بيانات لغروب ${token}${date ? ` في ${label}` : ''}` };
  }
  const present = recs.filter(r => r.status === 'present').length;
  const absent = recs.filter(r => r.status === 'absent').length;
  let text = `👥 غروب ${token}${date ? ` — ${label}` : ''}\n`;
  text += `👨‍🎓 الطلاب: ${expected.length} | ✅ حضور: ${present} | ❌ غياب: ${absent} | 📈 نسبة الحضور: ${pctOf(present, absent)}\n`;
  const perSession = daySessions
    .map(s => {
      const sr = recs.filter(r => r.sessionId === s.id);
      return {
        name: s.name || 'سجل بدون اسم',
        date: s._normalizedDate,
        present: sr.filter(r => r.status === 'present').length,
        absent: sr.filter(r => r.status === 'absent').length,
      };
    })
    .filter(x => x.present + x.absent > 0)
    .sort((a, b) => b.date.localeCompare(a.date));
  if (perSession.length > 0) {
    text += `السجلات (${perSession.length}):\n`;
    perSession.slice(0, 8).forEach(x => {
      text += `  • ${x.name} — ${formatDateWithDay(x.date)}: ✅ ${x.present} / ❌ ${x.absent}\n`;
    });
    if (perSession.length > 8) text += `  ... و${perSession.length - 8} سجل آخر\n`;
  }
  return { handled: true, text: text.trimEnd() };
};

interface AggRow { label: string; sub?: string; students: number; present: number; absent: number }

const aggOf = (e: ChatStageBundle): { students: number; present: number; absent: number } => ({
  students: e.students.length,
  present: e.records.filter(r => r.status === 'present').length,
  absent: e.records.filter(r => r.status === 'absent').length,
});

const nameMatch = (qN: string, name: string): boolean => {
  const full = squashArabic(name);
  const bare = squashArabic(name.replace(/^كلية\s*/i, '').replace(/^المرحلة\s*/i, ''));
  return (full.length > 2 && qN.includes(full)) || (bare.length > 2 && qN.includes(bare));
};

/** تجميعات الكليات/المراحل (ترتيب/فلترة/إحصايات عامة) */
const buildAggReply = (
  qN: string,
  args: {
    wantCollege: boolean;
    wantStage: boolean;
    entries: ChatStageBundle[];
    collegesSrc: { name: string }[];
    scope: ChatScope;
  },
): { handled: boolean; text: string } => {
  const { wantStage, entries, collegesSrc, scope } = args;
  const wantRank = /اكثر|أكثر/.test(qN);
  const rankByPct = /قوي|نسبة/.test(qN);
  const wantGeneral = /عامه|بالعام|اجمالي/.test(qN);

  const matchedCollege = collegesSrc.find(c => nameMatch(qN, c.name)) ?? null;
  const stageNames = scope.stages?.length ? scope.stages.map(s => s.name) : entries.map(e => e.stageName);
  const matchedStageName = stageNames.find(n => nameMatch(qN, n)) ?? null;

  let rows: AggRow[] = [];
  let header = '';
  let showTotal = false;

  if (matchedStageName) {
    const es = entries.filter(e => nameMatch(qN, e.stageName));
    rows = es.map(e => ({ label: e.stageName, sub: e.collegeName, ...aggOf(e) }));
    header = `📚 إحصايات ${matchedStageName}:`;
    showTotal = rows.length > 1;
  } else if (matchedCollege) {
    const es = entries.filter(e => nameMatch(qN, e.collegeName));
    if (wantStage || wantRank) {
      rows = es.map(e => ({ label: e.stageName, ...aggOf(e) }));
      header = wantRank ? `🏆 مراحل كلية ${matchedCollege.name} (ترتيب):` : `📚 مراحل كلية ${matchedCollege.name}:`;
    } else {
      rows = es.map(e => ({ label: e.stageName, ...aggOf(e) }));
      header = `🏫 إحصايات كلية ${matchedCollege.name}:`;
    }
    showTotal = true;
  } else if (wantStage) {
    rows = entries.map(e => ({ label: e.stageName, sub: e.collegeName, ...aggOf(e) }));
    header = wantRank ? '🏆 أكثر المراحل حضوراً:' : '📚 إحصايات المراحل:';
  } else {
    const map = new Map<string, AggRow>();
    entries.forEach(e => {
      const cur = map.get(e.collegeName) || { label: e.collegeName, students: 0, present: 0, absent: 0 };
      const a = aggOf(e);
      cur.students += a.students;
      cur.present += a.present;
      cur.absent += a.absent;
      map.set(e.collegeName, cur);
    });
    rows = [...map.values()];
    header = wantRank
      ? (rankByPct ? '🏆 أكثر الكليات نسبة حضور:' : '🏆 أكثر الكليات حضوراً:')
      : (wantGeneral ? '📊 إحصايات الحضور العامة (حسب الكلية):' : '🏫 إحصايات الكليات:');
    showTotal = true;
  }

  if (wantRank) {
    rows.sort((a, b) => (rankByPct
      ? ((b.present + b.absent) > 0 ? b.present / (b.present + b.absent) : 0) - ((a.present + a.absent) > 0 ? a.present / (a.present + a.absent) : 0)
      : b.present - a.present));
  }

  if (rows.length === 0) {
    return { handled: true, text: '📭 لا توجد بيانات محمّلة لهذا الطلب' };
  }

  let text = `${header}\n`;
  rows.slice(0, 20).forEach(r => {
    text += `  • ${r.label}${r.sub ? ` (${r.sub})` : ''} — 👨‍🎓 ${r.students}: ✅ ${r.present} / ❌ ${r.absent} (${pctOf(r.present, r.absent)})\n`;
  });
  if (rows.length > 20) text += `  ... و${rows.length - 20} صف آخر\n`;
  if (showTotal) {
    const tot = rows.reduce((acc, r) => ({ students: acc.students + r.students, present: acc.present + r.present, absent: acc.absent + r.absent }), { students: 0, present: 0, absent: 0 });
    text += `  المجموع: 👨‍🎓 ${tot.students}: ✅ ${tot.present} / ❌ ${tot.absent} (${pctOf(tot.present, tot.absent)})\n`;
  }
  return { handled: true, text: text.trimEnd() };
};
