import { describe, it, expect } from 'vitest';
import {
  normalizeArabic,
  levenshteinSimilarity,
  splitMergedArabicWords,
  splitMergedName,
  findNameInOCRText,
  matchStudentFromDatabase,
  findStudentByCode,
  extractNameFromOCR,
} from '../nameMatching';

describe('normalizeArabic', () => {
  it('unifies alef variants', () => {
    expect(normalizeArabic('أحمد')).toBe(normalizeArabic('احمد'));
    expect(normalizeArabic('إبراهيم')).toBe(normalizeArabic('ابراهيم'));
    expect(normalizeArabic('آمنة')).toBe(normalizeArabic('امنه'));
  });

  it('converts ta marbuta to ha', () => {
    expect(normalizeArabic('فاطمة')).toBe(normalizeArabic('فاطمه'));
  });

  it('converts alef maqura to ya', () => {
    expect(normalizeArabic('مصطفى')).toBe(normalizeArabic('مصطفي'));
  });

  it('strips diacritics', () => {
    expect(normalizeArabic('مُحَمَّد')).toBe('محمد');
  });

  it('strips whitespace entirely', () => {
    // ى→ي, ؤ→ا: هدى→هدي, مؤيد→مايد
    expect(normalizeArabic('نور الهدى مؤيد')).toBe('نورالهديمايد');
    expect(normalizeArabic('  a b  ')).toBe('ab');
  });
});

describe('levenshteinSimilarity', () => {
  it('returns 1 for identical strings', () => {
    expect(levenshteinSimilarity('محمد', 'محمد')).toBe(1);
  });

  it('returns 0 for empty string', () => {
    expect(levenshteinSimilarity('', 'x')).toBe(0);
    expect(levenshteinSimilarity('x', '')).toBe(0);
  });

  it('returns value between 0 and 1', () => {
    const s = levenshteinSimilarity('محمود', 'محمد');
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(1);
  });
});

describe('splitMergedArabicWords', () => {
  it('splits compound names with prefixes', () => {
    expect(splitMergedArabicWords('عبدالله')).toEqual(['عبد', 'الله']);
    expect(splitMergedArabicWords('عبدالرحمان')).toEqual(['عبد', 'الرحمان']);
  });

  it('returns short words unchanged', () => {
    expect(splitMergedArabicWords('علي')).toEqual(['علي']);
  });

  it('returns non-prefix words unchanged', () => {
    expect(splitMergedArabicWords('محمد')).toEqual(['محمد']);
  });
});

describe('splitMergedName', () => {
  it('expands compound parts in multi-word names', () => {
    const result = splitMergedName('مجتبى عبدالله');
    expect(result).toContain('عبد');
    expect(result).toContain('الله');
  });
});

describe('findNameInOCRText', () => {
  it('matches exact substring with confidence 1', () => {
    const r = findNameInOCRText('مجتبى هيثم', 'الاسم: مجتبى هيثم');
    expect(r.matched).toBe(true);
    expect(r.confidence).toBe(1);
  });

  it('returns false for empty inputs', () => {
    expect(findNameInOCRText('', 'text').matched).toBe(false);
    expect(findNameInOCRText('name', '').matched).toBe(false);
  });

  it('matches when OCR has extra surrounding text', () => {
    const r = findNameInOCRText('أحمد علي', 'بطاقة هوية أحمد علي رقم 123');
    expect(r.matched).toBe(true);
    expect(r.confidence).toBeGreaterThan(0.5);
  });

  it('does not match completely unrelated names', () => {
    const r = findNameInOCRText('زكريا فلان', 'كليا الهندسة القبول');
    expect(r.matched).toBe(false);
  });
});

describe('matchStudentFromDatabase', () => {
  const students = [
    { name: 'مجتبى هيثم محمد محسن' },
    { name: 'نور الهدى مؤيد سالم' },
    { name: 'أحمد علي حسن' },
  ];

  it('finds the correct student from OCR text', () => {
    const r = matchStudentFromDatabase('الاسم: نور الهدى مؤيد سالم', students);
    expect(r).not.toBeNull();
    expect(r!.name).toBe('نور الهدى مؤيد سالم');
  });

  it('returns null for empty OCR text', () => {
    expect(matchStudentFromDatabase('', students)).toBeNull();
  });

  it('returns null for empty roster', () => {
    expect(matchStudentFromDatabase('text', [])).toBeNull();
  });

  it('returns null when no student matches', () => {
    expect(matchStudentFromDatabase('كلية الطب البشري القبول', students)).toBeNull();
  });
});

describe('findNameInOCRText — بوابة العائلة (أسماء متشابهة)', () => {
  const A = 'نور الهدى محمد صالح علي';

  it('يرفض بطاقة شقيق يختلف بآخر الاسم', () => {
    const r = findNameInOCRText(A, 'الاسم: نور الهدى محمد صالح عيسى');
    expect(r.matched).toBe(false);
  });

  it('يرفض بطاقة شقيق يختلف بآخر الاسم (جواد)', () => {
    const r = findNameInOCRText(A, 'نور الهدى محمد صالح جواد');
    expect(r.matched).toBe(false);
  });

  it('يقبل البطاقة الكاملة لصاحب الاسم', () => {
    const r = findNameInOCRText(A, 'الاسم: نور الهدى محمد صالح علي');
    expect(r.matched).toBe(true);
    expect(r.confidence).toBe(1);
  });

  it('يرفض عند اقتطاع آخر الاسم من القراءة', () => {
    const r = findNameInOCRText(A, 'نور الهدى محمد صالح');
    expect(r.matched).toBe(false);
  });

  it('يقبل نصاً مدمجاً بلا مسافات يحوي العائلة', () => {
    const r = findNameInOCRText(A, 'نورالهدىمحمدصالحعلي 12345');
    expect(r.matched).toBe(true);
  });
});

describe('matchStudentFromDatabase — لا يخلط بين أشقاء الاسم', () => {
  const roster = [{ name: 'نور الهدى محمد صالح علي' }];

  it('يرفض نص شقيق بعائلة مختلفة', () => {
    expect(matchStudentFromDatabase('نور الهدى محمد صالح عيسى', roster)).toBeNull();
  });

  it('يقبل نص صاحب الاسم الكامل', () => {
    const r = matchStudentFromDatabase('الاسم: نور الهدى محمد صالح علي', roster);
    expect(r).not.toBeNull();
    expect(r!.name).toBe('نور الهدى محمد صالح علي');
  });
});

describe('findStudentByCode', () => {
  const students = [{ code: 'S001' }, { code: 'S002' }];

  it('finds student by exact code', () => {
    expect(findStudentByCode('S001', students)).toEqual({ code: 'S001' });
  });

  it('trims whitespace from input code', () => {
    expect(findStudentByCode('  S002 ', students)).toEqual({ code: 'S002' });
  });

  it('returns null for unknown code', () => {
    expect(findStudentByCode('S999', students)).toBeNull();
  });
});

describe('extractNameFromOCR', () => {
  it('extracts name after the name label', () => {
    const text = 'الاسم: مجتبى هيثم محمد\nالتاريخ: 2000-01-01';
    expect(extractNameFromOCR(text)).toBe('مجتبى هيثم محمد');
  });

  it('stops at stop keywords', () => {
    const text = 'الاسم: أحمد علي الحقباني اللقب: فلان';
    const result = extractNameFromOCR(text);
    expect(result).toContain('أحمد');
    expect(result).not.toContain('اللقب');
  });

  it('returns null when no name label present', () => {
    expect(extractNameFromOCR('نص عشوائي بدون تسمية')).toBeNull();
  });

  it('returns null for empty text', () => {
    expect(extractNameFromOCR('')).toBeNull();
  });
});
