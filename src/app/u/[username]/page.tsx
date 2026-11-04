import { notFound } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { PublicProfile } from "./ui";
import { hasSupabasePublicConfig } from "@/lib/supabase/keys";
export const instant = false;

export default async function PublicPage({ params }: { params: Promise<{ username: string }> }) {
  await connection();
  if (!hasSupabasePublicConfig()) {
    return <main className="auth-page" dir="rtl"><div className="auth-card"><span className="eyebrow">إعداد مطلوب</span><h1>الملف العام يحتاج قاعدة بيانات</h1><p className="auth-intro">أضف بيانات اتصال Supabase إلى متغيرات البيئة، ثم أعد تشغيل التطبيق.</p></div></main>;
  }
  const { username } = await params; const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data } = await supabase.from("profiles").select("username, display_name, bio, avatar_url, accepts_messages, theme").eq("username", username.toLowerCase()).maybeSingle();
  if (!data) notFound();
  return <PublicProfile profile={data} isAuthenticated={Boolean(user)}/>;
}
