// ─────────────────────────────────────────────────────────────
// رقم البصمة الفريد (Fingerprint ID)
// ─────────────────────────────────────────────────────────────
// هوية رقمية 10 خانات تُشتق حتمياً من عيّنات التسجيل (enrollment)
// فقط — لا تتغير بأي تحديث لاحق للمعرض/العناقيد/الجودة، ولا تعتمد
// على معرّف الطالب، وتُستخدم كرقم مرجعي ثابت يظهر في الجدول
// والملف الشخصي وشاشة تأكيد التسجيل.
// ─────────────────────────────────────────────────────────────

function fnv1a(text: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function toId(h1: number, h2: number): string {
  const id = (h1 * 7 + h2) % 10_000_000_000;
  return String(id).padStart(10, '0');
}

/** نصّ حتمي قابل للتكرار من عيّنات التسجيل فقط */
function enrollmentText(fd: unknown): string | null {
  const g = fd as { enrollment?: unknown } | null;
  if (!g || !Array.isArray(g.enrollment) || g.enrollment.length === 0) return null;
  const parts: string[] = [];
  for (const s of g.enrollment) {
    if (!Array.isArray(s) || s.length === 0) continue;
    parts.push(s.map(v => Math.round(Number(v) * 1e4)).join(','));
  }
  if (parts.length === 0) return null;
  return parts.join('|');
}

/** رقم بصمة فريد لطالب (10 خانات) — null إذا لم تكن هناك عيّنات تسجيل */
export function computeFpId(faceDescriptor: unknown): string | null {
  const text = enrollmentText(faceDescriptor);
  if (!text) return null;
  return toId(fnv1a(text, 0x811c9dc5), fnv1a(text, 0x9e3779b9));
}

/** تجزئة بديلة حتمية — تُستخدم لحل تعارض رقمين بين طلاب */
function rehash(base: string, salt: number): string {
  return toId(fnv1a(`${base}#${salt}`, 0x85ebca6b), fnv1a(`${base}#${salt}`, 0xc2b2ae35));
}

/**
 * أرقام بصمات لكل الطلاب — تضمن عدم التكرار:
 * عند تعارض رقمين يُعاد تجزئة الثاني بملح ثابت حتى يصبح فريداً.
 * (النتيجة ثابتة لنفس ترتيب الطلاب.)
 */
export function computeFpIds<T extends { id: string; faceDescriptor?: unknown }>(
  students: T[],
): Map<string, string> {
  const used = new Set<string>();
  const out = new Map<string, string>();
  for (const s of students) {
    const base = computeFpId(s.faceDescriptor);
    if (!base) continue;
    let candidate = base;
    let salt = 1;
    while (used.has(candidate) && salt < 1000) {
      candidate = rehash(base, salt++);
    }
    used.add(candidate);
    out.set(s.id, candidate);
  }
  return out;
}
