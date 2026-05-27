import React from 'react';
import { College, Stage } from '../types/student';
import { User } from '../types/user';

interface StageSelectorProps {
  user: User;
  colleges: College[];
  stages: Stage[];
  onSelect: (collegeId: string, stageId: string) => void;
}

export const StageSelector: React.FC<StageSelectorProps> = ({
  user,
  colleges,
  stages,
  onSelect,
}) => {
  const getAllowedStages = (collegeId: string) => {
    const collegeStages = stages.filter(s => s.collegeId === collegeId);
    
    if (user.role === 'admin' || user.role === 'college_admin') return collegeStages;
    
    const allowedIds = user.permissions?.allowedStages[collegeId] || [];
    return collegeStages.filter(s => allowedIds.includes(s.id));
  };

  const allowedColleges = colleges.filter(college => {
    if (user.role === 'admin') return true;
    if (user.role === 'college_admin') return college.id === user.collegeId;
    return !!user.permissions?.allowedStages[college.id];
  });

  if ((user.role === 'teacher' || user.role === 'college_admin') && user.active === false) {
    return (
      <div className="bg-white rounded-lg shadow-md p-12 text-center">
        <div className="text-6xl mb-4">🔒</div>
        <h2 className="text-2xl font-bold text-gray-800 mb-2">
          حسابك معطّل حالياً
        </h2>
        <div className="max-w-md mx-auto space-y-3">
          <p className="text-gray-600">
            تم تعطيل حسابك بعد تصفير السنة الأكاديمية الماضية.
          </p>
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-sm text-yellow-800">
            <p className="font-bold mb-2">📞 للمتابعة:</p>
            <p>يرجى التواصل مع الأدمن لإعادة تفعيل حسابك وتحديد المراحل المسموح لك بالوصول إليها للسنة الأكاديمية الجديدة.</p>
          </div>
          {user.deactivatedAt && (
            <p className="text-xs text-gray-400">
              تاريخ التعطيل: {new Date(user.deactivatedAt).toLocaleDateString('ar')}
            </p>
          )}
        </div>
      </div>
    );
  }

  if (allowedColleges.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow-md p-12 text-center">
        <div className="text-6xl mb-4">🔒</div>
        <h2 className="text-2xl font-bold text-gray-800 mb-2">لا توجد صلاحيات وصول</h2>
        <p className="text-gray-600">
          {user.role === 'admin' || user.role === 'college_admin'
            ? 'ابدأ بإنشاء كلية ومراحل من تبويب "إدارة الكليات"'
            : 'يرجى التواصل مع الأدمن لتحديد الكليات والمراحل المسموح لك بالوصول إليها'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="text-center mb-8">
        <h2 className="text-3xl font-bold text-gray-800 mb-2">إلى أين نتوجه اليوم؟</h2>
        <p className="text-gray-600">اختر الكلية والمرحلة لبدء العمل</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {allowedColleges.map(college => {
          const allowedStages = getAllowedStages(college.id);
          if (allowedStages.length === 0 && user.role !== 'admin') return null;

          return (
            <div key={college.id} className="bg-white rounded-2xl shadow-lg overflow-hidden border-2 border-transparent hover:border-blue-400 transition-all">
              <div className={`bg-gradient-to-r ${getCollegeGradient(college.color)} p-6 text-white`}>
                <div className="flex items-center gap-4">
                  <span className="text-5xl">{college.icon || '🏛️'}</span>
                  <div>
                    <h3 className="text-2xl font-bold">{college.name}</h3>
                    <p className="opacity-90">{allowedStages.length} مراحل متاحة</p>
                  </div>
                </div>
              </div>

              <div className="p-6">
                {allowedStages.length === 0 ? (
                  <p className="text-gray-500 text-center py-4">لا توجد مراحل مضافة بعد</p>
                ) : (
                  <div className="grid grid-cols-1 gap-3">
                    {allowedStages.sort((a,b) => (a.order||0) - (b.order||0)).map(stage => (
                      <button
                        key={stage.id}
                        onClick={() => onSelect(college.id, stage.id)}
                        className="flex items-center justify-between p-4 bg-gray-50 hover:bg-blue-50 border border-gray-200 rounded-xl transition group"
                      >
                        <span className="font-bold text-gray-700 group-hover:text-blue-700">📖 {stage.name}</span>
                        <span className="text-blue-500 opacity-0 group-hover:opacity-100 transition">دخول ←</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

function getCollegeGradient(color?: string) {
  switch (color) {
    case 'blue': return 'from-blue-600 to-blue-800';
    case 'green': return 'from-green-600 to-green-800';
    case 'purple': return 'from-purple-600 to-purple-800';
    case 'red': return 'from-red-600 to-red-800';
    case 'orange': return 'from-orange-600 to-orange-800';
    case 'pink': return 'from-pink-600 to-pink-800';
    case 'teal': return 'from-teal-600 to-teal-800';
    case 'indigo': return 'from-indigo-600 to-indigo-800';
    default: return 'from-blue-600 to-blue-800';
  }
}