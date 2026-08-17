export type RegistrationLinkType = 'single' | 'bulk' | 'attendance';

export interface RegistrationLink {
  token: string;
  adminUid: string;
  stageId: string;
  studentId?: string | null;
  type: RegistrationLinkType;
  createdBy: string;
  createdAt: string;
  expiresAt: number;
  used: boolean;
  usedAt?: string;
  usedByStudentId?: string;
  academicYear?: string;
  subjectName?: string;
  teacherId?: string;
}

export interface PendingRegistration {
  id: string;
  adminUid: string;
  stageId: string;
  studentId: string;
  studentCode: string;
  nameInSystem: string;

  nationalId?: string;
  qrCodeUrl?: string;
  qrCodeId?: string;
  qrVerified: boolean;

  faceDescriptor: any;

  status: 'pending' | 'approved' | 'rejected';
  rejectionReason?: string;

  createdAt: string;
  reviewedAt?: string;
  reviewedBy?: string;

  hasExistingQr?: boolean;
  hasExistingFace?: boolean;
}

export interface RegistrationProgress {
  step: 'code' | 'id-upload' | 'id-processing' | 'face' | 'submitting' | 'success' | 'error' | 'attendance-report';
  message?: string;
}

export interface IDExtractionResult {
  success: boolean;
  name?: string;
  qrUrl?: string;
  qrId?: string;
  nationalId?: string;
  error?: string;
  rawText?: string;
}
