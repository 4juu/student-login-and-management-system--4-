import React, { useState } from 'react';
import { BookOpen, ChevronDown, ChevronUp, CircleCheck, FolderOpen, Landmark, Plus, Trash2, Zap } from 'lucide-react';
import { College, Stage } from '../types/student';
import { ConfirmDialog } from './ConfirmDialog';

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

  const [confirmState, setConfirmState] = useState<{ open: boolean; title: string; message: string; onConfirm: () => void }>({ open: false, title: '', message: '', onConfirm: () => {} });

  const colorOptions = [
    { name: 'blue', class: 'from-blue-500 to-blue-700', label: 'أزرق' },
    { name: 'green', class: 'from-green-500 to-green-700', label: 'أخضر' },
    { name: 'purple', class: 'from-purple-500 to-purple-700', label: 'بنفسجي' },
    { name: 'red', class: 'from-red-500 to-red-700', label: 'أحمر' },
    { name: 'orange', class: 'from-orange-500 to-orange-700', label: 'برتقالي' },
    { name: 'pink', class: 'from-pink-500 to-pink-700', label: 'وردي' },
    { name: 'teal', class: 'from-teal-500 to-teal-700', label: 'فيروزي' },
    { name: 'indigo', class: 'from-indigo-500 to-indigo-700', label: 'نيلي' },
    { name: 'emerald', class: 'from-emerald-500 to-emerald-700', label: 'زمردي' },
    { name: 'amber', class: 'from-amber-500 to-amber-700', label: 'كهرماني' },
    { name: 'cyan', class: 'from-cyan-500 to-cyan-700', label: 'سماوي' },
    { name: 'rose', class: 'from-rose-500 to-rose-700', label: 'قرمزي' },
    { name: 'lime', class: 'from-lime-500 to-lime-700', label: 'ليموني' },
    { name: 'fuchsia', class: 'from-fuchsia-500 to-fuchsia-700', label: 'فوشي' },
    { name: 'sky', class: 'from-sky-500 to-sky-700', label: 'أزرق فاتح' },
    { name: 'violet', class: 'from-violet-500 to-violet-700', label: 'بنفسجي فاتح' },
  ];

  const iconOptions = ['🏛️', '💊', '⚕️', '🏥', '🦷', '👁️', '🧪', '🔬', '🔍', '⚖️', '💻', '🎓'];

  const getColorClass = (color?: string) => {
    const found = colorOptions.find(c => c.name === color);
    return found?.class || 'from-blue-500 to-blue-700';
  };

  const handleAddCollege = (e: React.FormEvent) => {
    e.preventDefault();
    if (!collegeName.trim()) {
      setConfirmState({ open: true, title: 'تنبيه', message: 'الرجاء إدخال اسم الكلية', onConfirm: () => setConfirmState(s => ({ ...s, open: false })) });
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
      setConfirmState({ open: true, title: 'تنبيه', message: 'الرجاء إدخال اسم المرحلة', onConfirm: () => setConfirmState(s => ({ ...s, open: false })) });
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
    setConfirmState({
      open: true,
      title: 'إضافة 5 مراحل',
      message: 'سيتم إضافة 5 مراحل (المرحلة الأولى - الخامسة). هل أنت متأكد؟',
      onConfirm: () => {
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
        setConfirmState(s => ({ ...s, open: false }));
      }
    });
  };

  const handleDeleteCollege = (college: College) => {
    const collegeStages = stages.filter(s => s.collegeId === college.id);
    setConfirmState({
      open: true,
      title: 'حذف الكلية',
      message: `تحذير!\n\nهل تريد حذف ${college.name}؟\n\nسيتم حذف:\n• ${collegeStages.length} مرحلة\n• جميع الطلاب\n• جميع السجلات\n\nهذا الإجراء لا يمكن التراجع عنه!`,
      onConfirm: () => { onDeleteCollege(college.id); setConfirmState(s => ({ ...s, open: false })); }
    });
  };

  const handleDeleteStage = (stage: Stage) => {
    setConfirmState({
      open: true,
      title: 'حذف المرحلة',
      message: `هل تريد حذف ${stage.name}؟\n\nسيتم حذف جميع طلاب وسجلات هذه المرحلة!`,
      onConfirm: () => { onDeleteStage(stage.id); setConfirmState(s => ({ ...s, open: false })); }
    });
  };

  return (
    <div className="glass-card p-6">
      <ConfirmDialog open={confirmState.open} title={confirmState.title} message={confirmState.message} onConfirm={confirmState.onConfirm} onCancel={() => setConfirmState(s => ({ ...s, open: false }))} />

      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-white flex items-center gap-2"><Landmark className="w-6 h-6 text-amber-400" /> إدارة الكليات والمراحل</h2>
        <button
          onClick={() => setShowAddCollege(!showAddCollege)}
          className="btn-base bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-500 hover:to-emerald-600 text-white font-medium py-2 px-4 rounded-xl transition duration-200 flex items-center gap-2 shadow-md"
        >
          <Plus className="w-5 h-5" />
          إضافة كلية / قسم جديد
        </button>
      </div>

      {showAddCollege && (
        <form onSubmit={handleAddCollege} className="mb-6 p-5 bg-emerald-500/10 border-2 border-emerald-500/20 rounded-xl">
          <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2"><Plus className="w-5 h-5 text-emerald-400" /> إضافة كلية / قسم جديد</h3>
          
          <div className="mb-4">
            <label className="block text-sm font-medium text-slate-300 mb-2">اسم الكلية / القسم</label>
            <input
              type="text"
              value={collegeName}
              onChange={(e) => setCollegeName(e.target.value)}
              placeholder="مثال: كلية الصيدلة"
              className="glass-input w-full"
              dir="rtl"
              autoFocus
            />
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium text-slate-300 mb-2">اختر أيقونة:</label>
            <div className="flex flex-wrap gap-2">
              {iconOptions.map(icon => (
                <button
                  key={icon}
                  type="button"
                  onClick={() => setCollegeIcon(icon)}
                  className={`w-12 h-12 text-2xl rounded-lg transition duration-200 ${
                    collegeIcon === icon
                      ? 'bg-emerald-600 scale-110 shadow-lg'
                      : 'bg-white/5 border-2 border-white/10 hover:border-emerald-400'
                  }`}
                >
                  {icon}
                </button>
              ))}
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium text-slate-300 mb-2">اختر اللون:</label>
            <div className="flex flex-wrap gap-2">
              {colorOptions.map(color => (
                <button
                  key={color.name}
                  type="button"
                  onClick={() => setCollegeColor(color.name)}
                  className={`px-4 py-2 rounded-lg font-medium text-white bg-gradient-to-r ${color.class} transition duration-200 ${
                    collegeColor === color.name ? 'ring-4 ring-offset-2 ring-offset-slate-900 scale-105' : ''
                  }`}
                >
                  {color.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-2">
            <button type="submit" className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-medium py-2 px-6 rounded-xl transition duration-200">
              <CircleCheck className="w-4 h-4 inline" /> إنشاء الكلية
            </button>
            <button type="button" onClick={() => { setShowAddCollege(false); setCollegeName(''); }} className="bg-white/10 hover:bg-white/15 text-white font-medium py-2 px-4 rounded-xl transition duration-200">
              إلغاء
            </button>
          </div>
        </form>
      )}

      {colleges.length === 0 ? (
        <div className="text-center py-12 bg-white/5 rounded-xl border-2 border-dashed border-white/10">
          <div className="mx-auto w-16 h-16 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mb-4"><Landmark className="w-8 h-8 text-amber-400" /></div>
          <p className="text-slate-300 font-medium mb-2">لا توجد كليات بعد</p>
          <p className="text-sm text-slate-500">انقر على "إضافة كلية / قسم جديد" للبدء</p>
        </div>
      ) : (
        <div className="space-y-4">
          {colleges.map(college => {
            const collegeStages = stages
              .filter(s => s.collegeId === college.id)
              .sort((a, b) => (a.order || 0) - (b.order || 0));
            const isExpanded = expandedCollege === college.id;

            return (
              <div key={college.id} className="border-2 border-white/10 rounded-xl overflow-hidden hover:border-white/20 transition-all">
                <div className={`bg-gradient-to-r ${getColorClass(college.color)} p-4 text-white`}>
                  <div className="flex items-center justify-between flex-wrap gap-3">
                    <div className="flex items-center gap-3">
                      <span className="text-4xl">{college.icon || '🏛️'}</span>
                      <div>
                        <h3 className="text-xl font-bold">{college.name}</h3>
                        <p className="text-sm opacity-90">{collegeStages.length} مرحلة</p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setExpandedCollege(isExpanded ? null : college.id)}
                        className="bg-white/20 hover:bg-white/30 px-4 py-2 rounded-md font-medium transition"
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

                {isExpanded && (
                  <div className="p-4 bg-slate-800/50">
                    <div className="flex flex-wrap gap-2 mb-4">
                      <button
                        onClick={() => setShowAddStage(showAddStage === college.id ? null : college.id)}
                        className="bg-blue-600 hover:bg-blue-500 text-white font-medium py-2 px-4 rounded-md transition flex items-center gap-2"
                      >
                        <Plus className="w-4 h-4" /> إضافة مرحلة
                      </button>
                      {collegeStages.length === 0 && (
                        <button
                          onClick={() => handleQuickAdd5Stages(college.id)}
                          className="bg-purple-600 hover:bg-purple-500 text-white font-medium py-2 px-4 rounded-md transition flex items-center gap-2"
                        >
                          <Zap className="w-4 h-4" /> إضافة 5 مراحل دفعة واحدة
                        </button>
                      )}
                    </div>

                    {showAddStage === college.id && (
                      <div className="mb-4 p-3 bg-white/5 border-2 border-blue-500/20 rounded-md flex gap-2">
                        <input
                          type="text"
                          value={stageName}
                          onChange={(e) => setStageName(e.target.value)}
                          placeholder="مثال: المرحلة الأولى"
                          className="flex-1 glass-input"
                          dir="rtl"
                          autoFocus
                          onKeyDown={(e) => { if (e.key === 'Enter') handleAddStage(college.id); }}
                        />
                        <button onClick={() => handleAddStage(college.id)} className="bg-blue-600 hover:bg-blue-500 text-white font-medium px-4 rounded-md transition">إضافة</button>
                        <button onClick={() => { setShowAddStage(null); setStageName(''); }} className="bg-white/10 hover:bg-white/15 text-white font-medium px-4 rounded-md transition">إلغاء</button>
                      </div>
                    )}

                    {collegeStages.length === 0 ? (
                      <div className="text-center py-6 text-slate-400">لا توجد مراحل بعد - أضف مرحلة جديدة</div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                        {collegeStages.map(stage => (
                          <div key={stage.id} className="bg-white/5 border-2 border-white/10 hover:border-blue-400/50 rounded-lg p-4 transition group">
                            <div className="flex items-center justify-between mb-3">
                              <h4 className="font-bold text-white flex items-center gap-2"><BookOpen className="w-4 h-4 text-blue-400" /> {stage.name}</h4>
                              <button
                                onClick={() => handleDeleteStage(stage)}
                                className="text-red-400 hover:text-red-300 opacity-0 group-hover:opacity-100 transition"
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
