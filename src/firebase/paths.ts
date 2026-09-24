// Firebase Real Database path helpers (academic years layout)

export const getYearBasePath = (year: string, adminUid: string) =>
  `academicYears/${year}/userData/${adminUid}`;

export const getStagePath = (year: string, adminUid: string, stageId: string, sub: string) =>
  `${getYearBasePath(year, adminUid)}/stageData/${stageId}/${sub}`;

export const getTeacherDataPath = (
  year: string,
  adminUid: string,
  stageId: string,
  teacherId: string,
  sub: string
) => `${getYearBasePath(year, adminUid)}/stageData/${stageId}/teacherRecords/${teacherId}/${sub}`;

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
) =>
  `${getYearBasePath(year, adminUid)}/studentAttendance/${stageId}${studentId ? `/${studentId}` : ''}`;

/** علامة أي مدرّسين فُهرست سجلاتهم: studentAttendance/{stageId}/_tids/{teacherId} */
export const getStudentAttendanceTidsPath = (year: string, adminUid: string, stageId: string) =>
  `${getYearBasePath(year, adminUid)}/studentAttendance/${stageId}/_tids`;
