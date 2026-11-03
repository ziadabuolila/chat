import { createHmac } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseSecretKey } from "@/lib/supabase/keys";

type Context = { params: Promise<{ id: string }> };
async function access(request: NextRequest, id: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = getSupabaseSecretKey();
  const secret = process.env.ANON_MESSAGE_HASH_SECRET;
  if (!url || !key || !secret) return { error: NextResponse.json({ error: "إعدادات الخادم غير مكتملة." }, { status: 503 }) };
  const admin = createSupabaseClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: conversation } = await admin.from("conversations").select("id,recipient_id,sender_token_hash").eq("id", id).maybeSingle();
  if (!conversation) return { error: NextResponse.json({ error: "المحادثة غير موجودة." }, { status: 404 }) };
  const userClient = await createClient();
  const { data: { user } } = await userClient.auth.getUser();
  if (user?.id === conversation.recipient_id) return { admin, conversation, side: "recipient" as const };
  const token = request.headers.get("x-conversation-token") || "";
  const supplied = createHmac("sha256", secret).update(token).digest("hex");
  if (token && supplied === conversation.sender_token_hash) return { admin, conversation, side: "sender" as const };
  return { error: NextResponse.json({ error: "لا تملك صلاحية هذه المحادثة على هذا الجهاز." }, { status: 403 }) };
}

export async function GET(request: NextRequest, { params }: Context) {
  const { id } = await params;
  const result = await access(request, id);
  if ("error" in result) return result.error;
  const { data, error } = await result.admin.from("messages").select("id,body,author_side,image_path,created_at").eq("conversation_id", id).order("created_at");
  if (error) return NextResponse.json({ error: "تعذر تحميل المحادثة." }, { status: 500 });
  const messages = await Promise.all((data ?? []).map(async (message) => {
    if (!message.image_path) return message;
    const { data: signed } = await result.admin.storage.from("message-media").createSignedUrl(message.image_path, 120);
    return { ...message, image_url: signed?.signedUrl ?? null };
  }));
  return NextResponse.json({ messages, side: result.side });
}

export async function POST(request: NextRequest, { params }: Context) {
  if (Number(request.headers.get("content-length") ?? 0) > 5_300_000) return NextResponse.json({ error: "حجم الطلب أكبر من المسموح." }, { status: 413 });
  const { id } = await params;
  const result = await access(request, id);
  if ("error" in result) return result.error;
  if (result.side === "sender") {
    const token = request.headers.get("x-conversation-token") || "";
    const fingerprint = createHmac("sha256", process.env.ANON_MESSAGE_HASH_SECRET!).update(token).digest("hex");
    const { data: allowed, error } = await result.admin.rpc("consume_anonymous_message_limit", { p_fingerprint: fingerprint });
    if (error || allowed !== true) return NextResponse.json({ error: "وصلت للحد المؤقت للردود. انتظر قليلًا ثم حاول مجددًا." }, { status: 429 });
  }
  let text = "", image: File | null = null;
  try {
    if (request.headers.get("content-type")?.includes("multipart/form-data")) {
      const form = await request.formData(); text = String(form.get("body") ?? ""); const candidate = form.get("image"); if (candidate instanceof File && candidate.size) image = candidate;
    } else { text = String(((await request.json()) as { body?: unknown }).body ?? ""); }
  } catch { return NextResponse.json({ error: "صيغة الطلب غير صحيحة." }, { status: 400 }); }
  text = text.trim();
  if ((text.length < 1 && !image) || text.length > 1000 || (image && (!/^image\/(jpeg|png|webp|gif)$/.test(image.type) || image.size > 5 * 1024 * 1024))) return NextResponse.json({ error: "اكتب ردًا أو أرفق صورة (حتى 5 ميغابايت)." }, { status: 400 });
  const messageId = crypto.randomUUID();
  let imagePath: string | null = null;
  if (image) {
    const ext = image.type.split("/")[1].replace("jpeg", "jpg"); imagePath = `${id}/${crypto.randomUUID()}.${ext}`;
    const { error: uploadError } = await result.admin.storage.from("message-media").upload(imagePath, image, { contentType: image.type, upsert: false });
    if (uploadError) return NextResponse.json({ error: "تعذر رفع الصورة." }, { status: 500 });
  }
  const { data, error } = await result.admin.from("messages").insert({ id: messageId, recipient_id: result.conversation.recipient_id, conversation_id: id, author_side: result.side, body: text, image_path: imagePath }).select("id").single();
  if (error && imagePath) await result.admin.storage.from("message-media").remove([imagePath]);
  if (error) return NextResponse.json({ error: "تعذر إرسال الرد." }, { status: 500 });
  return NextResponse.json({ success: true, id: data.id }, { status: 201 });
}

export async function PATCH(request: NextRequest, { params }: Context) {
  const { id } = await params;
  const result = await access(request, id);
  if ("error" in result) return result.error;
  let payload: { messageId?: unknown; body?: unknown };
  try { payload = await request.json(); } catch { return NextResponse.json({ error: "صيغة الطلب غير صحيحة." }, { status: 400 }); }
  const text = typeof payload.body === "string" ? payload.body.trim() : "";
  if (typeof payload.messageId !== "string" || text.length < 1 || text.length > 1000) return NextResponse.json({ error: "نص الرسالة غير صالح." }, { status: 400 });
  const { data: message } = await result.admin.from("messages").select("id,author_side,image_path").eq("id", payload.messageId).eq("conversation_id", id).maybeSingle();
  if (!message || message.author_side !== result.side || message.image_path) return NextResponse.json({ error: "يمكن تعديل رسائلك النصية فقط." }, { status: 403 });
  const { error } = await result.admin.from("messages").update({ body: text }).eq("id", message.id);
  return error ? NextResponse.json({ error: "تعذر تعديل الرسالة." }, { status: 500 }) : NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest, { params }: Context) {
  const { id } = await params;
  const result = await access(request, id);
  if ("error" in result) return result.error;
  const messageId = request.nextUrl.searchParams.get("messageId");
  if (!messageId) return NextResponse.json({ error: "الرسالة غير محددة." }, { status: 400 });
  const { data: message } = await result.admin.from("messages").select("id,author_side,image_path").eq("id", messageId).eq("conversation_id", id).maybeSingle();
  if (!message || message.author_side !== result.side || message.image_path) return NextResponse.json({ error: "يمكن حذف رسائلك النصية فقط." }, { status: 403 });
  const { error } = await result.admin.from("messages").delete().eq("id", message.id);
  return error ? NextResponse.json({ error: "تعذر حذف الرسالة." }, { status: 500 }) : NextResponse.json({ success: true });
}
