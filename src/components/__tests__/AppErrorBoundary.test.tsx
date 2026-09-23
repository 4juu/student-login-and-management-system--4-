import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AppErrorBoundary } from '../AppErrorBoundary';

// Error boundaries rely on React error logging — silence it in tests.
const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

function Bomb(): never {
  throw new Error('boom-test-error');
}

describe('AppErrorBoundary', () => {
  beforeEach(() => {
    consoleError.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders children when there is no error', () => {
    render(
      <AppErrorBoundary>
        <div>محتوى يعمل</div>
      </AppErrorBoundary>,
    );
    expect(screen.getByText('محتوى يعمل')).toBeInTheDocument();
  });

  it('shows Arabic fallback UI when a child throws', () => {
    render(
      <AppErrorBoundary>
        <Bomb />
      </AppErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('حدث خطأ غير متوقع')).toBeInTheDocument();
    expect(
      screen.getByText('عذراً، واجهنا مشكلة أثناء تشغيل الصفحة. يمكنك إعادة المحاولة أو تحديث الصفحة.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'إعادة المحاولة' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'تحديث الصفحة' })).toBeInTheDocument();
  });

  it('shows technical details for the developer', () => {
    render(
      <AppErrorBoundary>
        <Bomb />
      </AppErrorBoundary>,
    );
    const summary = screen.getByText('تفاصيل تقنية (للمطوّر)');
    fireEvent.click(summary);
    expect(screen.getByText('boom-test-error')).toBeInTheDocument();
  });

  it('retry button clears the error and re-renders children', () => {
    let shouldThrow = true;
    function Conditional(): React.ReactNode {
      if (shouldThrow) throw new Error('flaky');
      return <div>تعافى الاختبار</div>;
    }

    render(
      <AppErrorBoundary>
        <Conditional />
      </AppErrorBoundary>,
    );
    expect(screen.getByText('حدث خطأ غير متوقع')).toBeInTheDocument();

    shouldThrow = false;
    fireEvent.click(screen.getByRole('button', { name: 'إعادة المحاولة' }));

    expect(screen.getByText('تعافى الاختبار')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('is RTL and accessible (role=alert)', () => {
    render(
      <AppErrorBoundary>
        <Bomb />
      </AppErrorBoundary>,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveAttribute('dir', 'rtl');
  });
});
