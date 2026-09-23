import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmDialog } from '../ConfirmDialog';

const defaultProps = {
  open: true,
  title: 'تسجيل الخروج',
  message: 'هل أنت متأكد أنك تريد تسجيل الخروج؟',
  onConfirm: vi.fn(),
  onCancel: vi.fn(),
};

describe('ConfirmDialog', () => {
  it('renders nothing when closed', () => {
    render(<ConfirmDialog {...defaultProps} open={false} />);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.queryByText('تسجيل الخروج')).not.toBeInTheDocument();
  });

  it('renders title and message when open', () => {
    render(<ConfirmDialog {...defaultProps} />);
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByText('تسجيل الخروج')).toBeInTheDocument();
    expect(screen.getByText('هل أنت متأكد أنك تريد تسجيل الخروج؟')).toBeInTheDocument();
  });

  it('has accessible alertdialog role with aria-modal', () => {
    render(<ConfirmDialog {...defaultProps} />);
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('dir', 'rtl');
  });

  it('shows default confirm/cancel labels', () => {
    render(<ConfirmDialog {...defaultProps} />);
    expect(screen.getByText('تأكيد')).toBeInTheDocument();
    expect(screen.getByText('إلغاء')).toBeInTheDocument();
  });

  it('shows custom confirm/cancel labels', () => {
    render(
      <ConfirmDialog {...defaultProps} confirmLabel="حذف" cancelLabel="تراجع" />,
    );
    expect(screen.getByText('حذف')).toBeInTheDocument();
    expect(screen.getByText('تراجع')).toBeInTheDocument();
  });

  it('calls onConfirm when confirm button clicked', async () => {
    const onConfirm = vi.fn();
    render(<ConfirmDialog {...defaultProps} onConfirm={onConfirm} />);
    await userEvent.click(screen.getByText('تأكيد'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel when cancel button clicked', async () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog {...defaultProps} onCancel={onCancel} />);
    await userEvent.click(screen.getByText('إلغاء'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel when close (X) button clicked', async () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog {...defaultProps} onCancel={onCancel} />);
    await userEvent.click(screen.getByLabelText('إغلاق'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel when Escape pressed', () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog {...defaultProps} onCancel={onCancel} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel when backdrop clicked', async () => {
    const onCancel = vi.fn();
    const { container } = render(<ConfirmDialog {...defaultProps} onCancel={onCancel} />);
    // backdrop is first child of portal root inside fixed container
    const dialog = screen.getByRole('alertdialog');
    const backdrop = dialog.previousElementSibling as HTMLElement;
    expect(backdrop).toBeTruthy();
    fireEvent.click(backdrop);
    expect(onCancel).toHaveBeenCalledTimes(1);
    void container;
  });

  it('does not call onConfirm when only cancel is used', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<ConfirmDialog {...defaultProps} onConfirm={onConfirm} onCancel={onCancel} />);
    await userEvent.click(screen.getByText('إلغاء'));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalled();
  });

  it('hides body scroll while open and restores on close', () => {
    const { rerender } = render(<ConfirmDialog {...defaultProps} />);
    expect(document.body.style.overflow).toBe('hidden');
    rerender(<ConfirmDialog {...defaultProps} open={false} />);
    expect(document.body.style.overflow).not.toBe('hidden');
  });

  it('renders custom icon when provided', () => {
    render(<ConfirmDialog {...defaultProps} icon={<span data-testid="custom-icon">⚠️</span>} />);
    expect(screen.getByTestId('custom-icon')).toBeInTheDocument();
  });

  it('uses default LogOut icon when no custom icon', () => {
    const { container } = render(<ConfirmDialog {...defaultProps} />);
    // lucide renders an svg inside the header
    const dialog = screen.getByRole('alertdialog');
    expect(dialog.querySelector('svg')).toBeInTheDocument();
    void container;
  });
});
