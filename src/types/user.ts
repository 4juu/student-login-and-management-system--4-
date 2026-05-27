export interface User {
  uid: string;
  email: string;
  displayName: string;
  role: 'admin' | 'college_admin' | 'teacher';
  lastUpdated?: string;
  createdAt: string;
  lastLogin?: string;
  photoURL?: string;
  bio?: string;
  
  // للتدريسي - الصلاحيات
  adminId?: string;
  permissions?: TeacherPermissions;
  
  // لأدمن الكلية - الكلية المسؤول عنها
  collegeId?: string;
  collegeName?: string;
  
  // 🆕 حالة التفعيل (للتصفير السنوي)
  active?: boolean; // true = مفعّل، false = معطّل بعد التصفير
  lastActivatedAt?: string; // تاريخ آخر تفعيل
  deactivatedAt?: string; // تاريخ التعطيل
}

export interface TeacherPermissions {
  allowedStages: {
    [collegeId: string]: string[];
  };
  canViewRecords: boolean;
  canTakeAttendance: boolean;
}

export interface TeacherAccount {
  email: string;
  displayName: string;
  password: string;
  role: 'teacher';
  lastUpdated?: string;
  createdBy: string;
  createdAt: string;
}