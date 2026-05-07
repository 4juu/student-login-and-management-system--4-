export interface Student {
  id: string;
  name: string;
  code: string; // 3 or 4 digit code
  createdAt: string;
}

export interface AttendanceRecord {
  id: string;
  studentId: string;
  studentName: string;
  studentCode: string;
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
