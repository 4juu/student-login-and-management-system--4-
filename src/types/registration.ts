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

  studentName?: string;
  studentCode?: string;
  qrCodeId?: string;
}

export interface PendingRegistration {
  id: string;
  adminUid: string;
  stageId: string;
  studentId: string;
  studentCode: string;
  nameInSystem: string;

  nameFromCard?: string;
  nationalId?: string;
  qrCodeUrl?: string;
  qrCodeId?: string;
  qrVerified: boolean;
  nameMatched: boolean;

  faceDescriptor: any;

  linkToken?: string;
  linkType?: RegistrationLinkType;

  status: 'pending' | 'approved' | 'rejected';
  rejectionReason?: string;

  createdAt: string;
  reviewedAt?: string;
  reviewedBy?: string;

  hasExistingQr?: boolean;
  hasExistingFace?: boolean;
}

export interface IDExtractionResult {
  success: boolean;
  qrUrl?: string;
  qrId?: string;
  nationalId?: string;
  ocrText?: string;
  nameFromCard?: string;
  error?: string;
}
