import { describe, it, expect } from 'vitest';
import type { Student } from '../../types/student';
import {
  extractStudentName,
  extractFallbackName,
  nameSimilarity,
  rankStudents,
  rankByNameInput,
  tripleNameMatch,
  matchesExpectedName,
  MATCH_THRESHOLD,
} from '../cardMatch';

const mkStudent = (id: string, name: string): Student =>
  ({ id, name } as Student);

describe('MATCH_THRESHOLD', () => {
  it('is 80', () => {
    expect(MATCH_THRESHOLD).toBe(80);
  });
});

describe('extractFallbackName', () => {
  it('returns null for empty input', () => {
    expect(extractFallbackName('')).toBeNull();
  });

  it('picks first clean 3-6 word line', () => {
    const text = 'الجمهورية العراقية\nمجتبى هيثم محمد محسن\n12345';
    expect(extractFallbackName(text)).toBe('مجتبى هيثم محمد محسن');
  });

  it('skips lines containing stop words', () => {
    const text = 'وزارة التعليم العالي\nأحمد علي حسن كاظم';
    expect(extractFallbackName(text)).toBe('أحمد علي حسن كاظم');
  });

  it('rejects lines with fewer than 3 words', () => {
    expect(extractFallbackName('أحمد علي')).toBeNull();
  });
});

describe('extractStudentName', () => {
  it('uses name label when present (stage 1)', () => {
    const text = 'الاسم: علي حسن مهدي\nرقم البطاقة: 123';
    expect(extractStudentName(text)).toBe('علي حسن مهدي');
  });

  it('falls back to clean line when no label (stage 2)', () => {
    const text = 'زكريا فلان فلان الثاني\n1990';
    expect(extractStudentName(text)).toBe('زكريا فلان فلان الثاني');
  });

  it('returns null for empty text', () => {
    expect(extractStudentName('')).toBeNull();
  });
});

describe('nameSimilarity', () => {
  it('returns 0 for empty inputs', () => {
    expect(nameSimilarity('', 'x')).toBe(0);
    expect(nameSimilarity('x', '')).toBe(0);
  });

  it('returns 100 for identical names', () => {
    expect(nameSimilarity('أحمد علي', 'أحمد علي')).toBe(100);
  });

  it('returns 100 for names equal after Arabic normalization', () => {
    expect(nameSimilarity('أحمد علي', 'احمد علي')).toBe(100);
  });

  it('returns high score for same names with different alef forms', () => {
    expect(nameSimilarity('إبراهيم خالد', 'ابراهيم خالد')).toBe(100);
  });

  it('returns partial score for partially matching names', () => {
    const s = nameSimilarity('مجتبى هيثم محمد', 'مجتبى هيثم محسن');
    expect(s).toBeGreaterThan(40);
    expect(s).toBeLessThan(100);
  });

  it('returns low score for unrelated names', () => {
    const s = nameSimilarity('محمد كريم', 'خالد سعد');
    expect(s).toBeLessThan(60);
  });
});

describe('rankStudents', () => {
  const roster = [
    mkStudent('1', 'مجتبى هيثم محمد محسن'),
    mkStudent('2', 'نور الهدى مؤيد سالم'),
    mkStudent('3', 'أحمد علي حسن'),
  ];

  it('returns empty array for empty OCR text', () => {
    expect(rankStudents('', roster)).toEqual([]);
  });

  it('returns empty array for empty roster', () => {
    expect(rankStudents('text', [])).toEqual([]);
  });

  it('ranks matching student first', () => {
    const results = rankStudents('الاسم: نور الهدى مؤيد سالم', roster);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.student.name).toBe('نور الهدى مؤيد سالم');
  });

  it('filters out students with no token in text', () => {
    const results = rankStudents('مجتبى', roster);
    expect(results.every(r => r.student.name.includes('مجتبى'))).toBe(true);
  });

  it('returns at most 6 results', () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      mkStudent(String(i), `مجتبى هيثم محمد محسن رقم${i}`),
    );
    const results = rankStudents('مجتبى هيثم', many);
    expect(results.length).toBeLessThanOrEqual(6);
  });

  it('sorts by descending score', () => {
    const results = rankStudents('مجتبى هيثم محمد محسن', roster);
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1]!.score).toBeGreaterThanOrEqual(results[i]!.score);
    }
  });
});

describe('rankByNameInput', () => {
  const roster = [
    mkStudent('1', 'مجتبى هيثم محمد محسن'),
    mkStudent('2', 'أحمد علي حسن'),
  ];

  it('returns empty for empty typed input', () => {
    expect(rankByNameInput('', roster)).toEqual([]);
    expect(rankByNameInput('   ', roster)).toEqual([]);
  });

  it('filters out low similarity matches (score < 40)', () => {
    const results = rankByNameInput('ززززز', roster);
    expect(results).toEqual([]);
  });

  it('finds exact match when typing full name', () => {
    const results = rankByNameInput('أحمد علي حسن', roster);
    expect(results[0]!.student.name).toBe('أحمد علي حسن');
    expect(results[0]!.score).toBe(100);
  });
});

describe('matchesExpectedName — روابط بصمة كود', () => {
  const expectedName = 'مجتبى هيثم محمد محسن';

  it('returns {matched:false, score:0} for empty typed or missing expected name', () => {
    expect(matchesExpectedName('', expectedName)).toEqual({ matched: false, score: 0 });
    expect(matchesExpectedName('   ', expectedName)).toEqual({ matched: false, score: 0 });
    expect(matchesExpectedName('مجتبى', null)).toEqual({ matched: false, score: 0 });
    expect(matchesExpectedName('مجتبى', undefined)).toEqual({ matched: false, score: 0 });
  });

  it('matches exact name (trims whitespace)', () => {
    const r = matchesExpectedName('  مجتبى هيثم محمد محسن  ', expectedName);
    expect(r.matched).toBe(true);
    expect(r.score).toBe(100);
  });

  it('matches hamza/alef variations', () => {
    expect(matchesExpectedName('احمد علي', 'أحمد علي').matched).toBe(true);
  });

  it('rejects a completely different name', () => {
    const r = matchesExpectedName('خالد سعد كريم', expectedName);
    expect(r.matched).toBe(false);
    expect(r.score).toBeLessThan(MATCH_THRESHOLD);
  });
});

describe('tripleNameMatch — regression: split BEFORE normalizeArabic', () => {
  const roster = [
    mkStudent('1', 'نور الهدى مؤيد سالم جاسم'),
    mkStudent('2', 'مجتبى هيثم محمد محسن'),
    mkStudent('3', 'أحمد علي حسن كاظم'),
  ];

  it('returns empty for empty OCR text', () => {
    expect(tripleNameMatch('', roster)).toEqual([]);
  });

  it('returns empty for empty roster', () => {
    expect(tripleNameMatch('text', [])).toEqual([]);
  });

  it('regression: multi-word student name with spaces in OCR matches (whitespace split bug)', () => {
    // Root cause before fix: normalizeArabic stripped ALL whitespace,
    // so split-after-normalize produced one giant token → matchedParts never ≥ 2.
    const ocr = 'نور الهدى مؤيد سالم جاسم';
    const results = tripleNameMatch(ocr, roster);
    expect(results.length).toBeGreaterThan(0);
    const top = results[0]!;
    expect(top.student.name).toBe('نور الهدى مؤيد سالم جاسم');
    expect(top.matchedParts).toBeGreaterThanOrEqual(2);
    expect(top.totalParts).toBe(5);
    expect(top.score).toBe(100);
  });

  it('matches partial name (2 of 4 parts)', () => {
    const ocr = 'مجتبى هيثم';
    const results = tripleNameMatch(ocr, roster);
    const match = results.find(r => r.student.name === 'مجتبى هيثم محمد محسن');
    expect(match).toBeDefined();
    expect(match!.matchedParts).toBe(2);
    expect(match!.totalParts).toBe(4);
    expect(match!.score).toBe(50);
  });

  it('requires at least minPartsMatch (default 2) matches', () => {
    // only 1 part matches → excluded by default
    const ocr = 'كاظم';
    const results = tripleNameMatch(ocr, roster);
    expect(results.find(r => r.student.name === 'أحمد علي حسن كاظم')).toBeUndefined();
  });

  it('respects custom minPartsMatch', () => {
    const ocr = 'كاظم';
    const results = tripleNameMatch(ocr, roster, 1);
    expect(results.find(r => r.student.name === 'أحمد علي حسن كاظم')).toBeDefined();
  });

  it('sorts results by descending score', () => {
    const ocr = 'نور الهدى مؤيد سالم جاسم مجتبى';
    const results = tripleNameMatch(ocr, roster);
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1]!.score).toBeGreaterThanOrEqual(results[i]!.score);
    }
  });

  it('handles OCR text with extra noise words', () => {
    const ocr = 'الاسم: نور الهدى مؤيد سالم جاسم رقم 123';
    const results = tripleNameMatch(ocr, roster);
    expect(results[0]!.student.name).toBe('نور الهدى مؤيد سالم جاسم');
    expect(results[0]!.matchedParts).toBe(5);
  });
});
