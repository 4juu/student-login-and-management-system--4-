// Barrel: public dataService API (re-exports domain modules)
// Importers continue to use `from '../firebase/dataService'`.

export {
  cancelAllPendingSaves,
  getPendingSavesCount,
  getDebouncedSavesCount,
  hasPendingWrites,
  flushAllPendingSaves,
} from './saveQueue';

export {
  getCurrentAcademicYear,
  getActiveAcademicYear,
  loadSystemTitle,
  saveSystemTitle,
  getNextAcademicYear,
  isValidAcademicYearFormat,
  listAllAcademicYears,
} from './academicYear';

export {
  saveColleges,
  loadColleges,
  saveStages,
  loadStages,
} from './collegeStageService';

export {
  saveStudents,
  loadStudents,
  updateStudentDescriptorOverride,
  loadDescriptorOverrides,
  clearDescriptorOverrides,
} from './studentsService';

export {
  saveAttendanceRecords,
  loadAttendanceRecords,
  saveSessions,
  loadSessions,
  saveActiveSession,
  loadActiveSession,
  loadStageData,
  deleteStageData,
} from './attendanceService';

export {
  saveUserProfile,
  loadUserProfile,
  saveUserData,
} from './userService';

export { syncPendingChanges } from './syncPending';

export { applyOutbox } from './outboxService';

export {
  resetAcademicYear,
  getDatabaseStats,
} from './yearResetService';

export {
  saveTelegramConfig,
  loadTelegramConfig,
} from './telegramService';
