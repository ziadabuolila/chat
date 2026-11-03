import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { Dashboard } from "./ui";
import { hasSupabasePublicConfig } from "@/lib/supabase/keys";

export const instant = false;

export default async function DashboardPage() {
  await connection();
  if (!hasSupabasePublicConfig()) {
    return <main className="auth-page" dir="rtl"><div className="auth-card"><span className="eyebrow">إعداد مطلوب</span><h1>اربط قاعدة Supabase أولًا</h1><p className="auth-intro">أضف NEXT_PUBLIC_SUPABASE_URL وNEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY إلى .env.local محليًا، أو Environment Variables في Vercel، ثم أعد تشغيل التطبيق.</p></div></main>;
  }
  const supabase = await createClient(); const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("id, username, display_name, bio, avatar_url, accepts_messages, theme").eq("id", user.id).maybeSingle();
  const { data: messages } = await supabase.from("messages").select("id, body, created_at, is_read, is_favorite, is_pinned, conversation_id, author_side, image_path").eq("recipient_id", user.id).eq("author_side", "sender").order("created_at", { ascending: false }).limit(100);
  if (!profile) return <main className="auth-page" dir="rtl"><div className="auth-card"><h1>הפרופיל שלך עוד לא מוכן</h1><p>הפעל את קובץ supabase/schema.sql בפרויקט Supabase ואז רענן את הדף.</p><Link className="button" href="/">חזרה לראשי</Link></div></main>;
  const inbox = messages ?? [];
  return <Dashboard key={inbox.map((message) => `${message.id}:${message.is_read}:${message.is_favorite}:${message.is_pinned}`).join("|")} profile={profile} messages={inbox} />;
}
