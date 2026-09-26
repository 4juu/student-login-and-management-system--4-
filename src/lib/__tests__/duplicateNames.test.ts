import { describe, it, expect } from 'vitest';
import { findDuplicateNames, countDuplicateStudents, normalizeNameWords } from '../duplicateNames';
import type { Student } from '../../types/student';

const stu = (id: string, name: string, code: string, group = 'A1'): Student => ({
  id, name, code, group, createdAt: '2026-01-01',
});

describe('normalizeNameWords', () => {
  it('removes diacritics and tatweel and unifies alef/ya/ta-marbuta', () => {
    expect(normalizeNameWords('مُحَمَّد')).toEqual(['محمد']);
    expect(normalizeNameWords('أحمد')).toEqual(['احمد']);
    expect(normalizeNameWords('آمنة')).toEqual(['امنه']);
    expect(normalizeNameWords('معلمة')).toEqual(['معلمه']);
    expect(normalizeNameWords('مـــحمد')).toEqual(['محمد']);
  });

  it('drops punctuation and extra spaces', () => {
    expect(normalizeNameWords('  مجتبى،  هيثم   محمد  ')).toEqual(['مجتبي', 'هيثم', 'محمد']);
  });
});

describe('findDuplicateNames', () => {
  it('detects students sharing 3 consecutive words', () => {
    const students = [
      stu('s1', 'مجتبى هيثم محمد محسن', '1001'),
      stu('s2', 'مجتبى هيثم محمد علي', '1002'),
      stu('s3', 'نور الهدى مؤيد سالم', '1003'),
    ];
    const clusters = findDuplicateNames(students);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.students.map(s => s.id)).toEqual(['s1', 's2']);
    expect(clusters[0]!.matches).toEqual([['مجتبي', 'هيثم', 'محمد']]);
  });

  it('ignores students with no 3-word overlap', () => {
    const students = [
      stu('s1', 'مجتبى هيثم محمد محسن', '1001'),
      stu('s2', 'مجتبى هيثم علي حسن', '1002'),
    ];
    expect(findDuplicateNames(students)).toHaveLength(0);
  });

  it('detects a match on any window position', () => {
    const students = [
      stu('s1', 'علي محمد شلواح جبر', '1001'),
      stu('s2', 'حسن علي محمد شلواح', '1002'),
    ];
    const clusters = findDuplicateNames(students);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.matches).toEqual([['علي', 'محمد', 'شلواح']]);
  });

  it('treats same name with different spelling forms as duplicate', () => {
    const students = [
      stu('s1', 'مُحَمَّد أحمد علي', '1001'),
      stu('s2', 'محمد احمد علي', '1002'),
    ];
    expect(findDuplicateNames(students)).toHaveLength(1);
  });

  it('merges chained duplicates into one cluster', () => {
    const students = [
      stu('s1', 'مجتبى هيثم محمد محسن', '1001'),
      stu('s2', 'مجتبى هيثم محمد علي', '1002'),
      stu('s3', 'مجتبى هيثم محمد حسن', '1003'),
    ];
    const clusters = findDuplicateNames(students);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.students).toHaveLength(3);
  });

  it('compares short names (under 3 words) by full name', () => {
    const students = [stu('s1', 'محمد علي', '1001'), stu('s2', 'محمد علي', '1002')];
    expect(findDuplicateNames(students)).toHaveLength(1);
  });

  it('returns nothing for empty or unique list', () => {
    expect(findDuplicateNames([])).toEqual([]);
    expect(countDuplicateStudents(findDuplicateNames([stu('s1', 'طالب واحد', '1001')]))).toBe(0);
  });

  it('sorts clusters by size descending', () => {
    const students = [
      stu('s1', 'مجتبى هيثم محمد محسن', '1001'),
      stu('s2', 'مجتبى هيثم محمد علي', '1002'),
      stu('s3', 'علي محمد شلواح جبر', '1003'),
      stu('s4', 'علي محمد شلواح حسن', '1004'),
      stu('s5', 'علي محمد شلواح كرار', '1005'),
    ];
    const clusters = findDuplicateNames(students);
    expect(clusters[0]!.students).toHaveLength(3);
    expect(clusters[1]!.students).toHaveLength(2);
    expect(countDuplicateStudents(clusters)).toBe(5);
  });
});
