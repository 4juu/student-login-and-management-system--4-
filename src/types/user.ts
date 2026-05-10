export interface User {
  uid: string;
  email: string;
  displayName: string;
  role: 'admin' | 'teacher';
  lastUpdated?: string;
  createdAt: string;
  lastLogin?: string;
  photoURL?: string;
  bio?: string;
  
  // ✅ جديد: للتدريسي - الصلاحيات
  adminId?: string; // الأدمن اللي يتبعه
  permissions?: TeacherPermissions; // صلاحياته
}

// ✅ جديد: صلاحيات التدريسي
export interface TeacherPermissions {
  // الكليات والمراحل المسموح بها
  // مثال: { "college1": ["stage1", "stage2"], "college2": ["stage3"] }
  allowedStages: {
    [collegeId: string]: string[]; // قائمة معرّفات المراحل المسموح بها
  };
  canViewRecords: boolean; // يكدر يشوف سجل الحضور
  canTakeAttendance: boolean; // يكدر يسجل حضور
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