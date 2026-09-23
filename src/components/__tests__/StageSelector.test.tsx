import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StageSelector } from '../StageSelector';
import type { College, Stage } from '../../types/student';
import type { User } from '../../types/user';

const colleges: College[] = [
  { id: 'c1', name: 'كلية الهندسة', createdAt: '', createdBy: 'admin', color: 'blue' },
  { id: 'c2', name: 'كلية الطب', createdAt: '', createdBy: 'admin', color: 'red' },
];

const stages: Stage[] = [
  { id: 's1', name: 'المرحلة الأولى', collegeId: 'c1', createdAt: '', order: 1 },
  { id: 's2', name: 'المرحلة الثانية', collegeId: 'c1', createdAt: '', order: 2 },
  { id: 's3', name: 'المرحلة الثالثة', collegeId: 'c2', createdAt: '', order: 1 },
];

const adminUser: User = {
  uid: 'u1',
  email: 'admin@test.com',
  displayName: 'أدمن',
  role: 'admin',
  createdAt: '',
};

const teacherUser: User = {
  uid: 'u2',
  email: 'teacher@test.com',
  displayName: 'مدرّس',
  role: 'teacher',
  createdAt: '',
  permissions: {
    allowedStages: { c1: ['s1'] },
    canViewRecords: true,
    canTakeAttendance: true,
  },
};

describe('StageSelector', () => {
  it('renders heading for admin', () => {
    render(
      <StageSelector user={adminUser} colleges={colleges} stages={stages} onSelect={vi.fn()} />,
    );
    expect(screen.getByText('إلى أين نتوجه اليوم؟')).toBeInTheDocument();
    expect(screen.getByText('كلية الهندسة')).toBeInTheDocument();
    expect(screen.getByText('كلية الطب')).toBeInTheDocument();
  });

  it('shows stages for each college for admin', () => {
    render(
      <StageSelector user={adminUser} colleges={colleges} stages={stages} onSelect={vi.fn()} />,
    );
    expect(screen.getByText('المرحلة الأولى')).toBeInTheDocument();
    expect(screen.getByText('المرحلة الثانية')).toBeInTheDocument();
    expect(screen.getByText('المرحلة الثالثة')).toBeInTheDocument();
  });

  it('calls onSelect with collegeId and stageId', async () => {
    const onSelect = vi.fn();
    render(
      <StageSelector user={adminUser} colleges={colleges} stages={stages} onSelect={onSelect} />,
    );
    await userEvent.click(screen.getByText('المرحلة الأولى'));
    expect(onSelect).toHaveBeenCalledWith('c1', 's1');
  });

  it('filters colleges for teacher by allowedStages permissions', () => {
    render(
      <StageSelector user={teacherUser} colleges={colleges} stages={stages} onSelect={vi.fn()} />,
    );
    expect(screen.getByText('كلية الهندسة')).toBeInTheDocument();
    expect(screen.queryByText('كلية الطب')).not.toBeInTheDocument();
  });

  it('filters stages for teacher to only allowed ones', () => {
    render(
      <StageSelector user={teacherUser} colleges={colleges} stages={stages} onSelect={vi.fn()} />,
    );
    expect(screen.getByText('المرحلة الأولى')).toBeInTheDocument();
    expect(screen.queryByText('المرحلة الثانية')).not.toBeInTheDocument();
  });

  it('shows disabled-account screen for inactive teacher', () => {
    const inactive: User = { ...teacherUser, active: false };
    render(
      <StageSelector user={inactive} colleges={colleges} stages={stages} onSelect={vi.fn()} />,
    );
    expect(screen.getByText('حسابك معطّل حالياً')).toBeInTheDocument();
    expect(screen.queryByText('إلى أين نتوجه اليوم؟')).not.toBeInTheDocument();
  });

  it('shows no-permissions screen when teacher has no allowed colleges', () => {
    const noAccess: User = {
      ...teacherUser,
      permissions: { allowedStages: {}, canViewRecords: false, canTakeAttendance: false },
    };
    render(
      <StageSelector user={noAccess} colleges={colleges} stages={stages} onSelect={vi.fn()} />,
    );
    expect(screen.getByText('لا توجد صلاحيات وصول')).toBeInTheDocument();
  });

  it('shows no-permissions screen when colleges list is empty', () => {
    render(
      <StageSelector user={adminUser} colleges={[]} stages={[]} onSelect={vi.fn()} />,
    );
    expect(screen.getByText('لا توجد صلاحيات وصول')).toBeInTheDocument();
  });

  it('restricts college_admin to their own college', () => {
    const collegeAdmin: User = {
      uid: 'u3',
      email: 'ca@test.com',
      displayName: 'أدمن كلية',
      role: 'college_admin',
      createdAt: '',
      collegeId: 'c1',
    };
    render(
      <StageSelector user={collegeAdmin} colleges={colleges} stages={stages} onSelect={vi.fn()} />,
    );
    expect(screen.getByText('كلية الهندسة')).toBeInTheDocument();
    expect(screen.queryByText('كلية الطب')).not.toBeInTheDocument();
  });

  it('does not call onSelect when stage not clicked', async () => {
    const onSelect = vi.fn();
    render(
      <StageSelector user={adminUser} colleges={colleges} stages={stages} onSelect={onSelect} />,
    );
    fireEvent.click(screen.getByText('إلى أين نتوجه اليوم؟'));
    expect(onSelect).not.toHaveBeenCalled();
  });
});
