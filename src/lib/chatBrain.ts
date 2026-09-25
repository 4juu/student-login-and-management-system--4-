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

interface DayListPerson { name: string; code: string; group?: string | undefined }

/** رسالة الرفض الموحدة — لكل الأسئلة خارج: تقرير طالب (اسم/كود) أو منو حضر/غاب اليوم */
export const REFUSAL_REPLY =
  'عذراً دكتور، يمكنني إعطائك تقرير لكل طالب عن طريق إرسال اسمه وأنا أقوم بالرد عليك، ولا أستطيع الإجابة على غير هذه الأسئلة.';

/**
 * استخراج الكود الأكاديمي من السؤال:
 * - ذُكرت كلمة "كود" صراحة → أي رقم 3+ أرقام (مطابقة تامة لاحقاً)
 * - أو رقم مفرد 3–4 أرقام خارج سياق التاريخ (الكود الأكاديمي المكوّن من 4 أرقام)
 */
export const extractAcademicCode = (q: string): string | undefined => {
  const qN = squashArabic(q);
  if (qN.includes('كود')) {
    const explicit = qN.match(/\d{3,}/);
    if (explicit) return explicit[0];
  }
  if (DATE_CONTEXT_RE.test(q)) return undefined;
  const bare = qN.match(/\b\d{3,4}\b/);
  return bare ? bare[0] : undefined;
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

  // ── 0) بوابة البيانات: قبل "⚡ تحميل بيانات الجامعة" ──
  const collegesSrc: { name: string }[] = scope.colleges?.length
    ? scope.colleges
    : [...new Set(entries.map(e => e.collegeName))].map(name => ({ name }));

  const hasAnyContent = scStudents.length > 0 || scRecords.length > 0 || scSessions.length > 0 || entries.length > 0;
  if (collegesSrc.length > 0 && !hasAnyContent && !scope.stageName) {
    return {
      handled: true,
      text: '📉 بيانات الجامعة غير محمّلة بعد.\n' +
        'اضغط زر "⚡ تحميل بيانات الجامعة" في أعلى الشاشة، وبعدها اسألني عن تقرير طالب بالاسم أو "منو حضر اليوم؟".',
    };
  }

  // ── نيات الأسئلة المسموح بها فقط: تقرير طالب + منو حضر/غاب ──
  const explicitDate = extractDateQuery(q);
  const dayWord: string | null = has('اليوم') ? todayKey : (has('امس') ? yesterdayKey : null);
  const wantPresent = /منوحضر|منحضر|الليحضر|الموجودين|شوحاضر|حاضريناليوم|الحاضريناليوم|حضوراليوم|شواليحض|الحاضرين|شكدحاضر/.test(qN);
  const wantAbsent = /منوغاب|الليماحضر|منماحضر|الغايبين|الغائبين|الناقصين|موموجودين|غياباليوم|غابتاليوم|شكدغاب/.test(qN);
  const groupToken = extractGroupToken(q);
  const statsAny = /احصا|نسبه|نسبة|حضور|غياب|غاب|حاضرين|حاضره|اكثر|أكثر|قويه|قوي|عامه|عام |اجمالي/.test(qN);
  const countStudents = (has('كم') || has('عدد') || has('شكد')) && (has('طالب') || has('طلاب'));

  // ── 1) تقرير الطالب: بالاسم أو بالكود الأكاديمي (3–4 أرقام) ──
  const codeDigitsInQ = extractAcademicCode(q);
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

  // ── 1أ) كود ذُكر ولم يُطابق أي طالب → رد محدد بدل رسالة الرفض ──
  if (codeDigitsInQ && scStudents.length > 0) {
    return {
      handled: true,
      text: `🔎 ما لقيت طالب بالكود ${codeDigitsInQ} في هذا النطاق.\nتأكد من الكود أو جرّب الاسم الكامل للطالب.`,
    };
  }

  // ── 1ب) فعل بحث صريح عن اسم بدون نتيجة → رد محدد (خارج نية الإحصاءات/القوائم) ──
  if (
    !bestStudent && scStudents.length > 0 &&
    (SEARCH_VERB_RE.test(q) || has('وريني')) &&
    !wantPresent && !wantAbsent && !explicitDate && !dayWord &&
    !groupToken && !statsAny && !countStudents &&
    !/سجل|كليه|كليات|مرحله|مراحل/.test(qN) &&
    !/مدير|مسؤول|من سوى|من صمم|من برمج|صاحب الموقع|owner|admin|developer/i.test(q)
  ) {
    return {
      handled: true,
      text: `🔎 ما لقيت طالب يطابق «${q}» في هذا النطاق.\nجرّب الاسم الكامل أو الكود، أو اسألني مثلاً "منو حضر اليوم؟".`,
    };
  }

  // ── 2) منو حضر اليوم / منو غاب اليوم (أيام أو تاريخ) — وحده أو الاثنين معاً ──
  if (wantPresent || wantAbsent) {
    const date = explicitDate || dayWord || todayKey;
    if (wantPresent && wantAbsent) {
      const presentPart = buildDayList(date, 'present', scope, fixedSessions, groupToken);
      const absentPart = buildDayList(date, 'absent', scope, fixedSessions, groupToken);
      return { handled: true, text: `${presentPart.text}\n\n${absentPart.text}` };
    }
    return buildDayList(date, wantAbsent ? 'absent' : 'present', scope, fixedSessions, groupToken);
  }

  // ── 3) خارج الأسئلة المسموح بها → رسالة الرفض الموحدة ──
  return { handled: false, text: REFUSAL_REPLY };
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
