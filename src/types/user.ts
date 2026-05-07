export interface User {
  uid: string;
  email: string;
  displayName: string;
  role: 'admin' | 'teacher';
  createdAt: string;
  lastLogin?: string;
  photoURL?: string; // صورة شخصية
  bio?: string; // بايو / وصف المادة
}

export interface TeacherAccount {
  email: string;
  displayName: string;
  password: string;
  role: 'teacher';
  createdBy: string;
  createdAt: string;
}
