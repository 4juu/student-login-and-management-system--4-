export type RegistrationLinkType = 'single' | 'bulk' | 'attendance' | 'test' | 'namecheck';

export interface RegistrationLink {
  token: string;
  adminUid: string;
  stageId: string;
  studentId?: string | null | undefined;
  type: RegistrationLinkType;
  createdBy: string;
  createdAt: string;
  expiresAt: number;
  used: boolean;
  usedAt?: string | undefined;
  usedByStudentId?: string | undefined;
  academicYear?: string | undefined;
  subjectName?: string | undefined;
  teacherId?: string | undefined;

  studentName?: string | undefined;
  studentCode?: string | undefined;
  qrCodeId?: string | undefined;
}

export interface PendingRegistration {
  id: string;
  adminUid: string;
  stageId: string;
  studentId: string;
  studentCode: string;
  nameInSystem: string;

  nameFromCard?: string | undefined;
  /** 🆕 الاسم المستخرج فعلياً من البطاقة */
  extractedName?: string | undefined;
  nationalId?: string | undefined;
  qrCodeUrl?: string | undefined;
  qrCodeId?: string | undefined;
  qrVerified: boolean;
  nameMatched: boolean;

  faceDescriptor: any;

  linkToken?: string | undefined;
  linkType?: RegistrationLinkType | undefined;

  status: 'pending' | 'approved' | 'rejected';
  rejectionReason?: string | undefined;

  createdAt: string;
  reviewedAt?: string | undefined;
  reviewedBy?: string | undefined;

  hasExistingQr?: boolean | undefined;
  hasExistingFace?: boolean | undefined;
}

export interface IDExtractionResult {
  success: boolean;
  qrUrl?: string | undefined;
  qrId?: string | undefined;
  nationalId?: string | undefined;
  ocrText?: string | undefined;
  nameFromCard?: string | undefined;
  /** الاسم المستخرج من حقل "الأسم/الاسم" في نص OCR الخام — null إذا لم يُعثر عليه */
  extractedName?: string | null | undefined;
  error?: string | undefined;
}
