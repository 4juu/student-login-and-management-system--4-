import React, { useState, useEffect } from 'react';
import { Mail, Lock, Eye, EyeOff, GraduationCap, LogIn } from 'lucide-react';
import { loadSystemTitle } from '../firebase/dataService';

interface LoginProps {
  onLogin: (email: string, password: string) => Promise<void>;
}

export const Login: React.FC<LoginProps> = ({ onLogin }) => {
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [systemTitle, setSystemTitle] = useState("نظام إدارة الحضور الجامعي");

  useEffect(() => {
    loadSystemTitle().then(title => {
      if (title) setSystemTitle(title);
    });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!email.trim() || !password.trim()) {
      setError("الرجاء إدخال البريد الإلكتروني وكلمة المرور");
      return;
    }

    setIsLoading(true);
    try {
      await onLogin(email.trim(), password);
    } catch (err: any) {
      setError(err.message || "حدث خطأ أثناء تسجيل الدخول");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center p-4" dir="rtl">
      <div className="w-full max-w-md">
        <div className="glass-card p-6 sm:p-8 text-center animate-fadeUp">
          <div className="mx-auto w-16 h-16 rounded-full border-2 border-blue-600/40 bg-gradient-to-br from-blue-950 to-[#0F1A30] flex items-center justify-center shadow-lg shadow-blue-950/40 mb-4">
            <GraduationCap className="w-8 h-8 text-blue-400" />
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-white mb-1 leading-snug">{systemTitle}</h1>
          <p className="text-slate-400 text-sm mb-6">سجّل دخولك للوصول إلى لوحة النظام</p>

          <form onSubmit={handleSubmit} className="space-y-4 text-right">
            <div className="relative">
              <Mail className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                type="email"
                placeholder="البريد الإلكتروني"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={isLoading}
                className="glass-input pr-10"
              />
            </div>

            <div className="relative">
              <Lock className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder="كلمة المرور"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isLoading}
                className="glass-input pr-10 pl-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white transition-colors"
                tabIndex={-1}
                aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>

            {error && (
              <div className="p-3 bg-red-500/15 border border-red-500/30 text-red-300 rounded-lg text-sm">
                {error}
              </div>
            )}

            <button type="submit" disabled={isLoading} className="btn-base btn-primary w-full py-2.5">
              {isLoading ? (
                <span className="w-4 h-4 border-2 border-white/60 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  <LogIn className="w-4 h-4" />
                  تسجيل الدخول
                </>
              )}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-slate-500 text-sm">
          © {new Date().getFullYear()} {systemTitle}
        </p>
      </div>
    </div>
  );
};

export default Login;
