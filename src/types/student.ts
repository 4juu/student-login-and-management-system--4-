export interface Student {
  id: string;
  name: string;
  code: string;
  group?: string;
  universityId?: string;
  qrCodeId?: string;
  faceDescriptor?: number[] | any; // بصمة v4: { main: number[512], samples?, quality?, version: 4 }
  faceRegisteredAt?: string;
  faceCompressed?: boolean;
  createdAt: string;
  academicYear?: string;
  
  // 🆕 معلومات التسجيل الذاتي
  selfRegisteredAt?: string;
  selfRegistrationApproved?: boolean;
}

export interface AttendanceRecord {
  id: string;
  studentId: string;
  studentName: string;
  studentCode: string;
  studentGroup?: string;
  timestamp: string;
  date: string;
  time: string;
  sessionId: string;
  status?: 'present' | 'absent';
  method?: 'manual' | 'qr' | 'face';
  academicYear?: string;
  teacherName?: string;
  subjectName?: string;
  absenceCount?: number;
}

export interface AttendanceSession {
  id: string;
  name: string;
  date: string;
  createdAt: string;
  isActive: boolean;
  academicYear?: string;
}

export interface Stage {
  id: string;
  name: string;
  collegeId: string;
  createdAt: string;
  order?: number;
}

export interface College {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  color?: string;
  createdAt: string;
  createdBy: string;
}