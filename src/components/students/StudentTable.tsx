import React from 'react';
import { Student } from '../../types/student';
import {
  getCoveragePercent,
  hasValidDescriptor,
  isGalleryDescriptor,
} from '../../services/faceAI/descriptors';
import { CircleCheck, ClipboardList, IdCard, Pencil, QrCode, RefreshCw, ScanFace, Smile, Trash2, Unlink } from 'lucide-react';

interface StudentTableProps {
  paginatedStudents: Student[];
  selectedIds: Set<string>;
  allInPageSelected: boolean;
  isFiltered: boolean;
  safeCurrentPage: number;
  pageSize: number;
  uniqueGroups: string[];
  onUpdateStudent?: ((id: string, updates: Partial<Student>) => void) | undefined;
  onOpenProfile?: ((student: Student) => void) | undefined;
  onDeleteStudent: (id: string) => void;
  toggleSelectStudent: (id: string) => void;
  toggleSelectAllInPage: () => void;
  openFaceEnroll: (presetIds?: string[] | undefined) => void;
  transferStudentId: string | null;
  setTransferStudentId: React.Dispatch<React.SetStateAction<string | null>>;
  transferGroupValue: string;
  setTransferGroupValue: React.Dispatch<React.SetStateAction<string>>;
  editingUniIdStudent: string | null;
  editUniversityId: string;
  setEditUniversityId: React.Dispatch<React.SetStateAction<string>>;
  startEditUniId: (student: Student) => void;
  saveEditUniId: () => void;
  cancelEditUniId: () => void;
  editingQrStudent: string | null;
  editQrCodeId: string;
  setEditQrCodeId: React.Dispatch<React.SetStateAction<string>>;
  startEditQr: (student: Student) => void;
  saveEditQr: () => void;
  cancelEditQr: () => void;
  removeQrLink: (student: Student) => void;
  removeFaceData: (student: Student) => void;
}

export const StudentTable: React.FC<StudentTableProps> = ({
  paginatedStudents,
  selectedIds,
  allInPageSelected,
  isFiltered,
  safeCurrentPage,
  pageSize,
  uniqueGroups,
  onUpdateStudent,
  onOpenProfile,
  onDeleteStudent,
  toggleSelectStudent,
  toggleSelectAllInPage,
  openFaceEnroll,
  transferStudentId,
  setTransferStudentId,
  transferGroupValue,
  setTransferGroupValue,
  editingUniIdStudent,
  editUniversityId,
  setEditUniversityId,
  startEditUniId,
  saveEditUniId,
  cancelEditUniId,
  editingQrStudent,
  editQrCodeId,
  setEditQrCodeId,
  startEditQr,
  saveEditQr,
  cancelEditQr,
  removeQrLink,
  removeFaceData,
}) => {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-white/10">
        <thead className="bg-white/5">
            <tr>
              <th scope="col" className="px-4 py-3 text-center">
                {paginatedStudents.length > 0 && (
                  <input
                    type="checkbox"
                    checked={allInPageSelected}
                    onChange={toggleSelectAllInPage}
                    className="w-5 h-5 cursor-pointer accent-blue-600"
                    title="تحديد طلاب الصفحة الحالية"
                  />
                )}
              </th>
              <th scope="col" className="px-4 py-3 text-right text-xs font-medium text-slate-400 uppercase tracking-wider">#</th>
              <th scope="col" className="px-4 py-3 text-right text-xs font-medium text-slate-400 uppercase tracking-wider">الرمز</th>
              <th scope="col" className="px-4 py-3 text-right text-xs font-medium text-slate-400 uppercase tracking-wider">الاسم</th>
              <th scope="col" className="px-4 py-3 text-right text-xs font-medium text-slate-400 uppercase tracking-wider">الكروب</th>
              <th scope="col" className="hidden md:table-cell px-4 py-3 text-right text-xs font-medium text-slate-400 uppercase tracking-wider"><span className="inline-flex items-center gap-1"><IdCard className="w-3.5 h-3.5" /> الرقم الجامعي</span></th>
              <th scope="col" className="hidden sm:table-cell px-4 py-3 text-right text-xs font-medium text-slate-400 uppercase tracking-wider"><span className="inline-flex items-center gap-1"><QrCode className="w-3.5 h-3.5" /> رمز QR</span></th>
              <th scope="col" className="hidden sm:table-cell px-4 py-3 text-center text-xs font-medium text-slate-400 uppercase tracking-wider"><span className="inline-flex items-center gap-1"><Smile className="w-3.5 h-3.5" /> الوجه</span></th>
              <th scope="col" className="px-4 py-3 text-right text-xs font-medium text-slate-400 uppercase tracking-wider">إجراءات</th>
            </tr>
        </thead>
        <tbody className="bg-white/5 divide-y divide-white/10">
          {paginatedStudents.length === 0 ? (
            <tr>
              <td colSpan={9} className="px-6 py-8 text-center text-slate-400">
                <div className="flex flex-col items-center gap-2">
                  <p className="font-medium">
                    {isFiltered ? 'لا توجد نتائج للبحث' : 'لا توجد طلاب مسجلين'}
                  </p>
                  {!isFiltered && (
                    <p className="text-sm">ابدأ بإضافة الطلاب أو ارفع ملف Excel</p>
                  )}
                </div>
              </td>
            </tr>
          ) : (
            paginatedStudents.map((student, index) => {
              const globalIndex = (safeCurrentPage - 1) * pageSize + index + 1;

              const hasFace = hasValidDescriptor(student.faceDescriptor);

              return (
                <tr
                  key={student.id}
                  className={`hover:bg-white/5 transition ${selectedIds.has(student.id) ? 'bg-blue-500/10' : ''}`}
                >
                  <td className="px-4 py-4 text-center">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(student.id)}
                      onChange={() => toggleSelectStudent(student.id)}
                      className="w-5 h-5 cursor-pointer accent-blue-600"
                    />
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap text-sm text-slate-400">
                    {globalIndex}
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap">
                    <span className="text-lg font-bold text-blue-600">{student.code}</span>
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap text-right">{student.name}</td>
                  <td className="px-4 py-4 whitespace-nowrap text-right">
                    {transferStudentId === student.id ? (
                      <div className="flex items-center gap-1">
                        <select
                          value={transferGroupValue}
                          onChange={e => {
                            setTransferGroupValue(e.target.value);
                            if (e.target.value !== '__custom__') {
                              // Auto-save on selecting a regular group
                              if (onUpdateStudent) {
                                onUpdateStudent(student.id, { group: e.target.value || undefined });
                              }
                              setTransferStudentId(null);
                              setTransferGroupValue('');
                            }
                          }}
                          className="px-2 py-1 border border-blue-500/40 bg-slate-800 text-white rounded text-sm"
                          autoFocus
                          onKeyDown={e => {
                            if (e.key === 'Escape') { setTransferStudentId(null); setTransferGroupValue(''); }
                          }}
                        >
                          <option value="">بدون كروب</option>
                          {uniqueGroups.filter(g => g !== student.group).map(g => (
                            <option key={g} value={g}>{g}</option>
                          ))}
                          <option value="__custom__">كروب جديد...</option>
                        </select>
                        {transferGroupValue === '__custom__' && (
                          <input
                            type="text"
                            value=""
                            onChange={e => setTransferGroupValue(e.target.value.toUpperCase())}
                            className="w-16 px-2 py-1 border border-blue-500/40 bg-slate-800 text-white rounded text-sm text-center"
                            placeholder="A1"
                            autoFocus
                          />
                        )}
                        <button
                          onClick={() => {
                            if (onUpdateStudent) {
                              const val = transferGroupValue === '__custom__' ? '' : transferGroupValue;
                              onUpdateStudent(student.id, { group: val || undefined });
                            }
                            setTransferStudentId(null);
                            setTransferGroupValue('');
                          }}
                          className="px-2 py-1 bg-green-500 hover:bg-green-600 text-white rounded text-xs"
                          title="حفظ"
                        >
                          ✓
                        </button>
                        <button
                          onClick={() => { setTransferStudentId(null); setTransferGroupValue(''); }}
                          className="px-2 py-1 bg-white/10 hover:bg-white/20 text-white rounded text-xs"
                          title="إلغاء"
                        >
                          ×
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        {student.group ? (
                          <span className="inline-block px-3 py-1 bg-indigo-500/15 text-indigo-300 text-sm font-medium rounded-full">
                            {student.group}
                          </span>
                        ) : (
                          <span className="text-slate-500 text-sm">-</span>
                        )}
                        {onUpdateStudent && (
                          <button
                            onClick={() => { setTransferStudentId(student.id); setTransferGroupValue(student.group || ''); }}
                            className="text-blue-400 hover:text-blue-300 text-xs"
                            title="نقل إلى كروب آخر"
                          >
                            <RefreshCw className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    )}
                  </td>

                  <td className="hidden md:table-cell px-4 py-4 whitespace-nowrap text-right">
                    {editingUniIdStudent === student.id ? (
                      <div className="flex items-center gap-1">
                        <input
                          type="text"
                          value={editUniversityId}
                          onChange={e => setEditUniversityId(e.target.value.replace(/\D/g, ''))}
                          className="w-32 px-2 py-1 border border-blue-500/40 bg-slate-800 text-white rounded text-sm font-mono text-center"
                          autoFocus
                          onKeyDown={e => {
                            if (e.key === 'Enter') saveEditUniId();
                            if (e.key === 'Escape') cancelEditUniId();
                          }}
                        />
                        <button
                          onClick={saveEditUniId}
                          className="px-2 py-1 bg-green-500 hover:bg-green-600 text-white rounded text-xs"
                          title="حفظ"
                        >
                          ✓
                        </button>
                        <button
                          onClick={cancelEditUniId}
                          className="px-2 py-1 bg-white/10 hover:bg-white/20 text-white rounded text-xs"
                          title="إلغاء"
                        >
                          ×
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        {student.universityId ? (
                          <span className="inline-block px-2 py-1 bg-blue-500/10 text-blue-300 text-sm font-mono rounded border border-blue-500/30">
                            {student.universityId}
                          </span>
                        ) : (
                          <span className="text-slate-500 text-xs italic">غير مضاف</span>
                        )}
                        {onUpdateStudent && (
                          <button
                            onClick={() => startEditUniId(student)}
                            className="text-blue-400 hover:text-blue-300 text-xs"
                            title="تعديل الرقم الجامعي"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    )}
                  </td>

                  <td className="hidden sm:table-cell px-4 py-4 whitespace-nowrap text-right">
                    {editingQrStudent === student.id ? (
                      <div className="flex items-center gap-1">
                        <input
                          type="text"
                          value={editQrCodeId}
                          onChange={e => setEditQrCodeId(e.target.value)}
                          className="w-40 px-2 py-1 border border-emerald-500/40 bg-slate-800 text-white rounded text-xs font-mono text-center"
                          dir="ltr"
                          placeholder="QR ID أو رابط"
                          autoFocus
                          onKeyDown={e => {
                            if (e.key === 'Enter') saveEditQr();
                            if (e.key === 'Escape') cancelEditQr();
                          }}
                        />
                        <button
                          onClick={saveEditQr}
                          className="px-2 py-1 bg-green-500 hover:bg-green-600 text-white rounded text-xs"
                          title="حفظ"
                        >
                          ✓
                        </button>
                        <button
                          onClick={cancelEditQr}
                          className="px-2 py-1 bg-white/10 hover:bg-white/20 text-white rounded text-xs"
                          title="إلغاء"
                        >
                          ×
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        {student.qrCodeId ? (
                          <span
                            className="inline-block px-2 py-1 bg-emerald-500/10 text-emerald-300 text-xs font-mono rounded border border-emerald-500/30 max-w-[140px] truncate"
                            dir="ltr"
                            title={student.qrCodeId}
                          >
                            {student.qrCodeId}
                          </span>
                        ) : (
                          <span className="text-slate-500 text-xs italic">غير مربوط</span>
                        )}
                        {onUpdateStudent && (
                          <>
                            <button
                              onClick={() => startEditQr(student)}
                              className="text-emerald-400 hover:text-emerald-300 text-xs"
                              title="تعديل رمز QR"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                            {student.qrCodeId && (
                              <button
                                onClick={() => removeQrLink(student)}
                                className="text-red-400 hover:text-red-300 text-xs"
                                title="فك ربط QR"
                              >
                                <Unlink className="w-4 h-4" />
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </td>

                  <td className="hidden sm:table-cell px-4 py-4 whitespace-nowrap text-center">
                    <div className="flex items-center justify-center gap-1">
                      {hasFace ? (
                        <>
                          <span
                              className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded border bg-emerald-500/10 text-emerald-300 border-emerald-500/30"
                            title={
                              student.faceRegisteredAt
                                ? `سُجلت في: ${new Date(student.faceRegisteredAt).toLocaleDateString('ar-EG')}`
                                : 'مسجّلة'
                            }
                          >
                            <CircleCheck className="w-3.5 h-3.5" />
                            صالحة
                          </span>
                          {isGalleryDescriptor(student.faceDescriptor) && (
                            <span className="text-[10px] text-slate-400" title={`تغطية الزوايا: ${getCoveragePercent(student.faceDescriptor)}%`}>
                              تغطية: {getCoveragePercent(student.faceDescriptor)}%
                            </span>
                          )}
                          {onUpdateStudent && (
                            <button
                              onClick={() => removeFaceData(student)}
                              className="text-red-400 hover:text-red-300 text-xs"
                              title="حذف بصمة الوجه"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </>
                      ) : (
                        <span className="text-slate-500 text-xs italic">غير مسجّلة</span>
                      )}
                    </div>
                  </td>

                  <td className="px-4 py-4 whitespace-nowrap text-right">
                    <div className="flex items-center justify-end gap-3">
                      {onUpdateStudent && (
                        <button
                          onClick={() => openFaceEnroll([student.id])}
                          className="text-violet-400 hover:text-violet-300 font-medium flex items-center gap-1"
                          title="تسجيل / إعادة تسجيل بصمة الوجه لهذا الطالب"
                        >
                          بصمة <ScanFace className="w-4 h-4" />
                        </button>
                      )}
                      {onOpenProfile && (
                        <button
                          onClick={() => onOpenProfile(student)}
                          className="text-blue-400 hover:text-blue-300 font-medium flex items-center gap-1"
                          title="فتح ملف الطالب الكامل"
                        >
                          الملف <ClipboardList className="w-4 h-4" />
                        </button>
                      )}
                      <button
                        onClick={() => onDeleteStudent(student.id)}
                        className="text-red-400 hover:text-red-300 font-medium"
                      >
                        حذف
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
};
