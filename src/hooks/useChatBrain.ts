// حالة وواجهة بحث الطلاب داخل المحادثة (اقتراحات + بطاقة الطالب)
// — منفصل عن lib/chatBrain (الدوال النقية) و SmartChatBot (العرض)
import { useCallback, useState } from 'react';
import type { Student } from '../types/student';
import {
  scoreStudentMatch,
  computeStudentCard,
  type ChatScope,
  type StudentQuickCard,
} from '../lib/chatBrain';

interface UseChatBrainParams {
  scope: ChatScope;
}

export function useChatBrain({ scope }: UseChatBrainParams) {
  const [studentSearchQuery, setStudentSearchQuery] = useState('');
  const [studentSuggestions, setStudentSuggestions] = useState<Student[]>([]);
  const [selectedStudentCard, setSelectedStudentCard] = useState<StudentQuickCard | null>(null);
  const [showStudentCard, setShowStudentCard] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const handleStudentSearch = useCallback((query: string) => {
    setStudentSearchQuery(query);
    setShowStudentCard(false);
    setSelectedStudentCard(null);

    if (query.trim().length < 2) {
      setStudentSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    const q = query.trim().toLowerCase();
    const matches = scope.students
      .map(s => ({ s, score: scoreStudentMatch(q, s) }))
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 15)
      .map(x => x.s);

    setStudentSuggestions(matches);
    setShowSuggestions(matches.length > 0);
  }, [scope]);

  const handleSelectStudent = useCallback((student: Student) => {
    const card = computeStudentCard(student, scope);
    setSelectedStudentCard(card);
    setShowStudentCard(true);
    setShowSuggestions(false);
    setStudentSearchQuery(student.name);
  }, [scope]);

  /** مسح البحث + الاقتراحات + البطاقة معاً (زر المسح وإغلاق البطاقة) */
  const clearStudentSearch = useCallback(() => {
    setStudentSearchQuery('');
    setStudentSuggestions([]);
    setShowSuggestions(false);
    setShowStudentCard(false);
    setSelectedStudentCard(null);
  }, []);

  return {
    studentSearchQuery,
    studentSuggestions,
    selectedStudentCard,
    showStudentCard,
    showSuggestions,
    setStudentSearchQuery,
    setShowSuggestions,
    handleStudentSearch,
    handleSelectStudent,
    clearStudentSearch,
  };
}
