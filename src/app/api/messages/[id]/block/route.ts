import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseSecretKey } from "@/lib/supabase/keys";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const origin = request.headers.get("origin");
  let originHost = "";
  try { originHost = origin ? new URL(origin).host : ""; } catch { /* rejected below */ }
  if (!originHost || originHost !== (request.headers.get("x-forwarded-host") ?? request.headers.get("host"))) {
    return NextResponse.json({ error: "طلب غير صالح." }, { status: 403 });
  }
  const sessionClient = await createClient();
  const { data: { user } } = await sessionClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "سجّل الدخول أولًا." }, { status: 401 });
  const { id } = await params;
  const { data: ownedMessage } = await sessionClient.from("messages").select("id").eq("id", id).eq("recipient_id", user.id).maybeSingle();
  if (!ownedMessage) return NextResponse.json({ error: "الرسالة غير موجودة." }, { status: 404 });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = getSupabaseSecretKey();
  if (!url || !key) return NextResponse.json({ error: "إعدادات الحماية غير مكتملة." }, { status: 503 });
  const admin = createSupabaseClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: sender } = await admin.from("message_sender_fingerprints").select("fingerprint").eq("message_id", id).maybeSingle();
  if (!sender) return NextResponse.json({ error: "لا تتوفر بصمة مرسل لهذه الرسالة." }, { status: 409 });
  const { error } = await admin.from("blocks").upsert({ owner_id: user.id, fingerprint: sender.fingerprint }, { onConflict: "owner_id,fingerprint" });
  if (error) return NextResponse.json({ error: "تعذر حظر هذا المرسل." }, { status: 500 });
  return NextResponse.json({ success: true });
}
