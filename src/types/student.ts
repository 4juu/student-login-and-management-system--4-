export interface Student {
  id: string;
  name: string;
  code: string;
  group?: string | undefined;
  universityId?: string | undefined;
  qrCodeId?: string | undefined;
  faceDescriptor?: number[] | object | any; // بصمة v5 (Pose Grid): FaceGalleryDescriptor
  faceRegisteredAt?: string | undefined;
  faceCompressed?: boolean | undefined;
  createdAt: string;
  academicYear?: string | undefined;

  // 🆕 معلومات التسجيل الذاتي
  selfRegisteredAt?: string | undefined;
  selfRegistrationApproved?: boolean | undefined;
}

export interface AttendanceRecord {
  id: string;
  studentId: string;
  studentName: string;
  studentCode: string;
  studentGroup?: string | undefined;
  timestamp: string;
  date: string;
  time: string;
  sessionId: string;
  status?: 'present' | 'absent' | undefined;
  method?: 'manual' | 'qr' | 'face' | undefined;
  academicYear?: string | undefined;
  teacherName?: string | undefined;
  subjectName?: string | undefined;
  absenceCount?: number | undefined;
}

export interface AttendanceSession {
  id: string;
  name: string;
  date: string;
  createdAt: string;
  isActive: boolean;
  academicYear?: string | undefined;
}

export interface Stage {
  id: string;
  name: string;
  collegeId: string;
  createdAt: string;
  order?: number | undefined;
}

export interface College {
  id: string;
  name: string;
  description?: string | undefined;
  icon?: string | undefined;
  color?: string | undefined;
  createdAt: string;
  createdBy: string;
}