import type { Student } from '../types/student';

/** طالب مشارِك في تكرار */
export interface DuplicateStudentRef {
  id: string;
  name: string;
  code: string;
  group?: string | undefined;
}

/** مجموعة طلاب تتطابق في 3 كلمات متتالية على الأقل */
export interface DuplicateCluster {
  /** الكلمات الثلاث (أو الاسم كاملاً) المشتركة بين أعضاء المجموعة */
  matches: string[][];
  students: DuplicateStudentRef[];
}

const DIACRITICS = /[\u064B-\u0652\u0670\u0640]/g;

/** توحيد صيغة الاسم: إزالة التشكيل والتطويل وتوحيد الألف والياء والتاء المربوطة */
export function normalizeNameWords(name: string): string[] {
  return name
    .replace(DIACRITICS, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .map(w => w.toLowerCase())
    .filter(Boolean);
}

const windowKey = (words: string[]): string => words.join(' ');

/** نوافذ الكلمات المتتالية بطول size (واسم كامل للأسماء الأقصر) */
function nameWindows(words: string[], size: number): string[][] {
  if (words.length < 2) return [];
  if (words.length < size) return [words];
  const out: string[][] = [];
  for (let i = 0; i + size <= words.length; i++) out.push(words.slice(i, i + size));
  return out;
}

/**
 * كشف الأسماء المكررة بنسبة تطابق 3 كلمات متتالية:
 * أي طالبين تتقاطع أسماءهما في ثلاث كلمات متتالية واحدة أو أكثر.
 * الأسماء الأقصر من 3 كلمات تُقارن باسمها الكامل.
 */
export function findDuplicateNames(students: Student[], size = 3): DuplicateCluster[] {
  const windows: string[][][] = students.map(s => nameWindows(normalizeNameWords(s.name), size));
  const allKeys = new Set<string>();
  windows.forEach(ws => ws.forEach(w => allKeys.add(windowKey(w))));

  // فهرس: النافذة -> أرقام الطلاب
  const index = new Map<string, number[]>();
  allKeys.forEach(k => index.set(k, []));
  windows.forEach((ws, i) => ws.forEach(w => index.get(windowKey(w))!.push(i)));

  // دمج الطلاب المترابطين بأي نافذة مشتركة (union-find)
  const parent = students.map((_, i) => i);
  const find = (i: number): number => {
    const p = parent[i]!;
    return p === i ? i : (parent[i] = find(p));
  };
  const union = (a: number, b: number) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };
  index.forEach(list => {
    for (let i = 1; i < list.length; i++) union(list[0]!, list[i]!);
  });

  // تجميع النتائج
  const groups = new Map<number, number[]>();
  students.forEach((_, i) => {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(i);
  });

  const clusters: DuplicateCluster[] = [];
  groups.forEach(members => {
    if (members.length < 2) return;
    const memberSet = new Set(members);
    const sharedKeys = new Set<string>();
    index.forEach((list, key) => {
      const shared = list.filter(i => memberSet.has(i));
      if (shared.length > 1) sharedKeys.add(key);
    });
    clusters.push({
      matches: [...sharedKeys].map(k => k.split(' ')),
      students: members.map(i => {
        const s = students[i]!;
        return { id: s.id, name: s.name, code: s.code, group: s.group };
      }),
    });
  });

  clusters.sort((a, b) => b.students.length - a.students.length || a.students[0]!.name.localeCompare(b.students[0]!.name, 'ar'));
  return clusters;
}

/** عدد الطلاب المشارِكين في تكرار */
export function countDuplicateStudents(clusters: DuplicateCluster[]): number {
  return clusters.reduce((sum, c) => sum + c.students.length, 0);
}
