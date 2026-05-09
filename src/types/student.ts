export interface Student {
  id: string;
  name: string;
  code: string; // 3 or 4 digit code
  group?: string; // ✅ الكروب العملي (A1, A2, B1, B2...)
  createdAt: string;
}

export interface AttendanceRecord {
  id: string;
  studentId: string;
  studentName: string;
  studentCode: string;
  studentGroup?: string; // ✅ كروب الطالب وقت تسجيل الحضور
  timestamp: string;
  date: string;
  time: string;
  sessionId: string; // Reference to attendance session
}

export interface AttendanceSession {
  id: string;
  name: string; // e.g., "حضور يوم الأحد 2024-01-15"
  date: string;
  createdAt: string;
  isActive: boolean;
}