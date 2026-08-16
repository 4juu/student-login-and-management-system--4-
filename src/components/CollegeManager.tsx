import React, { useState } from 'react';
import { BookOpen, ChevronDown, ChevronUp, CircleCheck, FolderOpen, Landmark, Plus, Trash2, Zap } from 'lucide-react';
import { College, Stage } from '../types/student';

interface CollegeManagerProps {
  colleges: College[];
  stages: Stage[];
  adminUid: string;
  onAddCollege: (college: College) => void;
  onDeleteCollege: (collegeId: string) => void;
  onAddStage: (stage: Stage) => void;
  onDeleteStage: (stageId: string) => void;
  onSelectStage: (collegeId: string, stageId: string) => void;
}

export const CollegeManager: React.FC<CollegeManagerProps> = React.memo(({
  colleges,
  stages,
  adminUid,
  onAddCollege,
  onDeleteCollege,
  onAddStage,
  onDeleteStage,
  onSelectStage,
}) => {
  const [showAddCollege, setShowAddCollege] = useState(false);
  const [collegeName, setCollegeName] = useState('');
  const [collegeIcon, setCollegeIcon] = useState('🏛️');
  const [collegeColor, setCollegeColor] = useState('blue');
  
  const [expandedCollege, setExpandedCollege] = useState<string | null>(null);
  const [showAddStage, setShowAddStage] = useState<string | null>(null);
  const [stageName, setStageName] = useState('');

  const colorOptions = [
    { name: 'blue', class: 'from-blue-500 to-blue-700', label: 'أزرق' },
    { name: 'green', class: 'from-green-500 to-green-700', label: 'أخضر' },
    { name: 'purple', class: 'from-purple-500 to-purple-700', label: 'بنفسجي' },
    { name: 'red', class: 'from-red-500 to-red-700', label: 'أحمر' },
    { name: 'orange', class: 'from-orange-500 to-orange-700', label: 'برتقالي' },
    { name: 'pink', class: 'from-pink-500 to-pink-700', label: 'وردي' },
    { name: 'teal', class: 'from-teal-500 to-teal-700', label: 'فيروزي' },
    { name: 'indigo', class: 'from-indigo-500 to-indigo-700', label: 'نيلي' },
  ];

  const iconOptions = ['🏛️', '💊', '⚕️', '🏥', '🦷', '👁️', '🧪', '🔬', '🔍', '⚖️', '💻', '🎓'];

  const getColorClass = (color?: string) => {
    const found = colorOptions.find(c => c.name === color);
    return found?.class || 'from-blue-500 to-blue-700';
  };

  const handleAddCollege = (e: React.FormEvent) => {
    e.preventDefault();
    if (!collegeName.trim()) {
      alert('الرجاء إدخال اسم الكلية');
      return;
    }

    const newCollege: College = {
      id: `college_${Date.now()}`,
      name: collegeName.trim(),
      icon: collegeIcon,
      color: collegeColor,
      createdAt: new Date().toISOString(),
      createdBy: adminUid,
    };

    onAddCollege(newCollege);
    setCollegeName('');
    setCollegeIcon('🏛️');
    setCollegeColor('blue');
    setShowAddCollege(false);
  };

  const handleAddStage = (collegeId: string) => {
    if (!stageName.trim()) {
      alert('الرجاء إدخال اسم المرحلة');
      return;
    }

    const collegeStages = stages.filter(s => s.collegeId === collegeId);
    const newStage: Stage = {
      id: `stage_${Date.now()}`,
      name: stageName.trim(),
      collegeId,
      createdAt: new Date().toISOString(),
      order: collegeStages.length + 1,
    };

    onAddStage(newStage);
    setStageName('');
    setShowAddStage(null);
  };

  const handleQuickAdd5Stages = (collegeId: string) => {
    if (!window.confirm('سيتم إضافة 5 مراحل (المرحلة الأولى - الخامسة). هل أنت متأكد؟')) return;
    
    const stageNames = ['المرحلة الأولى', 'المرحلة الثانية', 'المرحلة الثالثة', 'المرحلة الرابعة', 'المرحلة الخامسة'];
    const collegeStages = stages.filter(s => s.collegeId === collegeId);
    
    stageNames.forEach((name, idx) => {
      const newStage: Stage = {
        id: `stage_${Date.now()}_${idx}`,
        name,
        collegeId,
        createdAt: new Date().toISOString(),
        order: collegeStages.length + idx + 1,
      };
      onAddStage(newStage);
    });
  };

  const handleDeleteCollege = (college: College) => {
    const collegeStages = stages.filter(s => s.collegeId === college.id);
    if (window.confirm(
      `تحذير!\n\nهل تريد حذف ${college.name}؟\n\nسيتم حذف:\n• ${collegeStages.length} مرحلة\n• جميع الطلاب\n• جميع السجلات\n\nهذا الإجراء لا يمكن التراجع عنه!`
    )) {
      onDeleteCollege(college.id);
    }
  };

  const handleDeleteStage = (stage: Stage) => {
    if (window.confirm(
      `هل تريد حذف ${stage.name}؟\n\nسيتم حذف جميع طلاب وسجلات هذه المرحلة!`
    )) {
      onDeleteStage(stage.id);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-2"><Landmark className="w-6 h-6 text-amber-600" /> إدارة الكليات والمراحل</h2>
        <button
          onClick={() => setShowAddCollege(!showAddCollege)}
          className="bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 text-white font-medium py-2 px-4 rounded-md transition duration-200 flex items-center gap-2 shadow-md"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          إضافة كلية / قسم جديد
        </button>
      </div>

      {/* نموذج إضافة كلية */}
      {showAddCollege && (
        <form onSubmit={handleAddCollege} className="mb-6 p-5 bg-gradient-to-br from-green-50 to-emerald-50 border-2 border-green-200 rounded-lg">
          <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2"><Plus className="w-5 h-5 text-green-600" /> إضافة كلية / قسم جديد</h3>
          
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              اسم الكلية / القسم
            </label>
            <input
              type="text"
              value={collegeName}
              onChange={(e) => setCollegeName(e.target.value)}
              placeholder="مثال: كلية الصيدلة"
              className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-green-500"
              dir="rtl"
              autoFocus
            />
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              اختر أيقونة:
            </label>
            <div className="flex flex-wrap gap-2">
              {iconOptions.map(icon => (
                <button
                  key={icon}
                  type="button"
                  onClick={() => setCollegeIcon(icon)}
                  className={`w-12 h-12 text-2xl rounded-lg transition duration-200 ${
                    collegeIcon === icon
                      ? 'bg-green-600 scale-110 shadow-lg'
                      : 'bg-white border-2 border-gray-300 hover:border-green-400'
                  }`}
                >
                  {icon}
                </button>
              ))}
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              اختر اللون:
            </label>
            <div className="flex flex-wrap gap-2">
              {colorOptions.map(color => (
                <button
                  key={color.name}
                  type="button"
                  onClick={() => setCollegeColor(color.name)}
                  className={`px-4 py-2 rounded-lg font-medium text-white bg-gradient-to-r ${color.class} transition duration-200 ${
                    collegeColor === color.name ? 'ring-4 ring-offset-2 scale-105' : ''
                  }`}
                >
                  {color.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-2">
            <button
              type="submit"
              className="flex-1 bg-green-600 hover:bg-green-700 text-white font-medium py-2 px-6 rounded-md transition duration-200"
            >
              <CircleCheck className="w-4 h-4" /> إنشاء الكلية
            </button>
            <button
              type="button"
              onClick={() => {
                setShowAddCollege(false);
                setCollegeName('');
              }}
              className="bg-gray-400 hover:bg-gray-500 text-white font-medium py-2 px-4 rounded-md transition duration-200"
            >
              إلغاء
            </button>
          </div>
        </form>
      )}

      {/* قائمة الكليات */}
      {colleges.length === 0 ? (
        <div className="text-center py-12 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
          <div className="mx-auto w-16 h-16 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mb-4"><Landmark className="w-8 h-8 text-amber-400" /></div>
          <p className="text-gray-600 font-medium mb-2">لا توجد كليات بعد</p>
          <p className="text-sm text-gray-500">انقر على "إضافة كلية / قسم جديد" للبدء</p>
        </div>
      ) : (
        <div className="space-y-4">
          {colleges.map(college => {
            const collegeStages = stages
              .filter(s => s.collegeId === college.id)
              .sort((a, b) => (a.order || 0) - (b.order || 0));
            const isExpanded = expandedCollege === college.id;

            return (
              <div key={college.id} className="border-2 border-gray-200 rounded-xl overflow-hidden hover:shadow-lg transition-all">
                {/* رأس الكلية */}
                <div className={`bg-gradient-to-r ${getColorClass(college.color)} p-4 text-white`}>
                  <div className="flex items-center justify-between flex-wrap gap-3">
                    <div className="flex items-center gap-3">
                      <span className="text-4xl">{college.icon || '🏛️'}</span>
                      <div>
                        <h3 className="text-xl font-bold">{college.name}</h3>
                        <p className="text-sm opacity-90">
                          {collegeStages.length} مرحلة
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setExpandedCollege(isExpanded ? null : college.id)}
                        className="bg-white bg-opacity-20 hover:bg-opacity-30 px-4 py-2 rounded-md font-medium transition"
                      >
                        {isExpanded ? <><ChevronUp className="w-4 h-4" /> إخفاء</> : <><ChevronDown className="w-4 h-4" /> عرض المراحل</>}
                      </button>
                      <button
                        onClick={() => handleDeleteCollege(college)}
                        className="bg-red-600 hover:bg-red-700 px-3 py-2 rounded-md font-medium transition"
                        title="حذف الكلية"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                </div>

                {/* المراحل */}
                {isExpanded && (
                  <div className="p-4 bg-gray-50">
                    {/* أزرار الإضافة */}
                    <div className="flex flex-wrap gap-2 mb-4">
                      <button
                        onClick={() => setShowAddStage(showAddStage === college.id ? null : college.id)}
                        className="bg-blue-600 hover:bg-blue-700 text-red font-medium py-2 px-4 rounded-md transition flex items-center gap-2"
                      >
                        <Plus className="w-4 h-4" /> إضافة مرحلة
                      </button>
                      {collegeStages.length === 0 && (
                        <button
                          onClick={() => handleQuickAdd5Stages(college.id)}
                          className="bg-purple-600 hover:bg-purple-700 text-red font-medium py-2 px-4 rounded-md transition flex items-center gap-2"
                        >
                          <Zap className="w-4 h-4" /> إضافة 5 مراحل دفعة واحدة
                        </button>
                      )}
                    </div>

                    {/* نموذج إضافة مرحلة */}
                    {showAddStage === college.id && (
                      <div className="mb-4 p-3 bg-white border-2 border-blue-200 rounded-md flex gap-2">
                        <input
                          type="text"
                          value={stageName}
                          onChange={(e) => setStageName(e.target.value)}
                          placeholder="مثال: المرحلة الأولى"
                          className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500"
                          dir="rtl"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleAddStage(college.id);
                          }}
                        />
                        <button
                          onClick={() => handleAddStage(college.id)}
                          className="bg-blue-600 hover:bg-blue-700 text-white font-medium px-4 rounded-md transition"
                        >
                          إضافة
                        </button>
                        <button
                          onClick={() => {
                            setShowAddStage(null);
                            setStageName('');
                          }}
                          className="bg-gray-400 hover:bg-gray-500 text-white font-medium px-4 rounded-md transition"
                        >
                          إلغاء
                        </button>
                      </div>
                    )}

                    {/* قائمة المراحل */}
                    {collegeStages.length === 0 ? (
                      <div className="text-center py-6 text-gray-500">
                        لا توجد مراحل بعد - أضف مرحلة جديدة
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                        {collegeStages.map(stage => (
                          <div
                            key={stage.id}
                            className="bg-white border-2 border-gray-200 hover:border-blue-400 rounded-lg p-4 transition group"
                          >
                            <div className="flex items-center justify-between mb-3">
                              <h4 className="font-bold text-gray-800 flex items-center gap-2"><BookOpen className="w-4 h-4 text-blue-500" /> {stage.name}</h4>
                              <button
                                onClick={() => handleDeleteStage(stage)}
                                className="text-red-500 hover:text-red-700 opacity-0 group-hover:opacity-100 transition"
                                title="حذف المرحلة"
                              >
                                <Trash2 className="w-5 h-5" />
                              </button>
                            </div>
                            <button
                              onClick={() => onSelectStage(college.id, stage.id)}
                              className={`w-full bg-gradient-to-r ${getColorClass(college.color)} hover:opacity-90 text-white font-medium py-2 px-4 rounded-md transition shadow-sm`}
                            >
                              <FolderOpen className="w-4 h-4" /> فتح المرحلة
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}


    </div>
  );
});