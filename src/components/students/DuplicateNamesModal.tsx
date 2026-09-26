import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { CopyCheck, X, TriangleAlert, CircleCheck } from 'lucide-react';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { findDuplicateNames, countDuplicateStudents } from '../../lib/duplicateNames';
import type { Student } from '../../types/student';

interface DuplicateNamesModalProps {
  isOpen: boolean;
  onClose: () => void;
  students: Student[];
}

const MATCH_SIZE = 3;

export const DuplicateNamesModal: React.FC<DuplicateNamesModalProps> = ({ isOpen, onClose, students }) => {
  const [query, setQuery] = useState('');
  useBodyScrollLock(isOpen);

  const clusters = useMemo(() => (isOpen ? findDuplicateNames(students, MATCH_SIZE) : []), [isOpen, students]);
  const dupCount = countDuplicateStudents(clusters);

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

  if (!isOpen) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fadeIn"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="dup-finder-title"
    >
      <div
        className="bg-slate-900 border border-white/10 rounded-2xl max-w-3xl w-full max-h-[85vh] overflow-hidden shadow-2xl animate-modalUp flex flex-col"
        onClick={e => e.stopPropagation()}
        onKeyDown={e => { if (e.key === 'Escape') onClose(); }}
      >
        <div className="flex items-center justify-between p-5 border-b border-white/10 shrink-0">
          <h3 id="dup-finder-title" className="text-xl font-bold text-white flex items-center gap-2">
            <CopyCheck className="w-6 h-6 text-amber-400" /> الأسماء المكررة
            <span className="text-sm font-normal text-slate-400">(تطابق {MATCH_SIZE} كلمات متتالية)</span>
          </h3>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 p-1" aria-label="إغلاق">
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto">
          {dupCount === 0 ? (
            <div className="text-center py-10">
              <CircleCheck className="w-14 h-14 text-emerald-400 mx-auto mb-3" />
              <p className="text-white font-bold text-lg">لا يوجد تكرار</p>
              <p className="text-sm text-slate-400 mt-1">
                لم يُعثر على أسماء متطابقة في {MATCH_SIZE} كلمات متتالية بين {students.length} طالب
              </p>
            </div>
          ) : (
            <>
              <div className="mb-4 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg flex items-center gap-2">
                <TriangleAlert className="w-5 h-5 text-amber-400 shrink-0" />
                <p className="text-sm text-amber-200">
                  {dupCount} طالب في {clusters.length} مجموعة متشابهة — راجع الأسماء المكررة أدناه
                </p>
              </div>

              {students.length > 8 && (
                <input
                  type="text"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="تصفية بالاسم أو الكود أو الكروب..."
                  className="w-full mb-4 px-4 py-2 border border-slate-600 bg-slate-800 text-white placeholder:text-slate-400 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  dir="rtl"
                />
              )}

              <div className="space-y-3">
                {visibleClusters.map((cluster, ci) => (
                  <div key={ci} className="p-4 bg-white/5 border border-white/10 rounded-lg">
                    <div className="flex items-center gap-2 mb-3 flex-wrap">
                      <span className="text-xs font-bold text-amber-300">المجموعة {ci + 1}</span>
                      <span className="text-xs text-slate-400">الكلمات المشتركة:</span>
                      {cluster.matches.map((m, mi) => (
                        <span key={mi} className="px-2 py-0.5 bg-amber-500/15 text-amber-200 rounded text-xs">
                          {m.join(' ')}
                        </span>
                      ))}
                    </div>
                    <ul className="space-y-1.5">
                      {cluster.students.map(s => (
                        <li key={s.id} className="flex items-center justify-between gap-3 text-sm bg-slate-800/60 rounded px-3 py-2">
                          <span className="text-white">{s.name}</span>
                          <span className="flex items-center gap-2 shrink-0">
                            {s.group && (
                              <span className="px-1.5 py-0.5 bg-slate-700 rounded text-xs text-slate-300">{s.group}</span>
                            )}
                            <span className="font-mono text-blue-300 text-xs">{s.code}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="p-4 border-t border-white/10 flex justify-end shrink-0">
          <button
            onClick={onClose}
            className="px-6 py-2.5 bg-white/10 hover:bg-white/20 text-white font-medium rounded-md transition"
          >
            إغلاق
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
