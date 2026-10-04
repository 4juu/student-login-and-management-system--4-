import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { ref, update, set, get } from 'firebase/database';
import { database } from '../../firebase/config';
import { Student } from '../../types/student';
import { PendingRegistration } from '../../types/registration';
import { getActiveAcademicYear } from '../../firebase/dataService';
import { markLinkAsUsed } from '../../services/tokenService';
import { normalizeName } from '../../services/faceAI/gallery';
import { LoadingState } from '../loading/LoadingState';
import { MorphingSquare } from '../MorphingSquare';
import {
  parseAllSamples,
  checkForTampering,
  migrateToV5,
  descriptorDistance,
  MATCH_STRICT,
} from '../../services/faceAI/descriptors';
import { Camera, Check, CheckCheck, CircleCheck, CircleX, ClipboardList, Mail, QrCode, Save, Smile, Trash2, TriangleAlert } from 'lucide-react';
import { useConfirm } from '../../hooks/useConfirm';
import { useNavStore } from '../../store/navStore';
import { toast } from '@/hooks/use-toast';

interface PendingRegistrationsProps {
  adminUid: string;
  dataAdminUid?: string | undefined;
  onClose: () => void;
}

type FilterStatus = 'all' | 'pending' | 'approved' | 'rejected';

/** Ø­Ø§Ù„Ø© Ù†Ø§ÙØ°Ø© Ø§Ù„Ø­ÙØ¸ Ø§Ù„Ù…Ø³Ø¯ÙˆØ¯Ø© â€” Ù„Ø§ ØªØ®ØªÙÙŠ Ø¥Ù„Ø§ Ø¨Ø¹Ø¯ Ø§Ø³ØªÙ‚Ø±Ø§Ø± Ø§Ù„ÙƒØªØ§Ø¨Ø§Øª ÙÙŠ Ù‚Ø§Ø¹Ø¯Ø© Ø§Ù„Ø¨ÙŠØ§Ù†Ø§Øª */
interface SavingState {
  title: string;
  detail: string;
  current?: number;
  total?: number;
  attempt?: number;
}

/** ÙØ´Ù„ Ø¯Ø§Ø¦Ù… (ÙØ´Ù„ ØªØ­Ù‚Ù‚ Ù…Ù†Ø·Ù‚ÙŠ/Ø¨ØµÙ…Ø© ØªØ§Ù„ÙØ©) â€” Ù„Ø§ Ø¬Ø¯ÙˆÙ‰ Ù…Ù† Ø¥Ø¹Ø§Ø¯Ø© Ø§Ù„Ù…Ø­Ø§ÙˆÙ„Ø© */
class PermanentError extends Error {}

/** Ù…Ù‡Ù„Ø© Ù„ÙƒÙ„ Ù…Ø­Ø§ÙˆÙ„Ø© â€” Ø¨Ø¯ÙˆÙ†Ù‡Ø§ ØªÙƒØªØ¨ Firebase ØªØ¹Ù„Ù‘Ù‚ Ù„Ù„Ø£Ø¨Ø¯ Ø¹Ù†Ø¯ Ø§Ù†Ù‚Ø·Ø§Ø¹ Ø§Ù„Ø§ØªØµØ§Ù„ (ÙˆØªÙ†Ø­Ø¨Ø³ Ù†Ø§ÙØ°Ø© Ø§Ù„Ø­ÙØ¸) */
const ATTEMPT_TIMEOUT_MS = 20000;

const withTimeout = (work: Promise<void>): Promise<void> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Ø§Ù†ØªÙ‡Øª Ù…Ù‡Ù„Ø© Ø§Ù„Ø§ØªØµØ§Ù„ Ø¨Ù‚Ø§Ø¹Ø¯Ø© Ø§Ù„Ø¨ÙŠØ§Ù†Ø§Øª (20 Ø«Ø§Ù†ÙŠØ©) â€” ØªØ­Ù‚Ù‚ Ù…Ù† Ø§Ù„Ø¥Ù†ØªØ±Ù†Øª')),
      ATTEMPT_TIMEOUT_MS,
    );
    work.then(
      () => { clearTimeout(timer); resolve(); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });

/** Ø¥Ø¹Ø§Ø¯Ø© Ù…Ø­Ø§ÙˆÙ„Ø© ØªÙ„Ù‚Ø§Ø¦ÙŠØ© Ù„Ù„Ø¹Ù…Ù„ÙŠØ§Øª Ø§Ù„Ù‚Ø§Ø¨Ù„Ø© Ù„Ù„ÙØ´Ù„ (Ø´Ø¨ÙƒØ©/Ù‚Ø§Ø¹Ø¯Ø©) â€” Ø§Ù„ÙØ´Ù„ Ø§Ù„Ø¯Ø§Ø¦Ù… ÙŠÙØ±Ù…ÙŠ ÙÙˆØ±Ø§Ù‹ */
const withRetry = async (
  fn: () => Promise<void>,
  attempts = 3,
  onAttempt?: (next: number) => void,
): Promise<void> => {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await withTimeout(fn());
      return;
    } catch (e) {
      if (e instanceof PermanentError || attempt === attempts) throw e;
      onAttempt?.(attempt + 1);
      await new Promise(resolve => setTimeout(resolve, 500 * attempt));
    }
  }
};

export const PendingRegistrations: React.FC<PendingRegistrationsProps> = ({
  adminUid,
  dataAdminUid,
  onClose,
}) => {
  // Ø§Ø³ØªÙ…Ø§Ø¹ ÙˆØ§Ø­Ø¯ ÙÙ‚Ø· ÙÙŠ useNavigation â€” Ø§Ù„Ù†Ø§ÙØ°Ø© ØªÙ‚Ø±Ø£ Ù…Ù† Ø§Ù„Ù…ØªØ¬Ø± (Ù„Ø§ Ø§Ø´ØªØ±Ø§Ùƒ Ù…ÙƒØ±Ø± Ø¹Ù„Ù‰ Ù†ÙØ³ Ø§Ù„Ù…Ø³Ø§Ø±)
  const [requests] = [useNavStore((s) => s.pendingRequests)];
  const [filter, setFilter] = useState<FilterStatus>('pending');
  const [processing, setProcessing] = useState<ReadonlySet<string>>(() => new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [purging, setPurging] = useState(false);
  const { confirm: confirmAction, ConfirmDialog: ConfirmDialogEl } = useConfirm();
  const loading = false;
  const [saving, setSaving] = useState<SavingState | null>(null);
  // Ø­Ø§Ø±Ø³ Ù…ØªØ²Ø§Ù…Ù†: ÙŠÙ…Ù†Ø¹ Ø¨Ø¯Ø¡ Ø¹Ù…Ù„ÙŠØ© Ù…ÙˆØ§ÙÙ‚Ø© Ø«Ø§Ù†ÙŠØ© Ù‚Ø¨Ù„ Ø§Ù†ØªÙ‡Ø§Ø¡ Ø§Ù„Ø­Ø§Ù„ÙŠØ© Ø­ØªÙ‰ Ù„Ùˆ ÙˆÙ‚Ø¹ Ø§Ù„Ù†Ù‚Ø± ÙÙŠ Ù†ÙØ³ Ø§Ù„Ù„Ø­Ø¸Ø©
  const busyRef = useRef(false);

  /** Ø­Ø§Ù„Ø© ÙƒÙ„ Ø·Ù„Ø¨ Ù…Ø³ØªÙ‚Ù„Ø© â€” Ù„Ø§ ÙŠØ¶ÙŠØ¹ Ù…Ø¤Ø´Ø± Â«Ø¬Ø§Ø±ÙŠ...Â» Ù„Ø·Ù„Ø¨ ÙƒØ§Ù† ÙŠÙÙƒØªØ¨ Ø¨Ø¹Ø¯Ù…Ø§ ÙŠØ¨Ø¯Ø£ Ø·Ù„Ø¨ Ø¢Ø®Ø± */
  const startProcessing = (id: string) => setProcessing(prev => { const next = new Set(prev); next.add(id); return next; });
  const stopProcessing = (id: string) => setProcessing(prev => { const next = new Set(prev); next.delete(id); return next; });
  const clearProcessing = () => setProcessing(new Set());

  // Ø£Ø«Ù†Ø§Ø¡ Ø§Ù„Ø­ÙØ¸: ØªØ­Ø°ÙŠØ± Ø§Ù„Ù…ØªØµÙØ­ Ù‚Ø¨Ù„ Ø¥ØºÙ„Ø§Ù‚ Ø§Ù„ØªØ¨ÙˆÙŠØ¨/Ø¥Ø¹Ø§Ø¯Ø© ØªØ­Ù…ÙŠÙ„ Ø§Ù„ØµÙØ­Ø©
  useEffect(() => {
    if (!saving) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [saving]);

  /** Ø¥ØºÙ„Ø§Ù‚ Ø§Ù„Ù†Ø§ÙØ°Ø© ÙÙ‚Ø· Ø¨Ø¹Ø¯ Ø§ÙƒØªÙ…Ø§Ù„ Ø§Ù„Ø­ÙØ¸ */
  const safeClose = () => {
    if (saving) return;
    onClose();
  };

  useBodyScrollLock(true);

  const filteredRequests = useMemo(() => {
    return requests.filter(r => {
      if (filter !== 'all' && r.status !== filter) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          r.nameInSystem.toLowerCase().includes(q) ||
          r.studentCode.toLowerCase().includes(q) ||
          (r.nationalId && r.nationalId.toLowerCase().includes(q))
        );
      }

      return true;
    });
  }, [requests, filter, searchQuery]);

  /** ÙƒØªØ§Ø¨Ø© Ø§Ù„Ù…ÙˆØ§ÙÙ‚Ø© ÙˆØ§Ù„Ø¨ØµÙ…Ø© ÙƒØ§Ù…Ù„Ø© â€” Ø§Ù„Ø¹Ù…Ù„ÙŠØ§Øª ÙƒÙ„Ù‡Ø§ idempotent ÙÙŠÙØ¹Ø§Ø¯ ØªØ´ØºÙŠÙ„Ù‡Ø§ Ø¨Ø£Ù…Ø§Ù† Ø¹Ù†Ø¯ Ø¥Ø¹Ø§Ø¯Ø© Ø§Ù„Ù…Ø­Ø§ÙˆÙ„Ø© */
  const approveRequest = async (
    req: PendingRegistration,
    onProgress?: (msg: string) => void,
  ): Promise<void> => {
    const year = await getActiveAcademicYear();
    const storageUid = dataAdminUid || adminUid;
    if (!req.studentId) {
      throw new PermanentError('Ø¨ÙŠØ§Ù†Ø§Øª Ø§Ù„Ø·Ø§Ù„Ø¨ Ù†Ø§Ù‚ØµØ© (studentId)');
    }

    const basePath = `academicYears/${year}/userData/${storageUid}/stageData/${req.stageId}/students`;
    const descriptorsPath = `academicYears/${year}/userData/${storageUid}/stageData/${req.stageId}/descriptors`;

    onProgress?.('Ù‚Ø±Ø§Ø¡Ø© Ø¨ÙŠØ§Ù†Ø§Øª Ø§Ù„Ø·Ø§Ù„Ø¨...');
    // â”€â”€ 1) Find the student's key first (array index or object key)
    const [snap, descSnap] = await Promise.all([
      get(ref(database, basePath)),
      get(ref(database, descriptorsPath)),
    ]);
    if (!snap.exists()) {
      throw new PermanentError('Ù„Ù… Ù†Ø¬Ø¯ Ø¨ÙŠØ§Ù†Ø§Øª Ø§Ù„Ø·Ù„Ø§Ø¨');
    }

    const data = snap.val();
    const descriptors = descSnap.exists() ? (descSnap.val() as Record<string, unknown>) : null;

    // â”€â”€ 1) ØªØ­Ø¯ÙŠØ¯ Ø³Ø¬Ù„ Ø§Ù„Ø·Ø§Ù„Ø¨ Ø¨Ù…ÙØªØ§Ø­Ù‡ (ÙÙ‡Ø±Ø³ Ø§Ù„Ù…ØµÙÙˆÙØ© Ø£Ùˆ Ù…ÙØªØ§Ø­ Ø§Ù„ÙƒØ§Ø¦Ù†)
    //    âš ï¸ Ø§Ù„Ø±Ù‚Ù… Ø§Ù„Ù…ÙƒØ±Ø± Ù„Ø§ ÙŠØ­Ø¯Ù‘Ø¯ Ø§Ù„Ø³Ø¬Ù„ ÙˆØ­Ø¯Ù‡: Ù†Ù‚Ø§Ø±Ù† **Ø§Ù„Ø§Ø³Ù… Ø§Ù„ÙƒØ§Ù…Ù„** Ø£ÙŠØ¶Ø§Ù‹ØŒ ÙˆÙ†Ø±ÙØ¶ Ø¥Ù† Ù„Ù…
    //    ÙŠØ­Ø³Ù… ÙˆØ§Ø­Ø¯ÙŒ Ù…Ù†Ù‡Ù…Ø§ Ø§Ù„Ù…Ø·Ø§Ø¨Ù‚Ø© (ÙˆØ¥Ù„Ø§ ÙƒÙØªØ¨Øª Ø¨ØµÙ…Ø© Ø§Ù„Ø·Ø§Ù„Ø¨ Ø¹Ù„Ù‰ Ø§Ø³Ù… Ø·Ø§Ù„Ø¨ Ø¢Ø®Ø±).
    const entries: Array<{ key: string | number; student: Student }> = (Array.isArray(data)
      ? data.map((s, i) => ({ key: i, student: s }))
      : data && typeof data === 'object'
        ? Object.entries(data).map(([key, val]) => ({ key, student: val as Student }))
        : []
    ).filter(e => !!e.student && typeof e.student === 'object' && e.student.id);

    const sameId = entries.filter(e => e.student.id === req.studentId);
    let chosen: { key: string | number; student: Student } | null = null;
    if (sameId.length === 1) {
      chosen = sameId[0] ?? null;
    } else if (sameId.length > 1) {
      const target = normalizeName(req.nameInSystem);
      const byName = target ? sameId.filter(e => normalizeName(e.student.name) === target) : [];
      chosen = byName.length === 1 ? (byName[0] ?? null) : null;
      if (!chosen) {
        throw new PermanentError(
          `Ù„Ø§ ÙŠÙ…ÙƒÙ† Ø§Ù„Ù…ÙˆØ§ÙÙ‚Ø©: Ø§Ù„Ø±Ù‚Ù… ${req.studentId} Ù…ÙƒØ±Ù‘Ø± ÙÙŠ Ø§Ù„Ù…Ø±Ø­Ù„Ø© ÙˆÙ„Ø§ ÙŠØ·Ø§Ø¨Ù‚ Â«${req.nameInSystem}Â» Ø³Ø¬Ù„Ø§Ù‹ ÙˆØ§Ø­Ø¯Ø§Ù‹ ÙÙ‚Ø·. ` +
          'ØµØ­Ù‘Ø­ Ø¨ÙŠØ§Ù†Ø§Øª Ø§Ù„Ø·Ù„Ø§Ø¨ Ø£Ùˆ Ø§Ù„Ø§Ø³Ù… ÙÙŠ Ø§Ù„Ø·Ù„Ø¨ Ø«Ù… Ø£Ø¹Ø¯ Ø§Ù„Ù…Ø­Ø§ÙˆÙ„Ø©.',
        );
      }
    }

    if (!chosen) {
      throw new PermanentError(`Ù„Ù… Ù†Ø¬Ø¯ Ø§Ù„Ø·Ø§Ù„Ø¨ Ø¨Ø§Ù„Ù…Ø¹Ø±Ù: ${req.studentId}`);
    }
    const { key: studentKey } = chosen;

    // â”€â”€ 2) Validate + migrate the face descriptor (if provided)
    // Ù†ÙˆØ­Ù‘Ø¯ Ø£ÙŠ ØµÙŠØºØ© Ø¨ØµÙ…Ø© Ø¥Ù„Ù‰ v5 Ù†Ø¸ÙŠÙØ© â€” Ù†Ù‚Ø¨Ù„ Ø§Ù„Ø¨ØµÙ…Ø© Ø§Ù„Ø¬Ø¯ÙŠØ¯Ø© Ù…Ù‡Ù…Ø§ ÙƒØ§Ù†Øª ØµÙŠØºØªÙ‡Ø§ Ø§Ù„Ù…Ø®Ø²Ù‘Ù†Ø©
    let finalDescriptor = req.faceDescriptor;

    if (req.faceDescriptor) {
      const migrated = migrateToV5(req.faceDescriptor);
      if (!migrated) {
        throw new PermanentError('Ø§Ù„Ø¨ØµÙ…Ø© Ø§Ù„Ù…Ø±ÙÙ‚Ø© ÙØ§Ø±ØºØ© Ø£Ùˆ ØªØ§Ù„ÙØ©. Ø§Ø·Ù„Ø¨ Ù…Ù† Ø§Ù„Ø·Ø§Ù„Ø¨ Ø¥Ø¹Ø§Ø¯Ø© Ø§Ù„ØªØ³Ø¬ÙŠÙ„.');
      }

      // âœ… ÙØ­Øµ Ø§Ù„ØªØ¹Ø§Ø±Ø¶ Ø¹Ù„Ù‰ **ÙƒÙ„** Ø¹ÙŠÙ‘Ù†Ø§Øª Ø§Ù„Ø¨ØµÙ…Ø© (Ù„Ø§ Ø£ÙˆÙ„ Ø¹ÙŠÙ†Ø© ÙÙ‚Ø· â€” Ø¹ÙŠÙ†Ø© Ø§Ù„Ø²Ø§ÙˆÙŠØ© Ø§Ù„Ø¶Ø¹ÙŠÙØ© Ù‚Ø¯ ØªÙØ·Ø§Ø¨Ù‚ ØºÙŠØ±Ù‡Ø§)
      const newSamples = parseAllSamples(migrated);
      if (newSamples.length === 0) {
        throw new PermanentError('Ø§Ù„Ø¨ØµÙ…Ø© Ø§Ù„Ù…Ø±ÙÙ‚Ø© ÙØ§Ø±ØºØ© Ø£Ùˆ ØªØ§Ù„ÙØ©. Ø§Ø·Ù„Ø¨ Ù…Ù† Ø§Ù„Ø·Ø§Ù„Ø¨ Ø¥Ø¹Ø§Ø¯Ø© Ø§Ù„ØªØ³Ø¬ÙŠÙ„.');
      }
      const allStudents: Student[] = entries.map(e => {
        const d = descriptors?.[e.student.id];
        return d !== undefined && d !== null ? { ...e.student, faceDescriptor: d } : e.student;
      });
      for (const sample of newSamples) {
        const tamper = checkForTampering(sample, allStudents, req.studentId);
        if (tamper.tampered) {
          throw new PermanentError(`Ù„Ø§ ÙŠÙ…ÙƒÙ† Ø§Ù„Ù…ÙˆØ§ÙÙ‚Ø©: Ù‡Ø°Ù‡ Ø§Ù„Ø¨ØµÙ…Ø© Ù…Ø·Ø§Ø¨Ù‚Ø© Ù„Ø¨ØµÙ…Ø© Ø§Ù„Ø·Ø§Ù„Ø¨\n${tamper.matchedWith}\n\nÙŠØ±Ø¬Ù‰ Ø§Ù„ØªØ­Ù‚Ù‚ Ù…Ù† ØµØ§Ù„Ø© Ø§Ù„Ø·Ù„Ø¨.`);
        }
      }
      finalDescriptor = migrated;
    }

    // â”€â”€ 3) Update ONLY this student using update() â€” avoids rewriting whole array
    // faceDescriptor ÙŠÙÙƒØªØ¨ ÙÙŠ Ø§Ù„Ø¹Ù‚Ø¯Ø© Ø§Ù„Ù…Ù†ÙØµÙ„Ø© descriptors/ (Ø¨Ù„Ø§ Ù…Ø³Ø§Ø³ Ø¨Ù…ØµÙÙˆÙØ© students)
    onProgress?.('Ø­ÙØ¸ Ø¨ØµÙ…Ø© Ø§Ù„ÙˆØ¬Ù‡...');
    const studentRef = ref(database, `${basePath}/${studentKey}`);
    // âš ï¸ Ù„Ø§ Ù†ÙƒØªØ¨ ØªØ§Ø±ÙŠØ® Â«ØªØ³Ø¬ÙŠÙ„ Ø§Ù„Ø¨ØµÙ…Ø©Â» ÙˆÙ„Ø§ Ù†Ù…Ø³Ø­ Ø±Ù…Ø² QR Ø¥Ù„Ø§ Ø¹Ù†Ø¯ ÙˆØ¬ÙˆØ¯ Ø¨ØµÙ…Ø©/Ù‚ÙŠÙ…Ø© ÙØ¹Ù„ÙŠØ©
    const studentPatch: Record<string, unknown> = {};
    if (typeof req.qrCodeId === 'string' && req.qrCodeId.trim() !== '') {
      studentPatch.qrCodeId = req.qrCodeId;
    }
    if (finalDescriptor !== undefined) {
      studentPatch.faceRegisteredAt = new Date().toISOString();
    }
    if (Object.keys(studentPatch).length > 0) {
      await update(studentRef, studentPatch);
    }
    if (finalDescriptor !== undefined) {
      await set(ref(database, `${descriptorsPath}/${req.studentId}`), finalDescriptor);
    }

    // â”€â”€ 4) Update pending request status + Ø¥Ø²Ø§Ù„Ø© Ù‚ÙŠØ¯ ÙÙ‡Ø±Ø³ Ø§Ù„Ø¨ØµÙ…Ø© Ø§Ù„Ù…Ø¹Ù„Ù‚Ø©
    onProgress?.('ØªØ­Ø¯ÙŠØ« Ø­Ø§Ù„Ø© Ø§Ù„Ø·Ù„Ø¨...');
    await update(ref(database), {
      [`registrationSystem/pending/${adminUid}/${req.id}`]: {
        status: 'approved',
        reviewedAt: new Date().toISOString(),
        reviewedBy: adminUid,
      },
      ...(req.stageId
        ? { [`registrationSystem/pendingFaceIndex/${adminUid}/${req.stageId}/${req.id}`]: null }
        : {}),
    });

    // â”€â”€ 5) ØªØ¹Ù„ÙŠÙ… Ø§Ù„Ø±Ø§Ø¨Ø· Ø§Ù„Ù…Ø®ØµØµ Ù„Ø·Ø§Ù„Ø¨ ÙˆØ§Ø­Ø¯ Â«Ù…Ø³ØªØ®Ø¯Ù…Ø§Ù‹Â» Ø¨Ø¹Ø¯ Ø§Ù„Ù…ÙˆØ§ÙÙ‚Ø© ÙÙ‚Ø·
    if (req.linkType === 'single' && req.linkToken) {
      await markLinkAsUsed(req.linkToken, req.studentId).catch((e) => {
        console.error('ÙØ´Ù„ ØªØ¹Ù„ÙŠÙ… Ø§Ù„Ø±Ø§Ø¨Ø· ÙƒÙ…Ø³ØªØ®Ø¯Ù…:', e);
        toast({ variant: 'destructive', title: 'ØªØ¹Ø°Ù‘Ø± ØªØ¹Ù„ÙŠÙ… Ø§Ù„Ø±Ø§Ø¨Ø· ÙƒÙ…Ø³ØªØ®Ø¯Ù…', description: 'ØªÙ…Øª Ø§Ù„Ù…ÙˆØ§ÙÙ‚Ø©ØŒ Ù„ÙƒÙ† Ø±Ø§Ø¬Ø¹ Ø­Ø§Ù„Ø© Ø§Ù„Ø±Ø§Ø¨Ø· Ù„Ø§Ø­Ù‚Ø§Ù‹.' });
      });
    }
  };

  /**
   * âœ… Ø­Ø§Ø±Ø³ Ù‚Ø¨Ù„ Ø§Ù„Ù…ÙˆØ§ÙÙ‚Ø©:
   *  - ÙŠÙ…Ù†Ø¹ Ø§Ù„Ù…ÙˆØ§ÙÙ‚Ø© Ø¥Ø°Ø§ ÙƒØ§Ù† Ù„Ù„Ø·Ø§Ù„Ø¨ **Ø·Ù„Ø¨ Ø¢Ø®Ø± Ù‚ÙŠØ¯ Ø§Ù„Ù…Ø±Ø§Ø¬Ø¹Ø©** (ÙŠÙƒØªØ¨ Ø§Ù„Ø£Ø®ÙŠØ± Ø¨ØµÙ…Øª).
   *  - Ø§Ù„ØªØ­Ø°ÙŠØ±Ø§Øª (Ø¹Ø¯Ù… ØªØ·Ø§Ø¨Ù‚ Ø§Ù„ÙˆØ¬Ù‡ Ù…Ø¹ Ø§Ù„Ø¨ØµÙ…Ø© Ø§Ù„Ù‚Ø¯ÙŠÙ…Ø© / ÙØ´Ù„ Ø§Ù„ÙØ­Øµ / Ø§Ø³ØªØ¨Ø¯Ø§Ù„ Ø¨ØµÙ…Ø©)
   *    ØªØªØ­ÙˆÙ‘Ù„ Ø¥Ù„Ù‰ Ø³Ø¤Ø§Ù„ ØµØ±ÙŠØ­ Â«Ù…ÙˆØ§ÙÙ‚Ø© Ø§Ø³ØªØ«Ù†Ø§Ø¦ÙŠØ©Â» â€” Ø§Ù„Ù‚Ø±Ø§Ø± Ù„Ù„Ø£Ø¯Ù…Ù†.
   */
  const guardBeforeApprove = async (req: PendingRegistration): Promise<boolean> => {
    const counts = perStudentCount.get(req.studentId);
    if (counts && counts.pending > 1) {
      toast({
        variant: 'destructive',
        title: 'ÙŠÙˆØ¬Ø¯ Ø·Ù„Ø¨ Ø¢Ø®Ø± Ù‚ÙŠØ¯ Ø§Ù„Ù…Ø±Ø§Ø¬Ø¹Ø© Ù„Ù†ÙØ³ Ø§Ù„Ø·Ø§Ù„Ø¨',
        description: `${req.nameInSystem}: ÙˆØ§ÙÙ‚ Ø¹Ù„Ù‰ Ø·Ù„Ø¨ ÙˆØ§Ø­Ø¯ ÙÙ‚Ø· Ù„Ù‡Ø°Ø§ Ø§Ù„Ø·Ø§Ù„Ø¨ â€” Ø§Ù„Ù…ÙˆØ§ÙÙ‚Ø© Ø¹Ù„Ù‰ Ø§Ù„Ø§Ø«Ù†ÙŠÙ† ØªØ¬Ø¹Ù„ Ø¢Ø®Ø±Ù‡Ù…Ø§ ÙŠÙƒØªØ¨ Ø¨ØµÙ…Øª.`,
      });
      return false;
    }

    // âš ï¸ Ø§ÙƒØªØ´Ø§Ù ØªØ¹Ø§Ø±Ø¶ Ø§Ù„Ø¨ØµÙ…Ø© Ù…Ø¹ Ø§Ù„Ø·Ù„Ø¨Ø§Øª Ø§Ù„Ù…Ø¹Ù„Ù‚Ø© Ø§Ù„Ø£Ø®Ø±Ù‰ (Ø·Ù„Ø§Ø¨ Ù…Ø®ØªÙ„ÙÙˆÙ†)
    if (req.faceDescriptor && req.faceDescriptor !== undefined) {
      const currentSamples = parseAllSamples(req.faceDescriptor);
      if (currentSamples.length > 0) {
        for (const otherReq of requests) {
          if (otherReq.id === req.id || otherReq.status !== 'pending') continue;
          const otherDescriptor = otherReq.faceDescriptor;
          if (otherDescriptor && typeof otherDescriptor === 'object') {
            const otherSamples = parseAllSamples(otherDescriptor);
            if (otherSamples.length === 0) continue;
            // ØªØ­Ù‚Ù‚ Ù…Ù† ØªØ´Ø§Ø¨Ù‡ ÙƒÙ„ Ø¹ÙŠÙ†Ø§Øª
            for (const sample of currentSamples) {
              for (const otherSample of otherSamples) {
                const distance = descriptorDistance(sample, otherSample);
                if (distance < MATCH_STRICT) {
                  toast({
                    variant: 'destructive',
                    title: 'ØªØ¹Ø§Ø±Ø¶ ÙÙŠ Ø§Ù„Ø¨ØµÙ…Ø§Øª â€” ØªÙ… Ø±ÙØ¶ Ø§Ù„Ù…ÙˆØ§ÙÙ‚Ø©',
                    description: `Ø§Ù„Ø¨ØµÙ…Ø© ${req.nameInSystem} Ù‚Ø±ÙŠØ¨Ø© Ø¬Ø¯Ø§Ù‹ (${distance.toFixed(3)}) Ù…Ù† ${otherReq.nameInSystem} â€” Ø¥Ù…Ø§ Ø±ÙØ¶ Ù‡Ø°Ø§ Ø£Ùˆ Ø§Ù†ØªØ¸Ø±`,
                  });
                  return false;
                }
              }
            }
          }
        }
      }
    }

    const notes: string[] = [];
    if (req.selfMismatch) notes.push('Ø§Ù„ÙˆØ¬Ù‡ Ø§Ù„Ø¬Ø¯ÙŠØ¯ Ù„Ø§ ÙŠØ·Ø§Ø¨Ù‚ Ø¨ØµÙ…Ø© Ø§Ù„Ø·Ø§Ù„Ø¨ Ø§Ù„Ù…Ø³Ø¬Ù‘Ù„Ø© Ø³Ø§Ø¨Ù‚Ø§Ù‹');
    if (req.checksFailed) notes.push('ÙØ­Øµ ØªÙƒØ±Ø§Ø± Ø§Ù„Ø¨ØµÙ…Ø© Ù„Ù… ÙŠÙƒØªÙ…Ù„ Ù‚Ø¨Ù„ Ø§Ù„Ø¥Ø±Ø³Ø§Ù„');
    if (req.hasExistingFace) notes.push('Ø³ÙŠØªÙ… Ø§Ø³ØªØ¨Ø¯Ø§Ù„ Ø¨ØµÙ…Ø© Ù…ÙˆØ¬ÙˆØ¯Ø©');
    if (notes.length === 0) return true;

    return confirmAction({
      title: 'ØªØ£ÙƒÙŠØ¯ Ù…ÙˆØ§ÙÙ‚Ø© Ø§Ø³ØªØ«Ù†Ø§Ø¦ÙŠØ©',
      message: `${req.nameInSystem}: ${notes.join(' Â· ')}. Ù‡Ù„ ØªÙˆØ§ÙÙ‚ Ø±ØºÙ… Ø°Ù„ÙƒØŸ`,
      confirmLabel: 'Ù…ÙˆØ§ÙÙ‚Ø© Ø§Ø³ØªØ«Ù†Ø§Ø¦ÙŠØ©',
    });
  };

  const handleApprove = async (req: PendingRegistration) => {
    // âœ… Ø§Ù„Ù‚ÙÙ„ ÙŠÙØ¶Ø¨Ø· **Ù‚Ø¨Ù„** Ø£ÙˆÙ„ await: Ù…Ø¹ `await` ÙÙŠ Ø§Ù„Ø­Ø§Ø±Ø³ ÙƒØ§Ù† Ù†Ù‚Ø±ØªØ§Ù† Ù…ØªØ²Ø§Ù…Ù†ØªØ§Ù† ÙŠÙ…Ø±Ù‘Ø§Ù† Ù…Ø¹Ø§Ù‹
    //    ÙÙŠÙƒØªØ¨ ÙƒÙ„ÙŒÙ‘ Ù…Ù†Ù‡Ù…Ø§ Ø¨ØµÙ…ØªÙ‡ Ø¹Ù„Ù‰ Ù†ÙØ³ Ø§Ù„Ø·Ø§Ù„Ø¨ØŒ ÙˆØ¢Ø®Ø± ÙƒØªØ§Ø¨Ø© ØªÙƒØªÙ… Ø§Ù„Ø£ÙˆÙ„Ù‰ Ø¨ØµÙ…Øª.
    if (busyRef.current) return;
    busyRef.current = true;

    try {
      if (!(await guardBeforeApprove(req))) return;

      startProcessing(req.id);
      setSaving({ title: 'Ø¬Ø§Ø±ÙŠ Ø­ÙØ¸ Ø¨ØµÙ…Ø© Ø§Ù„Ø·Ø§Ù„Ø¨', detail: `${req.nameInSystem} â€” Ù„Ø§ ØªØºÙ„Ù‚ Ø§Ù„Ù†Ø§ÙØ°Ø© Ù‚Ø¨Ù„ Ø§ÙƒØªÙ…Ø§Ù„ Ø§Ù„Ø­ÙØ¸` });
      await withRetry(
        () => approveRequest(req, msg => setSaving(prev => (prev ? { ...prev, detail: `${req.nameInSystem} â€” ${msg}` } : prev))),
        3,
        next => setSaving(prev => (prev ? { ...prev, detail: `ØªØ¹Ø°Ù‘Ø± Ø§Ù„ÙˆØµÙˆÙ„ Ù„Ù‚Ø§Ø¹Ø¯Ø© Ø§Ù„Ø¨ÙŠØ§Ù†Ø§Øª â€” Ø¥Ø¹Ø§Ø¯Ø© Ø§Ù„Ù…Ø­Ø§ÙˆÙ„Ø© (${next} Ù…Ù† 3)`, attempt: next } : prev)),
      );
      toast({ title: 'ØªÙ… Ø­ÙØ¸ Ø§Ù„Ø¨ØµÙ…Ø© Ø¨Ù†Ø¬Ø§Ø­ âœ…', description: `${req.nameInSystem} â€” Ø³ÙØ¬Ù„Øª Ø§Ù„Ù…ÙˆØ§ÙÙ‚Ø© ÙˆØ§Ù„Ø¨ØµÙ…Ø© ÙÙŠ Ù‚Ø§Ø¹Ø¯Ø© Ø§Ù„Ø¨ÙŠØ§Ù†Ø§Øª.` });
    } catch (e) {
      console.error('âŒ Ø®Ø·Ø£ ÙÙŠ Ø§Ù„Ù…ÙˆØ§ÙÙ‚Ø©:', e);
      toast({ variant: 'destructive', title: 'ÙØ´Ù„Øª Ø¹Ù…Ù„ÙŠØ© Ø§Ù„Ø­ÙØ¸ Ø¨Ø¹Ø¯ Ø¥Ø¹Ø§Ø¯Ø© Ø§Ù„Ù…Ø­Ø§ÙˆÙ„Ø©', description: e instanceof Error ? e.message : 'Ø®Ø·Ø£ ØºÙŠØ± Ù…Ø¹Ø±ÙˆÙ' });
    } finally {
      setSaving(null);
      stopProcessing(req.id);
      busyRef.current = false;
    }
  };

  /** Ø§Ù„Ù…ÙˆØ§ÙÙ‚Ø© Ø¹Ù„Ù‰ ÙƒÙ„ Ø§Ù„Ø·Ù„Ø¨Ø§Øª Â«Ù‚ÙŠØ¯ Ø§Ù„Ù…Ø±Ø§Ø¬Ø¹Ø©Â» Ø¯ÙØ¹Ø© ÙˆØ§Ø­Ø¯Ø© Ù…Ø¹ Ø´Ø±ÙŠØ· ØªÙ‚Ø¯Ù‘Ù… ÙˆØ¥Ø¹Ø§Ø¯Ø© Ù…Ø­Ø§ÙˆÙ„Ø© ØªÙ„Ù‚Ø§Ø¦ÙŠØ© */
  const handleApproveAll = async () => {
    // âœ… Ø§Ù„Ù‚ÙÙ„ ÙŠØºØ·ÙŠ Ù†Ø§ÙØ°Ø© Ø§Ù„ØªØ£ÙƒÙŠØ¯ Ø£ÙŠØ¶Ø§Ù‹ â€” Ù†Ù‚Ø±ØªØ§Ù† Ù…ØªØ²Ø§Ù…Ù†ØªØ§Ù† ÙƒØ§Ù†ØªØ§ ØªÙØªØ­Ø§Ù† Ù†Ø§ÙØ°ØªÙŠÙ† ÙˆØªÙƒØªØ¨Ø§Ù† Ù…Ø±ØªÙŠÙ†
    if (busyRef.current) return;
    busyRef.current = true;

    const pendingList = requests.filter(r => r.status === 'pending');
    const total = pendingList.length;
    const failures: { name: string; msg: string }[] = [];

    try {
      if (total === 0) return;

      const ok = await confirmAction({
        title: 'Ø§Ù„Ù…ÙˆØ§ÙÙ‚Ø© Ø¹Ù„Ù‰ ÙƒÙ„ Ø§Ù„Ø¨ØµÙ…Ø§Øª',
        message: `Ø³ÙŠØªÙ… Ø­ÙØ¸ Ø¨ØµÙ…Ø§Øª ${total} Ø·Ø§Ù„Ø¨Ø§Ù‹ Ø¯ÙØ¹Ø© ÙˆØ§Ø­Ø¯Ø©ØŒ ÙˆÙ„Ø§ ØªÙØºÙ„Ù‚ Ø§Ù„Ù†Ø§ÙØ°Ø© Ø­ØªÙ‰ ØªÙƒØªÙ…Ù„ Ø§Ù„Ø¹Ù…Ù„ÙŠØ©. Ù…ØªØ§Ø¨Ø¹Ø©ØŸ`,
        confirmLabel: 'Ù…ÙˆØ§ÙÙ‚Ø© Ø§Ù„ÙƒÙ„',
      });
      if (!ok) return;

      setSaving({ title: 'Ø¬Ø§Ø±ÙŠ Ø­ÙØ¸ ÙƒÙ„ Ø§Ù„Ø¨ØµÙ…Ø§Øª', detail: 'Ø§Ù„Ø¨Ø¯Ø¡...', current: 0, total });
      for (const [i, req] of pendingList.entries()) {
        startProcessing(req.id);
        setSaving({ title: 'Ø¬Ø§Ø±ÙŠ Ø­ÙØ¸ ÙƒÙ„ Ø§Ù„Ø¨ØµÙ…Ø§Øª', detail: `${req.nameInSystem}`, current: i + 1, total });
        // âœ… Ø§Ù„Ù…ÙˆØ§ÙÙ‚Ø© Ø§Ù„Ø¬Ù…Ø§Ø¹ÙŠØ© ØªØªØ®Ø·Ù‰ Ø§Ù„Ø·Ù„Ø¨Ø§Øª Ø§Ù„ØªÙŠ ØªØ­ØªØ§Ø¬ Ù‚Ø±Ø§Ø±Ø§Ù‹ Ù…Ù†ÙØ±Ø¯Ø§Ù‹ (Ù…ÙƒØ±Ù‘Ø±Ø© Ø£Ùˆ Ø¨Ù‡Ø§ ØªØ­Ø°ÙŠØ±Ø§Øª)
        const counts = perStudentCount.get(req.studentId);
        if (counts && counts.pending > 1) {
          failures.push({ name: req.nameInSystem, msg: 'ÙŠÙˆØ¬Ø¯ Ø·Ù„Ø¨ Ø¢Ø®Ø± Ù„Ù†ÙØ³ Ø§Ù„Ø·Ø§Ù„Ø¨ â€” Ø±Ø§Ø¬Ø¹ Ø§Ù„Ø·Ù„Ø¨Ø§Øª ÙŠØ¯ÙˆÙŠØ§Ù‹' });
          continue;
        }
        if (req.selfMismatch || req.checksFailed) {
          const why = req.selfMismatch ? 'Ø§Ù„ÙˆØ¬Ù‡ Ù„Ø§ ÙŠØ·Ø§Ø¨Ù‚ Ø¨ØµÙ…ØªÙ‡ Ø§Ù„Ù…Ø³Ø¬Ù‘Ù„Ø©' : 'ÙØ­Øµ Ø§Ù„ØªÙƒØ±Ø§Ø± Ù„Ù… ÙŠÙƒØªÙ…Ù„';
          failures.push({ name: req.nameInSystem, msg: `${why} â€” ÙŠØ­ØªØ§Ø¬ Ù…ÙˆØ§ÙÙ‚Ø© ÙØ±Ø¯ÙŠØ©` });
          continue;
        }
        try {
          await withRetry(
            () => approveRequest(req, msg => setSaving(prev => (prev ? { ...prev, detail: `${req.nameInSystem} â€” ${msg}` } : prev))),
            3,
            next => setSaving(prev => (prev ? { ...prev, detail: `${req.nameInSystem} â€” Ø¥Ø¹Ø§Ø¯Ø© Ø§Ù„Ù…Ø­Ø§ÙˆÙ„Ø© (${next} Ù…Ù† 3)` } : prev)),
          );
        } catch (e) {
          failures.push({ name: req.nameInSystem, msg: e instanceof Error ? e.message : 'Ø®Ø·Ø£ ØºÙŠØ± Ù…Ø¹Ø±ÙˆÙ' });
        }
      }

      const saved = total - failures.length;
      if (failures.length === 0) {
        toast({ title: `ØªÙ… Ø­ÙØ¸ ${saved} Ø¨ØµÙ…Ø© âœ…`, description: 'ÙƒÙ„ Ø§Ù„Ø·Ù„Ø¨Ø§Øª Ø§Ù„Ù…Ø¹Ù„Ù‚Ø© Ù…Ø­ÙÙˆØ¸Ø© ÙÙŠ Ù‚Ø§Ø¹Ø¯Ø© Ø§Ù„Ø¨ÙŠØ§Ù†Ø§Øª.' });
      } else {
        toast({
          variant: 'destructive',
          title: `ØªÙ… Ø­ÙØ¸ ${saved} â€” ÙˆÙØ´Ù„ ${failures.length} Ø¨Ø¹Ø¯ Ø¥Ø¹Ø§Ø¯Ø© Ø§Ù„Ù…Ø­Ø§ÙˆÙ„Ø©`,
          description: failures.slice(0, 5).map(f => `${f.name}: ${f.msg}`).join('\n') + (failures.length > 5 ? `\n+${failures.length - 5} Ø·Ù„Ø¨Ø§Øª Ø£Ø®Ø±Ù‰` : ''),
        });
      }
    } catch (e) {
      console.error('âŒ Ø®Ø·Ø£ ÙÙŠ Ø§Ù„Ù…ÙˆØ§ÙÙ‚Ø© Ø§Ù„Ø¬Ù…Ø§Ø¹ÙŠØ©:', e);
      toast({ variant: 'destructive', title: 'ÙØ´Ù„Øª Ø§Ù„Ù…ÙˆØ§ÙÙ‚Ø© Ø§Ù„Ø¬Ù…Ø§Ø¹ÙŠØ©', description: e instanceof Error ? e.message : 'Ø®Ø·Ø£ ØºÙŠØ± Ù…Ø¹Ø±ÙˆÙ' });
    } finally {
      clearProcessing();
      setSaving(null);
      busyRef.current = false;
    }
  };

  const handleReject = async (req: PendingRegistration, reason: string) => {
    startProcessing(req.id);

    try {
      await withTimeout(update(ref(database), {
        [`registrationSystem/pending/${adminUid}/${req.id}`]: {
          status: 'rejected',
          rejectionReason: reason || 'Ø¨Ø¯ÙˆÙ† Ø³Ø¨Ø¨ Ù…Ø­Ø¯Ø¯',
          reviewedAt: new Date().toISOString(),
          reviewedBy: adminUid,
        },
        ...(req.stageId
          ? { [`registrationSystem/pendingFaceIndex/${adminUid}/${req.stageId}/${req.id}`]: null }
          : {}),
      }));

      setRejectingId(null);
      setRejectReason('');
    } catch (e: any) {
      console.error(e);
      toast({ variant: 'destructive', title: 'ÙØ´Ù„Øª Ø§Ù„Ø¹Ù…Ù„ÙŠØ©' });
    } finally {
      stopProcessing(req.id);
    }
  };

  const handleDelete = async (req: PendingRegistration) => {
    try {
      await update(ref(database), {
        [`registrationSystem/pending/${adminUid}/${req.id}`]: null,
        ...(req.stageId
          ? { [`registrationSystem/pendingFaceIndex/${adminUid}/${req.stageId}/${req.id}`]: null }
          : {}),
      });
    } catch (e) {
      console.error(e);
      toast({ variant: 'destructive', title: 'ÙØ´Ù„ Ø§Ù„Ø­Ø°Ù' });
    }
  };

  // Ø­Ø°Ù ÙƒÙ„ Ø§Ù„Ø·Ù„Ø¨Ø§Øª Ø§Ù„ØªÙŠ Ø¨ØµÙ…ØªÙ‡Ø§ ØªØ§Ù„ÙØ©/ÙØ§Ø±ØºØ© (Ø£ÙÙ†Ø´Ø¦Øª Ù‚Ø¨Ù„ ØªÙØ¹ÙŠÙ„ Ø§Ù„ØªØ­Ù‚Ù‚ Ø§Ù„ØµØ§Ø±Ù…) â€” Ù„Ø§ ÙŠÙ…ÙƒÙ† Ø§Ù„Ù…ÙˆØ§ÙÙ‚Ø© Ø¹Ù„ÙŠÙ‡Ø§ Ø£Ø¨Ø¯Ø§Ù‹
  const handlePurgeCorrupt = async () => {
    const corrupt = requests.filter(r => r.faceDescriptor && migrateToV5(r.faceDescriptor) === null);
    if (corrupt.length === 0) {
      toast({ title: 'Ù„Ø§ ØªÙˆØ¬Ø¯ Ø·Ù„Ø¨Ø§Øª ØªØ§Ù„ÙØ© â€” ÙƒÙ„ Ø§Ù„Ø¨ØµÙ…Ø§Øª Ø³Ù„ÙŠÙ…Ø© âœ…' });
      return;
    }
    const ok = await confirmAction({
      title: 'Ø­Ø°Ù Ø§Ù„Ø·Ù„Ø¨Ø§Øª Ø§Ù„ØªØ§Ù„ÙØ©',
      message: `Ø³ÙŠØªÙ… Ø­Ø°Ù ${corrupt.length} Ø·Ù„Ø¨Ø§Ù‹ ØªØ§Ù„ÙØ§Ù‹ Ù†Ù‡Ø§Ø¦ÙŠØ§Ù‹. Ø¹Ù„Ù‰ Ø§Ù„Ø·Ù„Ø§Ø¨ Ø§Ù„Ù…ØªØ£Ø«Ø±ÙŠÙ† Ø¥Ø¹Ø§Ø¯Ø© Ø§Ù„ØªØ³Ø¬ÙŠÙ„ Ù…Ù† Ø±Ø§Ø¨Ø·Ù‡Ù…. Ù…ØªØ§Ø¨Ø¹Ø©ØŸ`,
      confirmLabel: 'Ø­Ø°Ù',
    });
    if (!ok) return;

    setPurging(true);
    try {
      const updates: { [key: string]: null } = {};
      for (const r of corrupt) {
        updates[`registrationSystem/pending/${adminUid}/${r.id}`] = null;
        if (r.stageId) {
          updates[`registrationSystem/pendingFaceIndex/${adminUid}/${r.stageId}/${r.id}`] = null;
        }
      }
      await update(ref(database), updates);
      toast({ title: `ØªÙ… Ø­Ø°Ù ${corrupt.length} Ø·Ù„Ø¨Ø§Ù‹ ØªØ§Ù„ÙØ§Ù‹.` });
    } catch (e) {
      console.error(e);
      toast({ variant: 'destructive', title: 'ÙØ´Ù„ Ø­Ø°Ù Ø§Ù„Ø·Ù„Ø¨Ø§Øª Ø§Ù„ØªØ§Ù„ÙØ©' });
    } finally {
      setPurging(false);
    }
  };

  const stats = useMemo(() => ({
    total: requests.length,
    pending: requests.filter(r => r.status === 'pending').length,
    approved: requests.filter(r => r.status === 'approved').length,
    rejected: requests.filter(r => r.status === 'rejected').length,
  }), [requests]);

  /**
   * âš ï¸ Ø¹Ø¯Ù‘Ø§Ø¯ Ø§Ù„Ø·Ù„Ø¨Ø§Øª Ù„ÙƒÙ„ Ø·Ø§Ù„Ø¨ (Ù…Ù†Ù‡Ø§ Ù‚ÙŠØ¯ Ø§Ù„Ù…Ø±Ø§Ø¬Ø¹Ø©) â€” ÙŠÙ…Ù†Ø¹ Ø§Ù„Ù…ÙˆØ§ÙÙ‚Ø© Ø¹Ù„Ù‰ Ø£ÙƒØ«Ø± Ù…Ù† Ø·Ù„Ø¨
   * Ù„Ù†ÙØ³ Ø§Ù„Ø·Ø§Ù„Ø¨ (Ø§Ù„Ø°ÙŠ ÙŠÙƒØªØ¨ Ø£Ø®ÙŠØ±Ø§Ù‹ Ù‡Ùˆ Ø§Ù„ÙØ§Ø¦Ø² Ø¨ØµÙ…Øª).
   */
  const perStudentCount = useMemo(() => {
    const map = new Map<string, { total: number; pending: number }>();
    for (const r of requests) {
      if (!r.studentId) continue;
      const cur = map.get(r.studentId) ?? { total: 0, pending: 0 };
      cur.total += 1;
      if (r.status === 'pending') cur.pending += 1;
      map.set(r.studentId, cur);
    }
    return map;
  }, [requests]);

  return (
    <div className="fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center p-4 animate-fadeIn" dir="rtl">
{ConfirmDialogEl}

      {/* Ù†Ø§ÙØ°Ø© Ø­ÙØ¸ Ù…Ø³Ø¯ÙˆØ¯Ø© â€” Ù„Ø§ Ø²Ø± Ø¥ØºÙ„Ø§Ù‚ ÙˆÙ„Ø§ Ø®Ù„ÙÙŠØ© ØªÙ†Ø¶ØºØ·ØŒ ØªØ®ØªÙÙŠ ÙÙ‚Ø· Ø¨Ø¹Ø¯ Ø§Ø³ØªÙ‚Ø±Ø§Ø± Ø§Ù„ÙƒØªØ§Ø¨Ø§Øª */}
      {saving && (
        <div
          className="fixed inset-0 z-[10001] bg-black/85 backdrop-blur-sm flex items-center justify-center p-4 animate-fadeIn"
          role="alertdialog"
          aria-modal="true"
          aria-live="assertive"
        >
          <div className="glass-modal w-[calc(100vw-2rem)] max-w-sm text-white text-center">
            <MorphingSquare size="lg" />
            <h3 className="text-base sm:text-lg font-semibold text-white mt-4">{saving.title}</h3>
            <p className="text-sm text-slate-300 mt-2 leading-relaxed break-words">{saving.detail}</p>

            {typeof saving.attempt === 'number' && (
              <p className="text-xs font-bold text-amber-300 mt-3">
                <TriangleAlert className="w-3.5 h-3.5 inline ms-1" />
                Ù…Ø­Ø§ÙˆÙ„Ø© {saving.attempt} Ù…Ù† 3 â€” Ø³ÙŠØªÙ… Ø¥Ø¹Ø§Ø¯Ø© Ø§Ù„Ù…Ø­Ø§ÙˆÙ„Ø© ØªÙ„Ù‚Ø§Ø¦ÙŠØ§Ù‹
              </p>
            )}

            {typeof saving.total === 'number' && saving.total > 0 ? (
              <div className="mt-5">
                <div
                  className="h-2.5 w-full rounded-full bg-white/10 overflow-hidden"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={saving.total}
                  aria-valuenow={saving.current ?? 0}
                >
                  <div
                    className="h-full rounded-full bg-emerald-500 transition-[width] duration-300"
                    style={{ width: `${Math.min(100, Math.round(((saving.current ?? 0) / saving.total) * 100))}%` }}
                  />
                </div>
                <p className="text-xs text-slate-400 mt-2 font-bold">
                  {saving.current} / {saving.total} Ø·Ø§Ù„Ø¨
                </p>
              </div>
            ) : (
              <p className="text-xs text-slate-500 mt-5">
                Ù„Ù† ØªÙØºÙ„Ù‚ Ù‡Ø°Ù‡ Ø§Ù„Ù†Ø§ÙØ°Ø© Ù‚Ø¨Ù„ Ø§ÙƒØªÙ…Ø§Ù„ Ø§Ù„Ø­ÙØ¸ ÙÙŠ Ù‚Ø§Ø¹Ø¯Ø© Ø§Ù„Ø¨ÙŠØ§Ù†Ø§Øª
              </p>
            )}
          </div>
        </div>
      )}

<div className="glass-modal p-0 text-white w-[calc(100vw-2rem)] max-w-5xl max-h-[95vh] flex flex-col overflow-hidden animate-modalUp focus:outline-none">

        <div className="px-4 sm:px-5 py-4 border-b border-white/10 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <h2 className="text-base sm:text-lg font-semibold text-white flex items-center gap-2 flex-wrap">
              <ClipboardList className="w-6 h-6 text-indigo-400 shrink-0" /> Ø·Ù„Ø¨Ø§Øª Ø§Ù„ØªØ³Ø¬ÙŠÙ„ Ø§Ù„Ø°Ø§ØªÙŠ
              {stats.pending > 0 && (
                <span className="bg-red-500 text-white text-sm px-2.5 py-0.5 rounded-full animate-pulse">
                  {stats.pending}
                </span>
              )}
            </h2>
            <p className="text-sm text-slate-400 mt-1">Ù…Ø±Ø§Ø¬Ø¹Ø© Ø·Ù„Ø¨Ø§Øª Ø§Ù„Ø·Ù„Ø§Ø¨ Ø§Ù„Ø°Ø§ØªÙŠØ©</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {stats.pending > 0 && (
              <button
                onClick={handleApproveAll}
                disabled={!!saving || purging}
                title="Ø§Ù„Ù…ÙˆØ§ÙÙ‚Ø© Ø¹Ù„Ù‰ ÙƒÙ„ Ø§Ù„Ø·Ù„Ø¨Ø§Øª Ù‚ÙŠØ¯ Ø§Ù„Ù…Ø±Ø§Ø¬Ø¹Ø© ÙˆØ­ÙØ¸ Ø¨ØµÙ…Ø§ØªÙ‡Ø§ Ø¯ÙØ¹Ø© ÙˆØ§Ø­Ø¯Ø©"
                className="btn-base btn-primary"
              >
                <CheckCheck className="w-4 h-4" />
                Ù…ÙˆØ§ÙÙ‚Ø© Ø§Ù„ÙƒÙ„
              </button>
            )}
            <button
              onClick={handlePurgeCorrupt}
              disabled={purging}
              title="Ø­Ø°Ù Ø§Ù„Ø·Ù„Ø¨Ø§Øª Ø§Ù„ØªÙŠ Ø¨ØµÙ…ØªÙ‡Ø§ ØªØ§Ù„ÙØ© ÙˆÙ„Ø§ ÙŠÙ…ÙƒÙ† Ø§Ù„Ù…ÙˆØ§ÙÙ‚Ø© Ø¹Ù„ÙŠÙ‡Ø§"
              className="btn-base btn-danger"
            >
              {purging ? <MorphingSquare size="xs" /> : <Trash2 className="w-4 h-4" />}
              Ø­Ø°Ù Ø§Ù„ØªØ§Ù„ÙØ©
            </button>
            <button
              onClick={safeClose}
              disabled={!!saving}
              title={saving ? 'Ø¬Ø§Ø±ÙŠ Ø§Ù„Ø­ÙØ¸ â€” Ù„Ø§ ÙŠÙ…ÙƒÙ† Ø§Ù„Ø¥ØºÙ„Ø§Ù‚ Ø§Ù„Ø¢Ù†' : 'Ø¥ØºÙ„Ø§Ù‚'}
              className="btn-base btn-secondary"
            >
              âœ• Ø¥ØºÙ„Ø§Ù‚
            </button>
          </div>
        </div>

        <div className="px-4 sm:px-5 py-3 border-b border-white/10 bg-white/5 shrink-0">
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setFilter('all')}
              className={`flex-1 min-w-[calc(50%_-_0.25rem)] sm:min-w-0 p-2 rounded-lg text-center transition duration-200 ${
                filter === 'all' ? 'bg-blue-500/15 border-2 border-blue-500/50' : 'bg-white/5 border border-white/10'
              }`}
            >
              <div className="text-lg font-bold text-white">{stats.total}</div>
              <div className="text-xs text-slate-400">Ø§Ù„Ø¥Ø¬Ù…Ø§Ù„ÙŠ</div>
            </button>
            <button
              onClick={() => setFilter('pending')}
              className={`flex-1 min-w-[calc(50%_-_0.25rem)] sm:min-w-0 p-2 rounded-lg text-center transition duration-200 ${
                filter === 'pending' ? 'bg-amber-500/15 border-2 border-amber-500/50' : 'bg-white/5 border border-white/10'
              }`}
            >
              <div className="text-lg font-bold text-amber-300">{stats.pending}</div>
              <div className="text-xs text-amber-400">Ù‚ÙŠØ¯ Ø§Ù„Ù…Ø±Ø§Ø¬Ø¹Ø©</div>
            </button>
            <button
              onClick={() => setFilter('approved')}
              className={`flex-1 min-w-[calc(50%_-_0.25rem)] sm:min-w-0 p-2 rounded-lg text-center transition duration-200 ${
                filter === 'approved' ? 'bg-emerald-500/15 border-2 border-emerald-500/50' : 'bg-white/5 border border-white/10'
              }`}
            >
              <div className="text-lg font-bold text-emerald-300">{stats.approved}</div>
              <div className="text-xs text-emerald-400">Ù…ÙˆØ§ÙÙ‚ Ø¹Ù„ÙŠÙ‡Ø§</div>
            </button>
            <button
              onClick={() => setFilter('rejected')}
              className={`flex-1 min-w-[calc(50%_-_0.25rem)] sm:min-w-0 p-2 rounded-lg text-center transition duration-200 ${
                filter === 'rejected' ? 'bg-red-500/15 border-2 border-red-500/50' : 'bg-white/5 border border-white/10'
              }`}
            >
              <div className="text-lg font-bold text-red-300">{stats.rejected}</div>
              <div className="text-xs text-red-400">Ù…Ø±ÙÙˆØ¶Ø©</div>
            </button>
          </div>
        </div>

        <div className="px-4 sm:px-5 py-3 border-b border-white/10 shrink-0">
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Ø¨Ø­Ø« Ø¨Ø§Ù„Ø§Ø³Ù… Ø£Ùˆ Ø§Ù„ÙƒÙˆØ¯ Ø£Ùˆ Ø±Ù‚Ù… Ø§Ù„Ù‡ÙˆÙŠØ©..."
            className="glass-input text-sm"
          />
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-5 py-4 space-y-4">
          {loading ? (
            <div className="p-4">
              <LoadingState size="sm" className="py-6" />
            </div>
          ) : filteredRequests.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <div className="mx-auto w-14 h-14 rounded-full bg-slate-500/10 border border-slate-500/30 flex items-center justify-center mb-4"><Mail className="w-7 h-7 text-slate-400" /></div>
              <p className="font-medium">
                {filter === 'pending' ? 'Ù„Ø§ ØªÙˆØ¬Ø¯ Ø·Ù„Ø¨Ø§Øª Ù‚ÙŠØ¯ Ø§Ù„Ù…Ø±Ø§Ø¬Ø¹Ø©' : 'Ù„Ø§ ØªÙˆØ¬Ø¯ Ø·Ù„Ø¨Ø§Øª'}
              </p>
            </div>
          ) : (
            filteredRequests.map(req => {
              const isProcessing = processing.has(req.id);
              const isPending = req.status === 'pending';
              const isApproved = req.status === 'approved';
              const isRejected = req.status === 'rejected';
              const isRejecting = rejectingId === req.id;
              const siblingCount = perStudentCount.get(req.studentId)?.total ?? 0;

              return (
                <div
                  key={req.id}
                  className={`border-2 rounded-xl p-4 transition ${
                    isPending ? 'border-amber-500/40 bg-amber-500/10' :
                    isApproved ? 'border-emerald-500/40 bg-emerald-500/10' :
                    'border-red-500/40 bg-red-500/10'
                  }`}
                >
                  <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-bold px-2 py-1 rounded-full flex items-center gap-1 ${
                        isPending ? 'bg-amber-500/20 text-amber-300' :
                        isApproved ? 'bg-emerald-500/20 text-emerald-300' :
                        'bg-red-500/20 text-red-300'
                      }`}>
                        {isPending ? <><MorphingSquare size="xs" /> Ù‚ÙŠØ¯ Ø§Ù„Ù…Ø±Ø§Ø¬Ø¹Ø©</> :
                         isApproved ? <><CircleCheck className="w-3 h-3" /> ØªÙ…Øª Ø§Ù„Ù…ÙˆØ§ÙÙ‚Ø©</> :
                         <><CircleX className="w-3 h-3" /> Ù…Ø±ÙÙˆØ¶</>}
                      </span>
                      <span className="text-xs text-slate-400">
                        {new Date(req.createdAt).toLocaleString('ar-EG')}
                      </span>
                    </div>

                    <div className={`text-xs font-bold px-3 py-1 rounded-full ${
                      req.qrVerified ? 'bg-emerald-500 text-white' : 'bg-amber-500 text-white'
                    }`}>
                      {req.qrVerified ? 'âœ… QR Ù…ØªØ­Ù‚Ù‚' : 'âš ï¸ Ø¨Ø¯ÙˆÙ† QR'}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                    <div className="bg-slate-800 rounded-lg p-3 border border-blue-500/30">
                      <p className="text-xs text-blue-400 font-bold mb-1 flex items-center gap-1"><Save className="w-3.5 h-3.5" /> Ù…Ù† Ø§Ù„Ù†Ø¸Ø§Ù…:</p>
                      <p className="font-bold text-blue-200 text-sm">{req.nameInSystem}</p>
                      <p className="text-xs text-blue-400 mt-0.5">Ø§Ù„Ø±Ù…Ø²: {req.studentCode}</p>
                    </div>
                    <div className="bg-slate-800 rounded-lg p-3 border border-purple-500/30">
                      <p className="text-xs text-purple-400 font-bold mb-1 flex items-center gap-1"><Camera className="w-3.5 h-3.5" /> Ù…Ù† Ø§Ù„Ø¨Ø·Ø§Ù‚Ø©:</p>
                      <p className="font-bold text-purple-200 text-sm">{req.nameFromCard || 'â€”'}</p>
                      {req.nationalId && (
                        <p className="text-xs text-purple-400 mt-0.5">Ù‡ÙˆÙŠØ©: {req.nationalId}</p>
                      )}
                      {req.qrCodeId && (
                        <p className="text-xs text-purple-400 mt-0.5">QR: {req.qrCodeId.slice(0, 20)}...</p>
                      )}
                    </div>
                  </div>

                  <div className="flex gap-2 flex-wrap mb-3">
                    <span className={`text-xs border rounded-full px-2 py-1 flex items-center gap-1 ${
                      req.qrVerified
                        ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                        : 'bg-slate-800 border-slate-600'
                    }`}>
                      <QrCode className="w-3 h-3" /> {req.qrVerified ? 'QR Ù…ØªØ­Ù‚Ù‚' : 'QR ØºÙŠØ± Ù…ØªØ­Ù‚Ù‚'}
                    </span>
                    <span className={`text-xs border rounded-full px-2 py-1 flex items-center gap-1 ${
                      req.nameMatched
                        ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                        : 'bg-slate-800 border-slate-600'
                    }`}>
                      <ClipboardList className="w-3 h-3" /> {req.nameMatched ? 'Ø§Ù„Ø§Ø³Ù… Ù…ØªØ·Ø§Ø¨Ù‚' : 'Ø§Ù„Ø§Ø³Ù… ØºÙŠØ± Ù…ØªØ·Ø§Ø¨Ù‚'}
                    </span>
                    <span className={`text-xs border rounded-full px-2 py-1 flex items-center gap-1 ${
                      migrateToV5(req.faceDescriptor) !== null
                        ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                        : req.faceDescriptor
                        ? 'bg-amber-500/15 border-amber-500/30 text-amber-300'
                        : 'bg-slate-800 border-slate-600'
                    }`}>
                      <Smile className="w-3 h-3" /> {
                        migrateToV5(req.faceDescriptor) !== null ? 'Ø¨ØµÙ…Ø© ÙˆØ¬Ù‡ Ù…Ø³Ø¬Ù„Ø©'
                          : req.faceDescriptor ? 'Ø¨ØµÙ…Ø© Ù‚Ø¯ÙŠÙ…Ø© â€” ØªØ­ØªØ§Ø¬ Ø¥Ø¹Ø§Ø¯Ø© ØªØ³Ø¬ÙŠÙ„'
                          : 'Ø¨Ø¯ÙˆÙ† Ø¨ØµÙ…Ø©'
                      }
                    </span>
                    {req.hasExistingQr && (
                      <span className="text-xs bg-amber-500/15 border border-amber-500/30 text-amber-300 rounded-full px-2 py-1 flex items-center gap-1">
                        <TriangleAlert className="w-3 h-3" /> Ø³ÙŠØªÙ… Ø§Ø³ØªØ¨Ø¯Ø§Ù„ QR Ù‚Ø¯ÙŠÙ…
                      </span>
                    )}
                    {req.hasExistingFace && (
                      <span className="text-xs bg-amber-500/15 border border-amber-500/30 text-amber-300 rounded-full px-2 py-1 flex items-center gap-1">
                        <TriangleAlert className="w-3 h-3" /> Ø³ÙŠØªÙ… Ø§Ø³ØªØ¨Ø¯Ø§Ù„ Ø¨ØµÙ…Ø© Ù‚Ø¯ÙŠÙ…Ø©
                      </span>
                    )}
                    {req.selfMismatch && (
                      <span className="text-xs bg-red-500/15 border border-red-500/40 text-red-300 rounded-full px-2 py-1 flex items-center gap-1">
                        <TriangleAlert className="w-3 h-3" /> Ø§Ù„ÙˆØ¬Ù‡ Ù„Ø§ ÙŠØ·Ø§Ø¨Ù‚ Ø¨ØµÙ…ØªÙ‡ Ø§Ù„Ù…Ø³Ø¬Ù‘Ù„Ø©
                      </span>
                    )}
                    {req.checksFailed && (
                      <span className="text-xs bg-amber-500/15 border border-amber-500/30 text-amber-300 rounded-full px-2 py-1 flex items-center gap-1">
                        <TriangleAlert className="w-3 h-3" /> ÙØ­Øµ Ø§Ù„ØªÙƒØ±Ø§Ø± Ù„Ù… ÙŠÙƒØªÙ…Ù„
                      </span>
                    )}
                    {siblingCount > 1 && (
                      <span className="text-xs bg-sky-500/15 border border-sky-500/30 text-sky-300 rounded-full px-2 py-1 flex items-center gap-1">
                        <TriangleAlert className="w-3 h-3" /> {siblingCount} Ø·Ù„Ø¨Ø§Øª Ù„Ù†ÙØ³ Ø§Ù„Ø·Ø§Ù„Ø¨
                      </span>
                    )}
                  </div>

                  {req.selfMismatch && (
                    <div className="mb-3 p-2 bg-red-500/10 border border-red-500/30 rounded text-xs text-red-300">
                      <strong>ØªÙ†Ø¨ÙŠÙ‡:</strong> Ø§Ù„ÙˆØ¬Ù‡ Ø§Ù„Ø¬Ø¯ÙŠØ¯ Ù„Ø§ ÙŠØ´Ø¨Ù‡ Ø¨ØµÙ…Ø© Ø§Ù„Ø·Ø§Ù„Ø¨ Ø§Ù„Ù…Ø³Ø¬Ù‘Ù„Ø© Ø³Ø§Ø¨Ù‚Ø§Ù‹ â€” Ù‚Ø¯ ÙŠÙƒÙˆÙ† Ø§Ù„Ø·Ù„Ø¨ Ù…Ù† Ø·Ø§Ù„Ø¨ Ø¢Ø®Ø±ØŒ Ø£Ùˆ ØªÙ… Ø§Ø³ØªØ¨Ø¯Ø§Ù„ Ø§Ù„Ø±Ù‚Ù…. Ø±Ø§Ø¬Ø¹ Ø§Ù„Ø·Ù„Ø¨ Ù‚Ø¨Ù„ Ø§Ù„Ù…ÙˆØ§ÙÙ‚Ø©.
                    </div>
                  )}
                  {req.checksFailed && (
                    <div className="mb-3 p-2 bg-amber-500/10 border border-amber-500/30 rounded text-xs text-amber-300">
                      <strong>ØªÙ†Ø¨ÙŠÙ‡:</strong> Ù„Ù… ÙŠÙƒØªÙ…Ù„ ÙØ­Øµ ØªÙƒØ±Ø§Ø± Ø§Ù„Ø¨ØµÙ…Ø© Ù‚Ø¨Ù„ Ø§Ù„Ø¥Ø±Ø³Ø§Ù„ (ØªØ¹Ø°Ù‘Ø±Øª Ù‚Ø±Ø§Ø¡Ø© Ø·Ù„Ø§Ø¨ Ø§Ù„Ù…Ø±Ø­Ù„Ø©).
                    </div>
                  )}

                  {isRejected && req.rejectionReason && (
                    <div className="mb-3 p-2 bg-red-500/10 border border-red-500/30 rounded text-xs text-red-300">
                      <strong>Ø³Ø¨Ø¨ Ø§Ù„Ø±ÙØ¶:</strong> {req.rejectionReason}
                    </div>
                  )}

                  {isRejecting && (
                    <div className="mb-3 p-3 bg-slate-800 border-2 border-red-500/40 rounded-lg">
                      <textarea
                        value={rejectReason}
                        onChange={e => setRejectReason(e.target.value)}
                        placeholder="Ø³Ø¨Ø¨ Ø§Ù„Ø±ÙØ¶ (Ø§Ø®ØªÙŠØ§Ø±ÙŠ)..."
                        rows={2}
                        className="glass-input text-sm"
                      />
                      <div className="flex flex-wrap gap-2 mt-2">
                        <button
                          onClick={() => {
                            setRejectingId(null);
                            setRejectReason('');
                          }}
                          className="flex-1 min-w-[7rem] btn-base btn-secondary text-xs"
                        >
                          Ø¥Ù„ØºØ§Ø¡
                        </button>
                        <button
                          onClick={() => handleReject(req, rejectReason)}
                          disabled={isProcessing}
                          className="flex-1 min-w-[7rem] btn-base btn-danger text-xs"
                        >
                          {isProcessing ? <MorphingSquare size="xs" /> : <><Check className="w-3.5 h-3.5" /> ØªØ£ÙƒÙŠØ¯ Ø§Ù„Ø±ÙØ¶</>}
                        </button>
                      </div>
                    </div>
                  )}

                  {!isRejecting && (
                    <div className="flex gap-2">
                      {isPending && (
                        <>
                          <button
                            onClick={() => handleApprove(req)}
                            disabled={isProcessing}
                            className="flex-1 btn-base btn-primary text-sm"
                          >
                            {isProcessing ? <><MorphingSquare size="sm" /> Ø¬Ø§Ø±ÙŠ...</> : <><CircleCheck className="w-4 h-4" /> Ù…ÙˆØ§ÙÙ‚Ø©</>}
                          </button>
                          <button
                            onClick={() => {
                              setRejectingId(req.id);
                              setRejectReason('');
                            }}
                            disabled={isProcessing}
                            className="flex-1 btn-base btn-danger text-sm"
                          >
                            <CircleX className="w-4 h-4" /> Ø±ÙØ¶
                          </button>
                        </>
                      )}

                      {(isApproved || isRejected) && (
                        <button
                          onClick={() => handleDelete(req)}
                          className="flex-1 btn-base btn-secondary text-sm"
                        >
                          <Trash2 className="w-4 h-4" /> Ø­Ø°Ù Ù…Ù† Ø§Ù„Ø³Ø¬Ù„
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

export default PendingRegistrations;
