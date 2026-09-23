import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AttendanceRecords } from '../AttendanceRecords';
import type { AttendanceRecord, AttendanceSession, Student } from '../../types/student';

vi.mock('../../firebase/dataService', () => ({
  getCurrentAcademicYear: () => '2025_2026',
}));

const students: Student[] = [
  { id: 's1', name: 'أحمد علي', code: '1111', group: 'أ', createdAt: '' },
  { id: 's2', name: 'سارة محمد', code: '2222', group: 'ب', createdAt: '' },
];

const sessions: AttendanceSession[] = [
  { id: 'ses1', name: 'محاضرة أولى', date: '2026-09-20', createdAt: '2026-09-20T00:00:00.000Z', isActive: true },
];

const records: AttendanceRecord[] = [
  {
    id: 'r1',
    studentId: 's1',
    studentName: 'أحمد علي',
    studentCode: '1111',
    sessionId: 'ses1',
    status: 'present',
    time: '09:00',
    timestamp: '2026-09-20T09:00:00.000Z',
    date: '2026-09-20',
  },
  {
    id: 'r2',
    studentId: 's2',
    studentName: 'سارة محمد',
    studentCode: '2222',
    sessionId: 'ses1',
    status: 'absent',
    time: '09:00',
    timestamp: '2026-09-20T09:00:00.000Z',
    date: '2026-09-20',
  },
];

const setup = (overrides: Partial<React.ComponentProps<typeof AttendanceRecords>> = {}) => {
  const onClearRecords = vi.fn();
  const onDeleteRecord = vi.fn();
  const onUpdateRecord = vi.fn();
  render(
    <AttendanceRecords
      records={records}
      sessions={sessions}
      students={students}
      activeSessionId="ses1"
      onClearRecords={onClearRecords}
      onDeleteRecord={onDeleteRecord}
      onUpdateRecord={onUpdateRecord}
      teacherBio="د. اختبار"
      {...overrides}
    />,
  );
  return { onClearRecords, onDeleteRecord, onUpdateRecord };
};

describe('AttendanceRecords', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders records list with student names', () => {
    setup();
    expect(screen.getAllByText('أحمد علي').length).toBeGreaterThan(0);
    expect(screen.getAllByText('سارة محمد').length).toBeGreaterThan(0);
  });

  it('shows empty state when no records', () => {
    setup({ records: [] });
    expect(screen.getAllByText('لا توجد سجلات لعرضها').length).toBeGreaterThan(0);
  });

  it('opens export dialog', async () => {
    setup();
    const exportBtn = screen.getByRole('button', { name: /تحميل سجل الحضور والغياب/ });
    await userEvent.click(exportBtn);
    expect(await screen.findByText('تصدير سجل الحضور والغياب')).toBeInTheDocument();
  });

  it('renders table headers for session/time/status', () => {
    setup();
    expect(screen.getByText('الجلسة')).toBeInTheDocument();
    expect(screen.getByText('الوقت')).toBeInTheDocument();
    expect(screen.getByText('الحالة')).toBeInTheDocument();
  });
});
