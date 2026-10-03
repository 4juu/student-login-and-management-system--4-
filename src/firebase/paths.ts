// Firebase Real Database path helpers (academic years layout)

// 🔒 الرموز المحظورة داخل أي مقطع من مسارات RTDB — إدخالها يفسد المسار أو يفتح حقناً
const FORBIDDEN_KEY_CHARS = /[.#$[\]/]/;

/**
 * يتحقق أن المعرّف صالح كمقطع مسار في Firebase (يمنع . # $ [ ] /).
 * يرمي استثناءً برسالة واضحة بدل بناء مسار مُعطَّل بصمت.
 */
export const assertValidKey = (value: string, label = 'المعرّف'): void => {
  if (FORBIDDEN_KEY_CHARS.test(value)) {
    throw new Error(
      `${label} يحتوي على رموز غير مسموحة في مسار قاعدة البيانات (. # $ [ ] /) — راجع المدخلات`
    );
  }
};

export const getYearBasePath = (year: string, adminUid: string) =>
  `academicYears/${year}/userData/${adminUid}`;

export const getStagePath = (year: string, adminUid: string, stageId: string, sub: string) => {
  assertValidKey(stageId, 'stageId');
  return `${getYearBasePath(year, adminUid)}/stageData/${stageId}/${sub}`;
};

export const getTeacherDataPath = (
  year: string,
  adminUid: string,
  stageId: string,
  teacherId: string,
  sub: string
) => {
  assertValidKey(stageId, 'stageId');
  assertValidKey(teacherId, 'teacherId');
  return `${getYearBasePath(year, adminUid)}/stageData/${stageId}/teacherRecords/${teacherId}/${sub}`;
};

export const getCollegesPath = (year: string, adminUid: string) =>
  `${getYearBasePath(year, adminUid)}/colleges`;

export const getStagesPath = (year: string, adminUid: string) =>
  `${getYearBasePath(year, adminUid)}/stages`;

/**
 * فهرس حضور لكل طالب — خارج stageData حتى لا يُسحب مع طلب loadAllAdminData الضخم.
 * studentAttendance/{stageId}/{studentId}/{recordId}
 */
export const getStudentAttendancePath = (
  year: string,
  adminUid: string,
  stageId: string,
  studentId?: string
) => {
  assertValidKey(stageId, 'stageId');
  if (studentId) assertValidKey(studentId, 'studentId');
  return `${getYearBasePath(year, adminUid)}/studentAttendance/${stageId}${studentId ? `/${studentId}` : ''}`;
};

/** علامة أي مدرّسين فُهرست سجلاتهم: studentAttendance/{stageId}/_tids/{teacherId} */
export const getStudentAttendanceTidsPath = (year: string, adminUid: string, stageId: string) => {
  assertValidKey(stageId, 'stageId');
  return `${getYearBasePath(year, adminUid)}/studentAttendance/${stageId}/_tids`;
};
