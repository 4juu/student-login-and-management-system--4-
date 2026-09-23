import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SessionManager } from '../SessionManager';
import type { AttendanceSession, Student, AttendanceRecord } from '../../types/student';

vi.mock('../../firebase/dataService', () => ({
  getCurrentAcademicYear: () => '2025_2026',
}));

const students: Student[] = [
  { id: 's1', name: 'أحمد علي', code: '1111', group: 'أ', createdAt: '' },
  { id: 's2', name: 'سارة محمد', code: '2222', group: 'ب', createdAt: '' },
];

const sessions: AttendanceSession[] = [
  { id: 'ses1', name: 'محاضرة أولى', date: '2026-09-20', createdAt: '2026-09-20T00:00:00.000Z', isActive: true },
  { id: 'ses2', name: 'محاضرة ثانية', date: '2026-09-21', createdAt: '2026-09-21T00:00:00.000Z', isActive: false },
];

const records: AttendanceRecord[] = [
  { id: 'r1', studentId: 's1', studentName: 'أحمد علي', studentCode: '1111', sessionId: 'ses1', status: 'present', time: '09:00', timestamp: '2026-09-20T09:00:00.000Z', date: '2026-09-20' },
  { id: 'r2', studentId: 's2', studentName: 'سارة محمد', studentCode: '2222', sessionId: 'ses1', status: 'absent', time: '09:00', timestamp: '2026-09-20T09:00:00.000Z', date: '2026-09-20' },
];

const setup = (overrides: Partial<React.ComponentProps<typeof SessionManager>> = {}) => {
  const onCreateSession = vi.fn();
  const onSelectSession = vi.fn();
  const onDeleteSession = vi.fn();
  const onRenameSession = vi.fn();
  render(
    <SessionManager
      sessions={sessions}
      activeSessionId="ses1"
      onCreateSession={onCreateSession}
      onSelectSession={onSelectSession}
      onDeleteSession={onDeleteSession}
      onRenameSession={onRenameSession}
      students={students}
      records={records}
      {...overrides}
    />,
  );
  return { onCreateSession, onSelectSession, onDeleteSession, onRenameSession };
};

describe('SessionManager', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders existing sessions', () => {
    setup();
    expect(screen.getByText('محاضرة أولى')).toBeInTheDocument();
    expect(screen.getByText('محاضرة ثانية')).toBeInTheDocument();
  });

  it('shows empty state when no sessions', () => {
    setup({ sessions: [], activeSessionId: null });
    expect(screen.getByText('لا توجد سجلات حضور')).toBeInTheDocument();
  });

  it('creates a new session via custom form', async () => {
    const { onCreateSession } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'سجل مخصص' }));
    const input = screen.getByPlaceholderText(/أدخل اسم السجل/);
    await userEvent.type(input, 'محاضرة جديدة');
    await userEvent.click(screen.getByRole('button', { name: 'إنشاء' }));
    expect(onCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'محاضرة جديدة' }),
    );
  });

  it('activates a session after confirmation', async () => {
    const { onSelectSession } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'تفعيل' }));
    const confirm = await screen.findByRole('button', { name: 'نعم، تفعيل' });
    await userEvent.click(confirm);
    expect(onSelectSession).toHaveBeenCalledWith('ses2');
  });

  it('opens delete confirm and deletes session', async () => {
    const { onDeleteSession } = setup();
    const deleteButtons = screen.getAllByRole('button', { name: 'حذف' });
    await userEvent.click(deleteButtons[0]!);
    const alert = await screen.findByRole('alertdialog');
    const confirm = within(alert).getByRole('button', { name: 'موافق' });
    await userEvent.click(confirm);
    expect(onDeleteSession).toHaveBeenCalledWith('ses1');
  });
});
