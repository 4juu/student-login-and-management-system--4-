import type { FC } from 'react';
import { LoadingState } from '../components/loading/LoadingState';

export const TabFallback: FC = () => <LoadingState size="md" className="py-24" />;

export const ModalFallback: FC = () => (
  <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
    <LoadingState size="md" className="relative" />
  </div>
);

export const StageLoading: FC = () => <LoadingState size="md" className="py-24" />;
