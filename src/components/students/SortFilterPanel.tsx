import React, { useMemo } from 'react';
import { Student } from '../../types/student';
import type { useConfirm } from '../../hooks/useConfirm';
import { CaseSensitive, ChartColumn, RefreshCw, Users } from 'lucide-react';

type ConfirmFn = ReturnType<typeof useConfirm>['confirm'];

interface SortFilterPanelProps {
  students: Student[];
  studentsCount: number;
  searchQuery: string;
  groupFilter: string;
  uniqueGroups: string[];
  filteredCount: number;
  onSearchChange: (value: string) => void;
  onGroupFilterChange: (value: string) => void;
  onSortByName?: (() => void) | undefined;
  onSortByGroup?: (() => void) | undefined;
  confirm: ConfirmFn;
}

export const SortFilterPanel: React.FC<SortFilterPanelProps> = ({
  students,
  studentsCount,
  searchQuery,
  groupFilter,
  uniqueGroups,
  filteredCount,
  onSearchChange,
  onGroupFilterChange,
  onSortByName,
  onSortByGroup,
  confirm,
}) => {
  // عدّ المجموعات مرة واحدة بدل students.filter داخل كل خيار
  const groupCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of students) {
      if (s.group) counts.set(s.group, (counts.get(s.group) || 0) + 1);
    }
    return counts;
  }, [students]);

  return (
    <>
      {studentsCount > 1 && (onSortByName || onSortByGroup) && (
        <div className="p-4 sm:p-6 bg-gradient-to-r from-purple-500/10 to-pink-500/10 border-2 border-purple-500/30 rounded-lg">
          <h3 className="text-base sm:text-lg font-semibold text-purple-200 mb-3 flex items-center gap-2">
            <RefreshCw className="w-4 h-4 text-purple-400" /> إعادة ترتيب الطلاب
          </h3>
          <div className="flex flex-wrap gap-2">
            {onSortByName && (
              <button
                onClick={async () => {
                  const ok = await confirm({
                    title: 'إعادة ترتيب',
                    message: 'هل تريد ترتيب الطلاب أبجدياً حسب الأسماء؟',
                    confirmLabel: 'ترتيب',
                  });
                  if (ok) onSortByName();
                }}
                className="btn-base btn-secondary flex-1 min-w-40 sm:min-w-52"
              >
                <CaseSensitive className="w-4 h-4" /> ترتيب أبجدي حسب الاسم
              </button>
            )}
            {onSortByGroup && (
              <button
                onClick={async () => {
                  const ok = await confirm({
                    title: 'إعادة ترتيب',
                    message: 'هل تريد ترتيب الطلاب حسب الكروب ثم الاسم؟',
                    confirmLabel: 'ترتيب',
                  });
                  if (ok) onSortByGroup();
                }}
                className="btn-base btn-secondary flex-1 min-w-40 sm:min-w-52"
              >
                <Users className="w-4 h-4" /> ترتيب حسب الكروب + الاسم
              </button>
            )}
          </div>
        </div>
      )}

      {studentsCount > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6 items-center">
          <div className="sm:col-span-2 relative">
            <input
              type="text"
              value={searchQuery}
              onChange={e => onSearchChange(e.target.value)}
              placeholder="بحث بالاسم أو الكود أو الكروب أو الرقم الجامعي..."
              className="w-full min-h-10 px-4 py-3 pe-11 border border-slate-600 bg-slate-800 text-white placeholder:text-slate-400 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              dir="rtl"
            />
            {searchQuery && (
              <button
                onClick={() => onSearchChange('')}
                className="absolute end-1 top-1/2 -translate-y-1/2 min-h-10 min-w-10 flex items-center justify-center text-slate-500 hover:text-slate-300 text-xl transition-colors duration-200"
              >
                ×
              </button>
            )}
          </div>

          {uniqueGroups.length > 0 && (
            <select
              value={groupFilter}
              onChange={e => onGroupFilterChange(e.target.value)}
              className="glass-input min-h-10 text-sm"
            >
              <option value="all">جميع الكروبات</option>
              {uniqueGroups.map(g => (
                <option key={g} value={g}>
                  {g} ({groupCounts.get(g) || 0})
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {(searchQuery || groupFilter !== 'all') && (
        <p className="text-xs text-slate-400 flex items-center gap-1">
          <ChartColumn className="w-3.5 h-3.5 text-slate-500" /> نتائج: <strong>{filteredCount}</strong> من {studentsCount}
        </p>
      )}
    </>
  );
};
