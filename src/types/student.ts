export interface Student {
  id: string;
  name: string;
  code: string;
  group?: string;
  createdAt: string;
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
  status?: 'present' | 'absent'; // ✅ جديد: حضور أو غياب
}

export interface AttendanceSession {
  id: string;
  name: string;
  date: string;
  createdAt: string;
  isActive: boolean;
}

// ✅ جديد: المرحلة الدراسية
export interface Stage {
  id: string;
  name: string; // مثلاً: "المرحلة الأولى"
  collegeId: string; // ينتمي لأي كلية
  createdAt: string;
  order?: number; // ترتيب المرحلة
}

// ✅ جديد: الكلية / القسم
export interface College {
  id: string;
  name: string; // مثلاً: "كلية الصيدلة"
  description?: string;
  icon?: string; // emoji أو رمز
  color?: string; // لون مميز
  createdAt: string;
  createdBy: string; // uid الأدمن
}