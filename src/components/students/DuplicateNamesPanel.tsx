import React, { useMemo, useState, useEffect } from 'react';
import { CopyCheck, TriangleAlert, CircleCheck, Trash2, X, Search } from 'lucide-react';
import { findDuplicateNames, countDuplicateStudents } from '../../lib/duplicateNames';
import type { Student } from '../../types/student';

interface DuplicateNamesPanelProps {
  students: Student[];
  onDeleteSelected: (ids: string[]) => void;
  confirm: (options: { title: string; message?: string; confirmLabel?: string; cancelLabel?: string }) => Promise<boolean>;
}

const MATCH_SIZE = 3;

/** لوحة فحص الأسماء المكررة — تظهر داخل صفحة إدارة الطلاب (بدون نافذة منفصلة) */
export const DuplicateNamesPanel: React.FC<DuplicateNamesPanelProps> = ({ students, onDeleteSelected, confirm }) => {
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState('');
  const [checked, setChecked] = useState<Set<string>>(new Set());

  const clusters = useMemo(() => (expanded ? findDuplicateNames(students, MATCH_SIZE) : []), [expanded, students]);
  const dupCount = countDuplicateStudents(clusters);

  // مسح التحديد عند الإغلاق حتى لا تبقى selections قديمة
  useEffect(() => { if (!expanded) setChecked(new Set()); }, [expanded]);

  const visibleClusters = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return clusters;
    return clusters
      .map(c => ({
        ...c,
        students: c.students.filter(s =>
          s.name.toLowerCase().includes(q) || s.code.includes(q) || (s.group || '').toLowerCase().includes(q)
        ),
      }))
      .filter(c => c.students.length > 0);
  }, [clusters, query]);

  const toggle = (id: string) => {
    setChecked(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleDelete = async () => {
    if (checked.size === 0) return;
    const names = clusters
      .flatMap(c => c.students)
      .filter(s => checked.has(s.id))
      .map(s => s.name);
    const ok = await confirm({
      title: 'حذف الطلاب المحددين',
      message: `سيتم حذف ${checked.size} طالب نهائياً:\n${names.slice(0, 8).join('، ')}${names.length > 8 ? '…' : ''}`,
      confirmLabel: 'حذف',
      cancelLabel: 'إلغاء',
    });
    if (!ok) return;
    onDeleteSelected(Array.from(checked));
    setChecked(new Set());
  };

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="mb-4 px-4 py-2 bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white font-medium rounded-lg transition duration-200 shadow-md flex items-center justify-center gap-2"
        title="عرض الأسماء المكررة (تطابق 3 كلمات متتالية)"
      >
        <CopyCheck className="w-4 h-4" /> فحص التكرار
      </button>
    );
  }

  return (
    <div className="mb-4 p-4 bg-gradient-to-br from-amber-500/10 to-orange-500/10 border-2 border-amber-500/30 rounded-lg animate-cardEnter">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <h3 className="text-sm font-bold text-amber-200 flex items-center gap-2">
          <CopyCheck className="w-4 h-4 text-amber-400" /> فحص التكرار
          <span className="text-xs font-normal text-slate-400">(تطابق {MATCH_SIZE} كلمات متتالية)</span>
        </h3>
        <button
          onClick={() => setExpanded(false)}
          className="text-slate-500 hover:text-slate-300 p-1"
          aria-label="إغلاق لوحة فحص التكرار"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {dupCount === 0 ? (
        <div className="text-center py-6">
          <CircleCheck className="w-12 h-12 text-emerald-400 mx-auto mb-2" />
          <p className="text-white font-bold">لا يوجد تكرار</p>
          <p className="text-xs text-slate-400 mt-1">
            لم يُعثر على أسماء متطابقة في {MATCH_SIZE} كلمات متتالية بين {students.length} طالب
          </p>
        </div>
      ) : (
        <>
          <div className="mb-3 p-2.5 bg-amber-500/10 border border-amber-500/30 rounded-lg flex items-center justify-between gap-3 flex-wrap">
            <p className="text-xs text-amber-200 flex items-center gap-2">
              <TriangleAlert className="w-4 h-4 shrink-0" />
              {dupCount} طالب في {clusters.length} مجموعة متشابهة
            </p>
            {students.length > 8 && (
              <div className="relative flex-1 min-w-[180px] max-w-xs">
                <input
                  type="text"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="تصفية بالاسم أو الكود..."
                  aria-label="تصفية النتائج بالاسم أو الكود"
                  className="w-full px-3 py-1.5 pr-8 border border-slate-600 bg-slate-800 text-white placeholder:text-slate-400 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent text-xs"
                  dir="rtl"
                />
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
              </div>
            )}
          </div>

          <div className="space-y-2.5 max-h-[420px] overflow-y-auto pl-1">
            {visibleClusters.map((cluster, ci) => (
              <div key={ci} className="p-3 bg-white/5 border border-white/10 rounded-lg">
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <span className="text-xs font-bold text-amber-300">المجموعة {ci + 1}</span>
                  {cluster.matches.map((m, mi) => (
                    <span key={mi} className="px-2 py-0.5 bg-amber-500/15 text-amber-200 rounded text-xs">
                      {m.join(' ')}
                    </span>
                  ))}
                </div>
                <ul className="space-y-1">
                  {cluster.students.map(s => {
                    const isChecked = checked.has(s.id);
                    return (
                      <li key={s.id}>
                        <label
                          className={`flex items-center justify-between gap-3 text-sm px-3 py-2 rounded-lg cursor-pointer transition ${
                            isChecked ? 'bg-red-500/15 ring-1 ring-red-500/50' : 'bg-slate-800/60 hover:bg-slate-800'
                          }`}
                        >
                          <span className="flex items-center gap-2.5 min-w-0">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => toggle(s.id)}
                              aria-label={`تحديد ${s.name} للحذف`}
                              className="w-4 h-4 accent-red-500 cursor-pointer shrink-0"
                            />
                            <span className={`truncate ${isChecked ? 'line-through text-slate-400' : 'text-white'}`}>
                              {s.name}
                            </span>
                          </span>
                          <span className="flex items-center gap-2 shrink-0">
                            {s.group && (
                              <span className="px-1.5 py-0.5 bg-slate-700 rounded text-xs text-slate-300">{s.group}</span>
                            )}
                            <span className="font-mono text-blue-300 text-xs">{s.code}</span>
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>

          <div className="sticky bottom-0 -mx-4 mt-3 px-4 py-3 border-t border-white/10 bg-slate-900/95 backdrop-blur-sm flex items-center justify-between gap-3 flex-wrap rounded-b-lg">
            <p className="text-xs text-slate-400">
              {checked.size > 0 ? `محدد ${checked.size} طالب للحذف` : 'حدد الطلاب الذين تريد حذفهم (أبقِ واحداً على الأقل في كل مجموعة)'}
            </p>
            <button
              onClick={handleDelete}
              disabled={checked.size === 0}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium rounded-lg transition duration-200 flex items-center gap-2"
            >
              <Trash2 className="w-4 h-4" /> حذف المحدد ({checked.size})
            </button>
          </div>
        </>
      )}
    </div>
  );
};
