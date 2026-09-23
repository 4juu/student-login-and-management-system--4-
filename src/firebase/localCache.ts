// localStorage cache helpers for dataService domain modules

export const LS = {
  colleges: (uid: string) => `colleges_${uid}`,
  stages: (uid: string) => `stages_${uid}`,
  students: (uid: string, sid: string) => `students_${uid}_${sid}`,
  records: (uid: string, sid: string, tid: string) => `records_${uid}_${sid}_${tid}`,
  sessions: (uid: string, sid: string, tid: string) => `sessions_${uid}_${sid}_${tid}`,
  activeSession: (uid: string, sid: string, tid: string) => `activeSession_${uid}_${sid}_${tid}`,
};

export const saveLocal = (key: string, data: unknown): void => {
  try { localStorage.setItem(key, JSON.stringify(data)); } catch {}
};

export const loadLocal = <T,>(key: string, fallback: T): T => {
  try {
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : fallback;
  } catch { return fallback; }
};

export const isDangerousEmpty = (newData: unknown[]): boolean => {
  return Array.isArray(newData) && newData.length === 0;
};

export const stripUndefined = (obj: Record<string, unknown>): Record<string, unknown> => {
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== null) clean[k] = v;
  }
  return clean;
};
