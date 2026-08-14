import React from 'react';
import { GraduationCap, CalendarDays } from 'lucide-react';
import { TextScramble } from './TextScramble';

interface MastheadProps {
  title: string;
  yearLabel: string;
}

export const Masthead: React.FC<MastheadProps> = ({ title, yearLabel }) => {
  return (
    <header className="relative pb-5 border-b border-white/10">
      <div className="absolute inset-x-0 -top-3 h-[3px] bg-gradient-to-l from-transparent via-blue-600 to-transparent" />
      <div className="flex flex-col items-center text-center gap-3">
        <div className="w-16 h-16 rounded-full border-2 border-blue-600/40 bg-gradient-to-br from-blue-950 to-[#0F1A30] flex items-center justify-center shadow-lg shadow-blue-950/40">
          <GraduationCap className="w-8 h-8 text-blue-400" />
        </div>
        <h1 className="text-xl sm:text-3xl font-bold text-white tracking-tight leading-snug">
          {title}
        </h1>
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/25 text-blue-300 text-xs sm:text-sm font-medium">
          <CalendarDays className="w-4 h-4" />
          السنة الأكاديمية: {yearLabel}
        </div>
        <div className="mt-1">
          <TextScramble text="BY - PH. Mujtaba Haitham" />
        </div>
      </div>
    </header>
  );
};
