import { redirect } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { hasSupabasePublicConfig } from "@/lib/supabase/keys";
import { Directory } from "./ui";

export const instant = false;

export default async function DiscoverPage() {
  await connection();
  if (!hasSupabasePublicConfig()) redirect("/login");
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=%2Fdiscover");
  const { data, error } = await supabase.from("profiles")
    .select("id,username,display_name,bio,avatar_url,created_at")
    .eq("accepts_messages", true).neq("id", user.id)
    .order("created_at", { ascending: false }).range(0, 59);
  return <Directory initialProfiles={data ?? []} initialError={error ? "تعذر تحميل الحسابات. تأكد من تشغيل مخطط Supabase." : ""} initialOffset={data?.length ?? 0} />;
}
