"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { hasSupabasePublicConfig } from "@/lib/supabase/keys";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const [error, setError] = useState(""); const [notice, setNotice] = useState(""); const [busy, setBusy] = useState(false); const router = useRouter();
  const signup = mode === "signup";
  async function submit(formData: FormData) {
    setBusy(true); setError(""); setNotice("");
    if (!hasSupabasePublicConfig()) { setError("أضف إعدادات Supabase إلى .env.local أولًا، ثم أعد تشغيل التطبيق."); setBusy(false); return; }
    const email = String(formData.get("email") || "").trim().toLowerCase(); const password = String(formData.get("password") || "");
    if (signup) {
      const fullName = String(formData.get("fullName") || "").trim(); const username = String(formData.get("username") || "").trim().toLowerCase(); const phone = String(formData.get("phone") || "").trim();
      if (!/^[a-z0-9_]{3,24}$/.test(username)) { setError("اسم المستخدم يجب أن يكون 3 إلى 24 حرفًا إنجليزيًا أو رقمًا أو _"); setBusy(false); return; }
      if (password.length < 8) { setError("كلمة المرور يجب ألا تقل عن 8 أحرف."); setBusy(false); return; }
      const supabase = createClient();
      const { data, error: authError } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: `${location.origin}/auth/callback`, data: { full_name: fullName, phone, username } } });
      if (authError) {
        setError(authError.code === "over_email_send_rate_limit"
          ? "وصل المشروع إلى حد رسائل التأكيد في Supabase. لو أكدت بريدك قبل كده، سجّل الدخول بدل إنشاء حساب جديد. وإلا انتظر حتى يتجدد الحد أو اضبط SMTP مخصصًا."
          : authError.message);
        setBusy(false); return;
      }
      if (data.session) router.push("/dashboard"); else setNotice("تم إنشاء حسابك. تحقق من بريدك الإلكتروني لتأكيد الحساب ثم سجّل الدخول.");
    } else {
      const { error: authError } = await createClient().auth.signInWithPassword({ email, password });
      if (authError) setError("البريد الإلكتروني أو كلمة المرور غير صحيحة."); else router.push("/dashboard");
    }
    router.refresh(); setBusy(false);
  }
  return <main className="auth-page" dir="rtl"><Link className="brand auth-brand" href="/"><span className="brand-mark">ص</span> صارح<span className="brand-dot">.</span></Link><div className="auth-card"><Link className="back-link" href="/">← الرئيسية</Link><div className="auth-icon">{signup ? "✳" : "↗"}</div><span className="eyebrow">{signup ? "ابدأ رحلتك" : "مرحبًا بعودتك"}</span><h1>{signup ? "أنشئ مساحتك" : "سجّل دخولك"}</h1><p className="auth-intro">{signup ? "خطوة بسيطة تفصلك عن استقبال كلام من القلب." : "مساحتك ورسائلك بانتظارك."}</p>
  <form action={submit} className="auth-form">{signup && <><label>الاسم الكامل<input name="fullName" autoComplete="name" required minLength={2} placeholder="اسمك الكامل"/></label><label>اسم المستخدم<div className="input-prefix"><span>@</span><input name="username" autoComplete="username" required minLength={3} maxLength={24} pattern="[A-Za-z0-9_]+" placeholder="username"/></div></label><label>رقم الهاتف <small>اختياري</small><input name="phone" type="tel" autoComplete="tel" placeholder="+20 10..."/></label></>}<label>البريد الإلكتروني<input name="email" type="email" autoComplete="email" required placeholder="you@example.com"/></label><label>كلمة المرور<input name="password" type="password" autoComplete={signup ? "new-password" : "current-password"} required minLength={8} placeholder="8 أحرف على الأقل"/></label>{!signup&&<p className="form-hint"><Link href="/forgot-password">نسيت كلمة المرور؟</Link></p>}{signup && <p className="form-hint">بالتسجيل، أنت توافق على <Link href="/terms">شروط الاستخدام</Link> و<Link href="/privacy">سياسة الخصوصية</Link>.</p>}{error && <p className="form-error" role="alert">{error}</p>}{notice && <p className="form-success">{notice}</p>}<button className="button auth-submit" disabled={busy}>{busy ? "لحظة من فضلك..." : signup ? "إنشاء الحساب ←" : "دخول إلى حسابي ←"}</button></form><div className="auth-switch">{signup ? <>عندك حساب؟ <Link href="/login">سجّل دخولك</Link></> : <>جديد هنا؟ <Link href="/signup">أنشئ حسابك</Link></>}</div></div><small className="auth-foot">مساحتك الآمنة للتعبير بصراحة</small></main>;
}
