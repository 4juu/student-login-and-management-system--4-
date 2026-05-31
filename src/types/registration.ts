// ============================================================
// 🔑 أنواع البيانات لنظام التسجيل الذاتي
// ============================================================

export interface RegistrationLink {
  token: string;
  adminUid: string;
  stageId: string;
  studentId?: string | null;  // null = رابط جماعي للمرحلة
  type: 'single' | 'bulk';
  createdBy: string;
  createdAt: string;
  expiresAt: number;          // timestamp بالـ ms
  used: boolean;
  usedAt?: string;
  usedByStudentId?: string;
  academicYear?: string;      // السنة الدراسية عند إنشاء الرابط
}

export interface PendingRegistration {
  id: string;
  adminUid: string;
  stageId: string;
  studentId: string;
  studentCode: string;
  
  // البيانات المستخرجة من الهوية
  nameFromID: string;
  nameInSystem: string;
  matchPercentage: number;
  
  // QR من الهوية
  qrCodeUrl: string;            // الرابط الكامل
  qrCodeId: string;             // الـ ID المستخرج فقط
  
  // بصمة الوجه (مضغوطة)
  faceDescriptor: any;          // MultiDescriptor مضغوطة
  
  // الحالة
  status: 'pending' | 'auto-approved' | 'approved' | 'rejected';
  rejectionReason?: string;
  
  // التواريخ
  createdAt: string;
  reviewedAt?: string;
  reviewedBy?: string;
  
  // معلومات إضافية
  hasExistingQr?: boolean;      // الطالب عنده QR محفوظ مسبقاً
  hasExistingFace?: boolean;    // الطالب عنده بصمة محفوظة مسبقاً
}

export interface RegistrationProgress {
  step: 'code' | 'id-upload' | 'id-processing' | 'name-mismatch' | 'face' | 'submitting' | 'success' | 'error';
  message?: string;
}

export interface IDExtractionResult {
  success: boolean;
  name?: string;
  qrUrl?: string;
  qrId?: string;
  error?: string;
  rawText?: string;
}