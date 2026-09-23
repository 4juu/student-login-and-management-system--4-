import type { FC } from 'react';
import { StageSkeleton } from '../components/loading/StageSkeleton';
import { CardSkeleton } from '../components/loading/CardSkeleton';

export const TabFallback: FC = () => <StageSkeleton />;

export const ModalFallback: FC = () => (
  <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
    <CardSkeleton className="relative" />
  </div>
);

export const StageLoading: FC = () => (
  <div className="max-w-6xl mx-auto py-8">
    <StageSkeleton aria-label="جاري تحميل بيانات المرحلة" />
    <p className="text-center text-sm text-slate-400 pt-4">جاري تحميل بيانات المرحلة…</p>
  </div>
);