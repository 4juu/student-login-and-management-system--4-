import { useState, useCallback, type ReactNode } from 'react';
import { ConfirmDialog } from '../components/ConfirmDialog';

interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  icon?: ReactNode;
}

interface ConfirmState extends ConfirmOptions {
  open: boolean;
  resolve: ((value: boolean) => void) | null;
}

export function useConfirm() {
  const [state, setState] = useState<ConfirmState>({
    open: false,
    resolve: null,
    title: '',
  });

  const confirm = useCallback(
    (options: ConfirmOptions): Promise<boolean> =>
      new Promise((resolve) => {
        setState({ ...options, open: true, resolve });
      }),
    []
  );

  const handleConfirm = useCallback(() => {
    state.resolve?.(true);
    setState((s) => ({ ...s, open: false, resolve: null }));
  }, [state.resolve]);

  const handleCancel = useCallback(() => {
    state.resolve?.(false);
    setState((s) => ({ ...s, open: false, resolve: null }));
  }, [state.resolve]);

  const ConfirmDialogEl = (
    <ConfirmDialog
      open={state.open}
      title={state.title}
      message={state.message}
      confirmLabel={state.confirmLabel}
      cancelLabel={state.cancelLabel}
      icon={state.icon}
      onConfirm={handleConfirm}
      onCancel={handleCancel}
    />
  );

  return { confirm, ConfirmDialog: ConfirmDialogEl };
}
