import type { FC } from 'react';
import { Home, ChevronLeft } from 'lucide-react';
import { College, Stage } from '../types/student';

interface StageBreadcrumbProps {
  selectedCollege: College | undefined;
  selectedStage: Stage;
  stageSyncing: boolean;
  onBack: () => void;
}

export const StageBreadcrumb: FC<StageBreadcrumbProps> = ({
  selectedCollege,
  selectedStage,
  stageSyncing,
  onBack,
}) => (
  <div className="glass-card-sm p-3 flex items-center gap-2 text-sm flex-wrap mt-5">
    <button onClick={onBack} className="text-blue-400 hover:underline font-medium inline-flex items-center gap-1">
      <Home className="w-4 h-4" /> جميع المراحل
    </button>
    <ChevronLeft className="w-4 h-4 text-slate-500" />
    <span className="font-bold text-slate-200">{selectedCollege?.name}</span>
    <ChevronLeft className="w-4 h-4 text-slate-500" />
    <span className="font-bold text-blue-400">{selectedStage.name}</span>
    {stageSyncing && (
      <span className="inline-flex items-center gap-1.5 px-2 py-1 bg-blue-500/10 text-blue-300 text-xs font-medium rounded-full border border-blue-500/20">
        <span className="w-3 h-3 rounded-full border-2 border-blue-400 border-t-transparent animate-spin" />
        مزامنة خلفية…
      </span>
    )}
  </div>
);
