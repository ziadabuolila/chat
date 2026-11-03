import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "سجّل الدخول لاستكشاف الحسابات." }, { status: 401 });
  const parsedOffset = Number(request.nextUrl.searchParams.get("offset") ?? 0);
  const offset = Number.isInteger(parsedOffset) && parsedOffset >= 0 && parsedOffset <= 100_000 ? parsedOffset : 0;
  const term = (request.nextUrl.searchParams.get("q") ?? "").replace(/[^\p{L}\p{N}_ -]/gu, "").trim().slice(0, 40);
  let query = supabase.from("profiles").select("id,username,display_name,bio,avatar_url,created_at")
    .eq("accepts_messages", true).neq("id", user.id);
  if (term) query = query.or(`username.ilike.%${term}%,display_name.ilike.%${term}%`);
  const { data, error } = await query.order("created_at", { ascending: false }).range(offset, offset + 60);
  if (error) return NextResponse.json({ error: "تعذر تحميل الحسابات." }, { status: 500 });
  const hasMore = (data?.length ?? 0) > 60;
  return NextResponse.json({ profiles: (data ?? []).slice(0, 60), hasMore });
}
