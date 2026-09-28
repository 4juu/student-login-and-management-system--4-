import { describe, it, expect } from 'vitest';
import { fitWithin, isValidPhotoDataUri, MAX_PHOTO_URI_LENGTH } from '../image';

describe('fitWithin', () => {
  it('يقلل العرض فقط إلى الحد الأقصى مع الحفاظ على النسبة', () => {
    expect(fitWithin(1280, 720, 640)).toEqual({ width: 640, height: 360 });
    expect(fitWithin(640, 480, 640)).toEqual({ width: 640, height: 480 });
  });

  it('لا يكبّر الصور الأصغر من الحد', () => {
    expect(fitWithin(320, 240, 640)).toEqual({ width: 320, height: 240 });
  });

  it('يعالج أبعادًا فارغة/سالبة', () => {
    expect(fitWithin(0, 100, 640)).toEqual({ width: 1, height: 1 });
    expect(fitWithin(-5, -5, 640)).toEqual({ width: 1, height: 1 });
  });

  it('يقلل الارتفاع إذا كان هو المحدّد', () => {
    expect(fitWithin(480, 960, 640)).toEqual({ width: 480, height: 960 });
    expect(fitWithin(800, 1600, 400)).toEqual({ width: 400, height: 800 });
  });
});

describe('isValidPhotoDataUri', () => {
  it('يقبل JPEG data URI ضمن الحد', () => {
    const uri = 'data:image/jpeg;base64,' + 'A'.repeat(100);
    expect(isValidPhotoDataUri(uri)).toBe(true);
  });

  it('يرفض ما ليس data URI صورة', () => {
    expect(isValidPhotoDataUri('https://example.com/a.jpg')).toBe(false);
    expect(isValidPhotoDataUri('data:text/plain;base64,AAA')).toBe(false);
    expect(isValidPhotoDataUri('')).toBe(false);
    expect(isValidPhotoDataUri(null)).toBe(false);
    expect(isValidPhotoDataUri(123)).toBe(false);
  });

  it('يرفض ما يتجاوز حد 120000 حرف', () => {
    const big = 'data:image/jpeg;base64,' + 'A'.repeat(MAX_PHOTO_URI_LENGTH);
    expect(isValidPhotoDataUri(big)).toBe(false);
  });
});
