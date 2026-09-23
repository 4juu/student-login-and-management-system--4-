import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AttendanceLogin } from '../AttendanceLogin';
import type { Student, AttendanceRecord } from '../../types/student';

const students: Student[] = [
  { id: 'st1', name: 'أحمد علي', code: '1234', group: 'أ', createdAt: '' },
  { id: 'st2', name: 'سارة محمد', code: '5678', group: 'ب', createdAt: '' },
];

const renderLogin = (overrides: Partial<React.ComponentProps<typeof AttendanceLogin>> = {}) => {
  const onAttendanceRecord = vi.fn();
  const utils = render(
    <AttendanceLogin
      students={students}
      activeSessionId="sess1"
      onAttendanceRecord={onAttendanceRecord}
      {...overrides}
    />,
  );
  return { ...utils, onAttendanceRecord };
};

async function enterCode(code: string) {
  for (const d of code) {
    await userEvent.click(screen.getByRole('button', { name: d }));
  }
  // checkAndSubmit fires after 150ms timeout
  await act(async () => {
    await new Promise(r => setTimeout(r, 200));
  });
}

describe('AttendanceLogin', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('renders title and instructions', () => {
    renderLogin();
    expect(screen.getByText('تسجيل الحضور')).toBeInTheDocument();
    expect(screen.getByText(/أدخل رمزك المكون من 4 أرقام/)).toBeInTheDocument();
  });

  it('renders 4 empty code slots initially', () => {
    renderLogin();
    expect(screen.getByText('0/4')).toBeInTheDocument();
    // 4 digit displays + 9 keypad numbers
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('9')).toBeInTheDocument();
  });

  it('updates counter when digits entered via keypad', async () => {
    renderLogin();
    await userEvent.click(screen.getByRole('button', { name: '1' }));
    expect(screen.getByText('1/4')).toBeInTheDocument();
  });

  it('accepts keyboard digit input', async () => {
    renderLogin();
    await act(async () => {
      fireEvent.keyDown(window, { key: '1' });
      fireEvent.keyDown(window, { key: '2' });
    });
    expect(screen.getByText('2/4')).toBeInTheDocument();
  });

  it('submits valid code and calls onAttendanceRecord with present record', async () => {
    const { onAttendanceRecord } = renderLogin();
    await enterCode('1234');
    expect(onAttendanceRecord).toHaveBeenCalledTimes(1);
    const record: AttendanceRecord = onAttendanceRecord.mock.calls[0]![0];
    expect(record.studentId).toBe('st1');
    expect(record.studentCode).toBe('1234');
    expect(record.status).toBe('present');
    expect(record.method).toBe('manual');
    expect(record.sessionId).toBe('sess1');
    expect(screen.getByText(/تم تسجيل حضورك بنجاح/)).toBeInTheDocument();
  });

  it('shows error for invalid code', async () => {
    renderLogin();
    await enterCode('9999');
    expect(screen.getByText(/الرمز غير صحيح/)).toBeInTheDocument();
  });

  it('shows error when no active session', async () => {
    const { onAttendanceRecord } = renderLogin({ activeSessionId: null });
    await enterCode('1234');
    expect(onAttendanceRecord).not.toHaveBeenCalled();
    expect(screen.getByText(/لا يوجد سجل نشط/)).toBeInTheDocument();
  });

  it('shows already-present error when student already marked present', async () => {
    const existing: AttendanceRecord = {
      id: 'r1',
      studentId: 'st1',
      studentName: 'أحمد علي',
      studentCode: '1234',
      timestamp: new Date().toISOString(),
      date: '',
      time: '',
      sessionId: 'sess1',
      status: 'present',
    };
    const { onAttendanceRecord } = renderLogin({ records: [existing] });
    await enterCode('1234');
    expect(onAttendanceRecord).not.toHaveBeenCalled();
    expect(screen.getByText(/مسجل حضور مسبقاً/)).toBeInTheDocument();
  });

  it('clear button resets code and message', async () => {
    renderLogin();
    await userEvent.click(screen.getByRole('button', { name: '1' }));
    expect(screen.getByText('1/4')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'مسح' }));
    expect(screen.getByText('0/4')).toBeInTheDocument();
  });

  it('backspace removes last digit', async () => {
    renderLogin();
    await userEvent.click(screen.getByRole('button', { name: '1' }));
    await userEvent.click(screen.getByRole('button', { name: '2' }));
    expect(screen.getByText('2/4')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '⌫' }));
    expect(screen.getByText('1/4')).toBeInTheDocument();
  });

  it('disables keypad buttons after 4 digits', async () => {
    renderLogin();
    // enter 4 digits via keypad quickly before auto-submit clears — use incomplete path
    // Actually auto-submit clears after 150ms; enter 4 and check before submit
    await userEvent.click(screen.getByRole('button', { name: '1' }));
    await userEvent.click(screen.getByRole('button', { name: '2' }));
    await userEvent.click(screen.getByRole('button', { name: '3' }));
    await userEvent.click(screen.getByRole('button', { name: '4' }));
    // at 4 digits, digit buttons are disabled until submit clears
    const fiveBtn = screen.getByRole('button', { name: '5' });
    expect(fiveBtn).toBeDisabled();
  });

  it('disables face and QR buttons when no active session', () => {
    renderLogin({ activeSessionId: null });
    const faceBtn = screen.getByRole('button', { name: /بصمة الوجه/ });
    const qrBtn = screen.getByRole('button', { name: /QR Code/ });
    expect(faceBtn).toBeDisabled();
    expect(qrBtn).toBeDisabled();
  });

  it('shows university-id hint when no students have universityId', () => {
    renderLogin();
    expect(screen.getByText(/لم يتم إضافة أرقام جامعية بعد/)).toBeInTheDocument();
  });

  it('does not show uni-id warning when all students have universityId', () => {
    const withUni = students.map(s => ({ ...s, universityId: 'U1' }));
    renderLogin({ students: withUni });
    expect(screen.queryByText(/لم يتم إضافة أرقام جامعية بعد/)).not.toBeInTheDocument();
  });

  it('message auto-clears after 3 seconds', async () => {
    renderLogin();
    await enterCode('9999');
    expect(screen.getByText(/الرمز غير صحيح/)).toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(3100);
    });
    expect(screen.queryByText(/الرمز غير صحيح/)).not.toBeInTheDocument();
  });

  it('Escape key clears code', async () => {
    renderLogin();
    await userEvent.click(screen.getByRole('button', { name: '7' }));
    expect(screen.getByText('1/4')).toBeInTheDocument();
    await act(async () => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    expect(screen.getByText('0/4')).toBeInTheDocument();
  });
});
