// أدوات تنظيف البيانات المشتركة — Firebase RTDB يرفض undefined في الكائنات

/**
 * يحذف الحقول التي قيمتها undefined فقط (يسمح بـ null — في tokenService لـnull معنى:
 * studentId: null في روابط الحضور المشتركة)
 */
export const stripUndefined = <T extends object>(obj: T): T => {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as T;
};
