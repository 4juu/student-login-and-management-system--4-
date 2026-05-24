export type FaceMatchLogStatus =
  | 'accepted'
  | 'already'
  | 'uncertain'
  | 'rejected'
  | 'unknown'
  | 'error';

export interface FaceMatchLog {
  id: string;
  time: string;
  mode: 'qr' | 'bulk' | 'register';
  status: FaceMatchLogStatus;
  studentId?: string;
  studentName?: string;
  studentCode?: string;
  group?: string;
  distance?: number;
  secondDistance?: number;
  gap?: number;
  threshold?: number;
  confidence?: number;
  reason?: string;
}

const LOG_KEY = 'face_match_logs_v1';
const MAX_LOGS = 300;

export const getFaceMatchLogs = (): FaceMatchLog[] => {
  try {
    const raw = localStorage.getItem(LOG_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const addFaceMatchLog = (log: Omit<FaceMatchLog, 'id' | 'time'>) => {
  try {
    const item: FaceMatchLog = {
      ...log,
      id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
      time: new Date().toISOString(),
    };

    const next = [item, ...getFaceMatchLogs()].slice(0, MAX_LOGS);
    localStorage.setItem(LOG_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
};

export const clearFaceMatchLogs = () => {
  try {
    localStorage.removeItem(LOG_KEY);
  } catch {
    // ignore
  }
};

export const exportFaceMatchLogsCsv = () => {
  const logs = getFaceMatchLogs();

  const headers = [
    'time',
    'mode',
    'status',
    'studentName',
    'studentCode',
    'group',
    'distance',
    'secondDistance',
    'gap',
    'threshold',
    'confidence',
    'reason',
  ];

  const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;

  const csv = [
    headers.join(','),
    ...logs.map(l => headers.map(h => esc((l as any)[h])).join(',')),
  ].join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `face_match_logs_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
};
