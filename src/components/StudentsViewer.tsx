import React, { useState, useMemo } from 'react';
import { Student } from '../types/student';
import { ChartColumn, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Eye, Search, Tag, Users } from 'lucide-react';

interface StudentsViewerProps {
  students: Student[];
  onOpenProfile?: (student: Student) => void;
}

// 🆕 عدد الطلاب بكل صفحة
const PAGE_SIZE_OPTIONS = [25, 50, 100, 200];
const DEFAULT_PAGE_SIZE = 50;

export const StudentsViewer: React.FC<StudentsViewerProps> = React.memo(({ students, onOpenProfile }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [groupFilter, setGroupFilter] = useState<string>('all');

  // 🆕 Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  // 🆕 الكروبات الفريدة (محسّن بـ useMemo)
  const uniqueGroups = useMemo(() => {
    return Array.from(new Set(
      students.map(s => s.group).filter(Boolean)
    )).sort((a, b) => {
      const la = a!.charAt(0).toUpperCase();
      const lb = b!.charAt(0).toUpperCase();
      if (la !== lb) return la.localeCompare(lb);
      const na = parseInt(a!.slice(1)) || 0;
      const nb = parseInt(b!.slice(1)) || 0;
      return na - nb;
    });
  }, [students]);

  // 🆕 تصفية الطلاب (محسّن بـ useMemo)
  const filteredStudents = useMemo(() => {
    return students.filter(s => {
      const matchSearch = !searchQuery ||
        s.name.includes(searchQuery) ||
        s.code.includes(searchQuery);
      const matchGroup = groupFilter === 'all' || s.group === groupFilter;
      return matchSearch && matchGroup;
    });
  }, [students, searchQuery, groupFilter]);

  // 🆕 إحصائيات الكروبات (محسّن بـ useMemo)
  const groupStats = useMemo(() => {
    return uniqueGroups.reduce((acc, group) => {
      acc[group!] = students.filter(s => s.group === group).length;
      return acc;
    }, {} as Record<string, number>);
  }, [students, uniqueGroups]);

  // 🆕 Pagination - حساب الصفحات
  const totalPages = Math.max(1, Math.ceil(filteredStudents.length / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);

  // 🆕 الطلاب في الصفحة الحالية فقط
  const paginatedStudents = useMemo(() => {
    const start = (safeCurrentPage - 1) * pageSize;
    return filteredStudents.slice(start, start + pageSize);
  }, [filteredStudents, safeCurrentPage, pageSize]);

  // 🆕 إعادة تعيين الصفحة عند تغيير البحث/الفلتر
  React.useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, groupFilter, pageSize]);

  return (
    <div className="glass-card rounded-xl p-6">
      <div className="flex justify-between items-center mb-6 flex-wrap gap-3">
        <h2 className="text-2xl font-bold text-white flex items-center gap-2"><Users className="w-6 h-6 text-slate-300" /> قائمة الطلاب</h2>
        <div className="px-4 py-2 bg-yellow-500/15 text-yellow-300 rounded-lg text-sm font-medium flex items-center gap-2">
          <Eye className="w-4 h-4" /> عرض فقط - الإدارة من قبل الأدمن
        </div>
      </div>

      {/* شريط البحث والفلتر */}
      <div className="mb-6 grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* البحث */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2 flex items-center gap-1">
            <Search className="w-4 h-4" /> البحث (الاسم أو الرمز)
          </label>
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="اكتب اسم الطالب أو الرمز..."
              className="w-full px-4 py-2 pr-10 border border-slate-600 bg-slate-800 text-white placeholder:text-slate-500 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              dir="rtl"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-400 text-xl"
              >
                ×
              </button>
            )}
          </div>
        </div>

        {/* فلتر الكروب */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2 flex items-center gap-1">
            <Tag className="w-4 h-4" /> تصفية حسب الكروب
          </label>
          <select
            value={groupFilter}
            onChange={(e) => setGroupFilter(e.target.value)}
            className="w-full px-4 py-2 border border-slate-600 bg-slate-800 text-white rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="all">جميع الكروبات ({students.length})</option>
            {uniqueGroups.map(g => (
              <option key={g} value={g}>
                {g} ({groupStats[g!]})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* إحصائيات الكروبات - أزرار سريعة */}
      {uniqueGroups.length > 0 && uniqueGroups.length <= 20 && (
        <div className="mb-6 p-4 bg-gradient-to-r from-blue-500/10 to-indigo-500/10 border-2 border-blue-500/30 rounded-lg">
          <h3 className="text-sm font-bold text-blue-300 mb-3 flex items-center gap-2"><ChartColumn className="w-4 h-4" /> إحصائيات الكروبات</h3>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setGroupFilter('all')}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition ${
                groupFilter === 'all'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'bg-white/10 text-blue-300 border border-blue-500/30 hover:bg-blue-500/10'
              }`}
            >
              الكل: {students.length}
            </button>
            {uniqueGroups.map(g => (
              <button
                key={g}
                onClick={() => setGroupFilter(g!)}
                className={`px-3 py-1.5 rounded-full text-sm font-medium transition ${
                  groupFilter === g
                    ? 'bg-blue-600 text-white shadow-md'
                    : 'bg-white/10 text-blue-300 border border-blue-500/30 hover:bg-blue-500/10'
                }`}
              >
                {g}: {groupStats[g!]}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 🆕 شريط Pagination العلوي */}
      {filteredStudents.length > pageSize && (
        <div className="mb-3 p-3 bg-white/5 border border-white/10 rounded-lg flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-slate-400">عرض:</span>
            <select
              value={pageSize}
              onChange={e => setPageSize(Number(e.target.value))}
              className="px-3 py-1 border border-slate-600 bg-slate-800 text-white rounded-md text-sm"
            >
              {PAGE_SIZE_OPTIONS.map(size => (
                <option key={size} value={size}>{size} طالب</option>
              ))}
            </select>
            <span className="text-slate-400">
              ({((safeCurrentPage - 1) * pageSize) + 1} - {Math.min(safeCurrentPage * pageSize, filteredStudents.length)} من {filteredStudents.length})
            </span>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => setCurrentPage(1)}
              disabled={safeCurrentPage === 1}
              className="px-2 py-1 bg-white/10 border border-white/15 rounded disabled:opacity-30 hover:bg-white/20 text-sm"
              title="الصفحة الأولى"
            >
              <ChevronsRight className="w-4 h-4" />
            </button>
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={safeCurrentPage === 1}
              className="px-3 py-1 bg-white/10 border border-white/15 rounded disabled:opacity-30 hover:bg-white/20 text-sm flex items-center gap-1"
            >
              <ChevronRight className="w-4 h-4" /> السابق
            </button>
            <span className="px-3 py-1 bg-blue-600 text-white rounded text-sm font-bold">
              {safeCurrentPage} / {totalPages}
            </span>
            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={safeCurrentPage === totalPages}
              className="px-3 py-1 bg-white/10 border border-white/15 rounded disabled:opacity-30 hover:bg-white/20 text-sm flex items-center gap-1"
            >
              التالي <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => setCurrentPage(totalPages)}
              disabled={safeCurrentPage === totalPages}
              className="px-2 py-1 bg-white/10 border border-white/15 rounded disabled:opacity-30 hover:bg-white/20 text-sm"
              title="الصفحة الأخيرة"
            >
              <ChevronsLeft className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* جدول الطلاب */}
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-white/10">
          <thead className="bg-white/5">
            <tr>
              <th className="px-3 sm:px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                #
              </th>
              <th className="px-3 sm:px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                الرمز
              </th>
              <th className="px-3 sm:px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                الاسم
              </th>
              <th className="px-3 sm:px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                الكروب
              </th>
            </tr>
          </thead>
          <tbody className="bg-white/5 divide-y divide-white/10">
            {paginatedStudents.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 sm:px-6 py-8 sm:py-12 text-center text-slate-400">
                  <div className="flex flex-col items-center gap-2">
                    <svg className="w-16 h-16 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                    {searchQuery || groupFilter !== 'all' ? (
                      <>
                        <p className="font-medium">لا يوجد طلاب يطابقون البحث</p>
                        <button
                          onClick={() => {
                            setSearchQuery('');
                            setGroupFilter('all');
                          }}
                          className="text-blue-400 hover:underline text-sm"
                        >
                          إعادة تعيين الفلاتر
                        </button>
                      </>
                    ) : (
                      <p className="font-medium">لا يوجد طلاب في هذه المرحلة</p>
                    )}
                  </div>
                </td>
              </tr>
            ) : (
              paginatedStudents.map((student, index) => {
                const globalIndex = (safeCurrentPage - 1) * pageSize + index + 1;
                return (
                  <tr
                    key={student.id}
                    className={`hover:bg-blue-500/10 transition ${onOpenProfile ? 'cursor-pointer' : ''}`}
                    onClick={onOpenProfile ? () => onOpenProfile(student) : undefined}
                  >
                    <td className="px-3 sm:px-6 py-4 whitespace-nowrap text-sm text-slate-400">
                      {globalIndex}
                    </td>
                    <td className="px-3 sm:px-6 py-4 whitespace-nowrap">
                      <span className="text-sm sm:text-lg font-bold text-blue-300 bg-blue-500/10 px-2 sm:px-3 py-1 rounded-md">
                        {student.code}
                      </span>
                    </td>
                    <td className="px-3 sm:px-6 py-4 whitespace-nowrap text-right font-medium text-white text-sm">
                      <span className={onOpenProfile ? 'text-blue-400 hover:underline' : ''}>
                        {student.name}
                      </span>
                    </td>
                    <td className="px-3 sm:px-6 py-4 whitespace-nowrap text-right">
                      {student.group ? (
                        <span className="inline-block px-3 py-1 bg-indigo-500/15 text-indigo-300 text-sm font-medium rounded-full">
                          {student.group}
                        </span>
                      ) : (
                        <span className="text-slate-500 text-sm">-</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* 🆕 شريط Pagination السفلي */}
      {filteredStudents.length > pageSize && (
        <div className="mt-4 p-3 bg-white/5 border border-white/10 rounded-lg flex items-center justify-center gap-1 flex-wrap">
          <button
            onClick={() => setCurrentPage(1)}
            disabled={safeCurrentPage === 1}
            className="px-2 py-1 bg-white/10 border border-white/15 rounded disabled:opacity-30 hover:bg-white/20 text-sm flex items-center gap-1"
          >
            <ChevronsRight className="w-4 h-4" /> الأولى
          </button>
          <button
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            disabled={safeCurrentPage === 1}
            className="px-3 py-1 bg-white/10 border border-white/15 rounded disabled:opacity-30 hover:bg-white/20 text-sm flex items-center gap-1"
          >
            <ChevronRight className="w-4 h-4" /> السابق
          </button>

          {/* أرقام الصفحات */}
          {Array.from({ length: Math.min(7, totalPages) }, (_, i) => {
            let pageNum: number;
            if (totalPages <= 7) {
              pageNum = i + 1;
            } else if (safeCurrentPage <= 4) {
              pageNum = i + 1;
            } else if (safeCurrentPage >= totalPages - 3) {
              pageNum = totalPages - 6 + i;
            } else {
              pageNum = safeCurrentPage - 3 + i;
            }
            return (
              <button
                key={pageNum}
                onClick={() => setCurrentPage(pageNum)}
                className={`px-3 py-1 rounded text-sm font-medium ${
                  pageNum === safeCurrentPage
                    ? 'bg-blue-600 text-white'
                    : 'bg-white/10 border border-white/15 hover:bg-white/20'
                }`}
              >
                {pageNum}
              </button>
            );
          })}

          <button
            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
            disabled={safeCurrentPage === totalPages}
            className="px-3 py-1 bg-white/10 border border-white/15 rounded disabled:opacity-30 hover:bg-white/20 text-sm flex items-center gap-1"
          >
            التالي <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={() => setCurrentPage(totalPages)}
            disabled={safeCurrentPage === totalPages}
            className="px-2 py-1 bg-white/10 border border-white/15 rounded disabled:opacity-30 hover:bg-white/20 text-sm flex items-center gap-1"
          >
            الأخيرة <ChevronsLeft className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ملخص النتائج */}
      {students.length > 0 && (
        <div className="mt-4 p-4 bg-blue-500/10 border border-blue-500/30 rounded-md">
          <p className="text-sm text-blue-300 flex items-center gap-1">
            <ChartColumn className="w-4 h-4 shrink-0" /> <strong>عدد الطلاب المعروضين:</strong> {filteredStudents.length}
            {filteredStudents.length !== students.length && (
              <span className="mr-2">من أصل {students.length}</span>
            )}
            {groupFilter !== 'all' && (
              <span className="mr-2">| <strong>الكروب:</strong> {groupFilter}</span>
            )}
            {filteredStudents.length > pageSize && (
              <span className="mr-2 text-purple-400">| <strong>الصفحة:</strong> {safeCurrentPage}/{totalPages}</span>
            )}
          </p>
        </div>
      )}
    </div>
  );
});