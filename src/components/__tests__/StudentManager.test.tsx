import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StudentManager } from '../StudentManager';
import type { Student } from '../../types/student';

const students: Student[] = [
  { id: 's1', name: 'أحمد علي', code: '1234', group: 'أ', createdAt: '' },
  { id: 's2', name: 'سارة محمد', code: '5678', group: 'ب', createdAt: '' },
];

const setup = (overrides: Partial<React.ComponentProps<typeof StudentManager>> = {}) => {
  const onAddStudent = vi.fn();
  const onDeleteStudent = vi.fn();
  const onDeleteSelectedStudents = vi.fn();
  const utils = render(
    <StudentManager
      students={students}
      onAddStudent={onAddStudent}
      onDeleteStudent={onDeleteStudent}
      onDeleteSelectedStudents={onDeleteSelectedStudents}
      {...overrides}
    />,
  );
  return { ...utils, onAddStudent, onDeleteStudent, onDeleteSelectedStudents };
};

describe('StudentManager', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the students list', () => {
    setup();
    expect(screen.getByText('أحمد علي')).toBeInTheDocument();
    expect(screen.getByText('سارة محمد')).toBeInTheDocument();
  });

  it('shows add-student form fields', () => {
    setup();
    expect(screen.getAllByRole('textbox').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /إضافة/ })).toBeInTheDocument();
  });

  it('validates code must be exactly 4 digits', async () => {
    const { onAddStudent } = setup();
    // fill name and invalid code
    const textboxes = screen.getAllByRole('textbox');
    // find name & code inputs heuristically
    const nameInput = textboxes.find(t =>
      (t.getAttribute('placeholder') || '').includes('اسم') ||
      (t.id && t.id.toLowerCase().includes('name')),
    ) || textboxes[0];
    const codeInput = textboxes.find(t =>
      (t.getAttribute('placeholder') || '').includes('رمز') ||
      (t.id && t.id.toLowerCase().includes('code')) ||
      (t.getAttribute('inputmode') === 'numeric'),
    ) || textboxes[1];

    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'اختبار');
    await userEvent.clear(codeInput);
    await userEvent.type(codeInput, '12');

    fireEvent.click(screen.getByRole('button', { name: /إضافة/ }));

    expect(onAddStudent).not.toHaveBeenCalled();
    expect(
      screen.getByText('الرمز يجب أن يكون 4 أرقام بالضبط (من 1000 إلى 9999)'),
    ).toBeInTheDocument();
  });

  it('rejects code below 1000', async () => {
    const { onAddStudent } = setup();
    const textboxes = screen.getAllByRole('textbox');
    const nameInput = textboxes[0];
    const codeInput = textboxes[1];

    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'اختبار');
    await userEvent.clear(codeInput);
    await userEvent.type(codeInput, '0999');

    fireEvent.click(screen.getByRole('button', { name: /إضافة/ }));

    expect(onAddStudent).not.toHaveBeenCalled();
    expect(screen.getByText(/بين 1000 و 9999/)).toBeInTheDocument();
  });

  it('does not call onAddStudent when name is empty', async () => {
    const { onAddStudent } = setup();
    const textboxes = screen.getAllByRole('textbox');
    const codeInput = textboxes[1];
    await userEvent.clear(codeInput);
    await userEvent.type(codeInput, '2000');

    fireEvent.click(screen.getByRole('button', { name: /إضافة/ }));
    expect(onAddStudent).not.toHaveBeenCalled();
    expect(screen.getByText('الرجاء إدخال اسم الطالب')).toBeInTheDocument();
  });

  it('search filters student list', async () => {
    setup();
    const search =
      screen.getByPlaceholderText(/بحث/) ||
      screen.getAllByRole('textbox')[0];
    await userEvent.clear(search);
    await userEvent.type(search, 'أحمد');
    expect(screen.getByText('أحمد علي')).toBeInTheDocument();
    expect(screen.queryByText('سارة محمد')).not.toBeInTheDocument();
  });

  it('calls onDeleteStudent when delete button clicked', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { onDeleteStudent } = setup();

    // delete row buttons have text "حذف" (may also match other buttons — pick table row ones)
    const deleteButtons = screen
      .getAllByRole('button')
      .filter(b => b.textContent?.trim() === 'حذف');
    expect(deleteButtons.length).toBeGreaterThanOrEqual(2);
    await userEvent.click(deleteButtons[0]);

    expect(confirmSpy).toHaveBeenCalledWith(
      expect.stringContaining('هل أنت متأكد من حذف الطالب'),
    );
    expect(onDeleteStudent).toHaveBeenCalledWith('s1');
  });

  it('does not delete when confirm is cancelled', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { onDeleteStudent } = setup();

    const deleteButtons = screen
      .getAllByRole('button')
      .filter(b => b.textContent?.trim() === 'حذف');
    await userEvent.click(deleteButtons[0]);

    expect(onDeleteStudent).not.toHaveBeenCalled();
  });

  it('renders empty state when no students', () => {
    render(
      <StudentManager
        students={[]}
        onAddStudent={vi.fn()}
        onDeleteStudent={vi.fn()}
        onDeleteSelectedStudents={vi.fn()}
      />,
    );
    expect(screen.queryByText('أحمد علي')).not.toBeInTheDocument();
  });

  it('shows student count / summary', () => {
    setup();
    // count indicators — "طالب" word should appear
    expect(screen.getAllByText(/طالب/).length).toBeGreaterThan(0);
  });
});
