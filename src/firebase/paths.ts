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
