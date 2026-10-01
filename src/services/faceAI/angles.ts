// ─────────────────────────────────────────────────────────────
// زوايا التسجيل السبع — كل طالب له 7 بصمات مستقلة (بلا دمج)
// الحرف يميّز كل عينة داخل ملف الطالب (A..G)
// ─────────────────────────────────────────────────────────────

export const ENROLLMENT_SAMPLE_COUNT = 7;

export interface EnrollmentAngle {
  /** المفتاح المحفوظ داخل descriptor.labels */
  key: 'front' | 'right' | 'left' | 'up' | 'down' | 'front_close' | 'front_far';
  /** الحرف المميز للعينة داخل ملف الطالب */
  letter: string;
  /** اسم الزاوية كما يراه الطالب */
  label: string;
  /** التوجيه الظاهر أثناء الالتقاط */
  instruction: string;
}

export const ENROLLMENT_ANGLES: EnrollmentAngle[] = [
  { key: 'front',      letter: 'A', label: 'أمام',    instruction: 'أمام' },
  { key: 'right',      letter: 'B', label: 'يمين',    instruction: 'أميل يميناً' },
  { key: 'left',       letter: 'C', label: 'يسار',    instruction: 'أميل يساراً' },
  { key: 'up',         letter: 'D', label: 'أعلى',    instruction: 'أرفع رأسك' },
  { key: 'down',       letter: 'E', label: 'أسفل',    instruction: 'أنظر للأسفل' },
  { key: 'front_close',letter: 'F', label: 'اقترب',   instruction: 'اقترب قليلاً' },
  { key: 'front_far',  letter: 'G', label: 'ابتعد',   instruction: 'ابتعد قليلاً' },
];

export const ANGLE_BY_KEY = new Map<string, EnrollmentAngle>(
  ENROLLMENT_ANGLES.map(a => [a.key, a]),
);

/** الحرف المميّز لعينة برتيبها (0 → A) */
export const sampleLetter = (index: number): string =>
  ENROLLMENT_ANGLES[index]?.letter ?? String.fromCharCode(65 + index);

/** اسم الزاوية من مفتاحها المحفوظ — يرجع المفتاح نفسه لو لم يُعثر عليه */
export const angleLabel = (key: string | undefined): string =>
  (key && ANGLE_BY_KEY.get(key)?.label) || key || '—';
