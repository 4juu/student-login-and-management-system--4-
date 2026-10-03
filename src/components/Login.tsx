import React, { useState, useEffect } from 'react';
import { Mail, Lock, Eye, EyeOff, GraduationCap, LogIn, ShieldCheck } from 'lucide-react';
import { MorphingSquare } from './MorphingSquare';
import { loadSystemTitle } from '../firebase/dataService';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Button } from './ui/button';

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

    const trimmedEmail = email.trim();

    if (!trimmedEmail || !password.trim()) {
      setError("الرجاء إدخال البريد الإلكتروني وكلمة المرور");
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setError("صيغة البريد الإلكتروني غير صحيحة");
      return;
    }

    setIsLoading(true);
    try {
      await onLogin(trimmedEmail, password);
    } catch (err: any) {
      setError(err.message || "حدث خطأ أثناء تسجيل الدخول");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen w-full flex flex-col items-center justify-center overflow-hidden p-4" dir="rtl">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -top-32 end-[-8%] h-[420px] w-[420px] rounded-full bg-blue-600/15 blur-[110px]" />
        <div className="absolute -bottom-40 start-[-12%] h-[460px] w-[460px] rounded-full bg-indigo-600/12 blur-[120px]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_20%,rgba(2,6,23,0.55)_100%)]" />
      </div>

      <main className="relative w-full max-w-md animate-fadeUp">
        <section className="glass-card relative overflow-hidden p-6 text-center sm:p-8" aria-labelledby="login-title">
          <div aria-hidden="true" className="absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-blue-400/70 to-transparent" />

          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-blue-400/30 bg-gradient-to-br from-blue-900/80 to-[#0F1A30] shadow-lg shadow-blue-950/50 ring-1 ring-inset ring-white/5">
            <GraduationCap className="h-8 w-8 text-blue-300" aria-hidden="true" />
          </div>

          <h1 id="login-title" className="text-xl font-semibold leading-snug text-white sm:text-2xl">
            {systemTitle}
          </h1>
          <p className="mb-7 mt-1.5 text-sm text-slate-400">سجّل دخولك للوصول إلى لوحة النظام</p>

          <form onSubmit={handleSubmit} className="space-y-4 text-right" noValidate aria-busy={isLoading}>
            <div>
              <Label htmlFor="login-email" className="mb-1.5 block text-sm font-medium text-slate-300">
                البريد الإلكتروني
              </Label>
              <div className="relative">
                <Mail className="pointer-events-none absolute end-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                <Input
                  id="login-email"
                  type="email"
                  placeholder="example@university.edu"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={isLoading}
                  className="glass-input pe-10"
                  autoComplete="email"
                  autoFocus
                />
              </div>
            </div>

            <div>
              <Label htmlFor="login-password" className="mb-1.5 block text-sm font-medium text-slate-300">
                كلمة المرور
              </Label>
              <div className="relative">
                <Lock className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                <Input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isLoading}
                  className="glass-input ps-10 pe-10"
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute end-3 top-1/2 -translate-y-1/2 cursor-pointer text-slate-400 transition-colors duration-200 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/70 rounded"
                  tabIndex={-1}
                  aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div aria-live="polite">
              {error && (
                <div role="alert" className="animate-fadeUp rounded-lg border border-red-500/30 bg-red-500/15 p-3 text-sm text-red-300">
                  {error}
                </div>
              )}
            </div>

            <Button type="submit" disabled={isLoading} className="btn-base btn-primary w-full py-2.5">
              {isLoading ? (
                <>
                  <MorphingSquare size="sm" />
                  <span className="sr-only">جارٍ تسجيل الدخول...</span>
                </>
              ) : (
                <>
                  <LogIn className="h-4 w-4" aria-hidden="true" />
                  تسجيل الدخول
                </>
              )}
            </Button>
          </form>
        </section>

        <footer className="mt-6 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center text-sm text-slate-400">
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
            اتصال آمن
          </span>
          <span aria-hidden="true">·</span>
          <span>© {new Date().getFullYear()} {systemTitle}</span>
        </footer>
      </main>
    </div>
  );
};

export default Login;
