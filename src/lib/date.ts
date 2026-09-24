// أدوات التاريخ المشتركة — مصدر واحد لتطبيع تواريخ الرسائل/التصدير (كان مكرراً في 3 ملفات)

/** تحويل الأرقام العربية إلى إنجليزية */
export const toEnglishDigits = (str: string): string => {
  if (!str) return '';
  return String(str).replace(/[٠-٩۰-۹]/g, (ch) => {
    const code = ch.charCodeAt(0);
    if (code >= 0x0660 && code <= 0x0669) return String(code - 0x0660);
    if (code >= 0x06f0 && code <= 0x06f9) return String(code - 0x06f0);
    return ch;
  });
};

export const pad2 = (n: number): string => String(n).padStart(2, '0');

/**
 * تطبيع أي تمثيل تاريخ إلى مفتاح YYYY-MM-DD:
 * - أرقام عربية → إنجليزية، إزالة علامات الاتجاه (LRM/RLM)
 * - يقبل: YYYY-MM-DD، D/M/YYYY، YYYY/M/D
 * (النسخة الفائقة — كانت مكررة في AttendanceRecords ×3 وSelfEnrollPage ×1)
 */
export const normalizeDate = (dateStr: string): string => {
  if (!dateStr) return '';
  const arabicNumbers = '٠١٢٣٤٥٦٧٨٩';
  const englishNumbers = '0123456789';
  let normalized = dateStr.replace(/[٠-٩]/g, (d) => englishNumbers[arabicNumbers.indexOf(d)] ?? d);
  normalized = normalized.replace(/[‏‎\u200E\u200F]/g, '').trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return normalized;

  const slashDMY = normalized.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashDMY) {
    const day = slashDMY[1] ?? '';
    const month = slashDMY[2] ?? '';
    const year = slashDMY[3] ?? '';
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  const slashYMD = normalized.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (slashYMD) {
    const year = slashYMD[1] ?? '';
    const month = slashYMD[2] ?? '';
    const day = slashYMD[3] ?? '';
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  return normalized;
};

/**
 * مفتاح تاريخ موحّد للاستعلامات اليومية (يقبل نص/Date، ويفضّل YYYY-*)
 * — كان في SmartChatBot.tsx ويُستعمل في إحصاءات "اليوم"
 */
export const normalizeDateKey = (value?: string | Date | null): string => {
  try {
    if (!value) return '';
    if (value instanceof Date) {
      if (isNaN(value.getTime())) return '';
      return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`;
    }
    let text = String(value).trim();
    if (!text) return '';
    text = toEnglishDigits(text);
    text = text.replace(/[/\\.]/g, '-');
    const ymdMatch = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (ymdMatch) {
      return `${ymdMatch[1] ?? ''}-${pad2(parseInt(ymdMatch[2] ?? '1'))}-${pad2(parseInt(ymdMatch[3] ?? '1'))}`;
    }
    const dmyMatch = text.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
    if (dmyMatch && (dmyMatch[3] ?? '').length === 4) {
      return `${dmyMatch[3] ?? ''}-${pad2(parseInt(dmyMatch[2] ?? '1'))}-${pad2(parseInt(dmyMatch[1] ?? '1'))}`;
    }
    const dateObj = new Date(text);
    if (!isNaN(dateObj.getTime())) {
      return `${dateObj.getFullYear()}-${pad2(dateObj.getMonth() + 1)}-${pad2(dateObj.getDate())}`;
    }
    return '';
  } catch {
    return '';
  }
};

/** تنسيق تاريخ عربي مع اليوم (الأحد 5 يناير 2026) */
export const formatDateWithDay = (value?: string | Date | null): string => {
  const key = normalizeDateKey(value);
  if (!key) return '-';
  const days = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  const months = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  const d = new Date(`${key}T12:00:00`);
  if (isNaN(d.getTime())) return key;
  return `${days[d.getDay()] ?? ''} ${d.getDate()} ${months[d.getMonth()] ?? ''} ${d.getFullYear()}`;
};
