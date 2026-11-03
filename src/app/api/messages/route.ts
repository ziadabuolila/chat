import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseSecretKey } from "@/lib/supabase/keys";

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  let originHost = "";
  try { originHost = origin ? new URL(origin).host : ""; } catch { /* rejected below */ }
  if (!originHost || !host || originHost !== host) {
    return NextResponse.json({ error: "طلب غير صالح." }, { status: 403 });
  }
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 5_300_000) return NextResponse.json({ error: "حجم الطلب أكبر من المسموح." }, { status: 413 });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = getSupabaseSecretKey();
  const hashSecret = process.env.ANON_MESSAGE_HASH_SECRET;
  if (!url || !serviceKey || !hashSecret) {
    return NextResponse.json({ error: "لم تكتمل إعدادات الخادم لإرسال الرسائل." }, { status: 503 });
  }

  let username = "", body = "", captchaToken = "", image: File | null = null;
  try {
    if (request.headers.get("content-type")?.includes("multipart/form-data")) {
      const form = await request.formData(); username = String(form.get("username") ?? ""); body = String(form.get("body") ?? ""); captchaToken = String(form.get("turnstileToken") ?? "");
      const candidate = form.get("image"); if (candidate instanceof File && candidate.size) image = candidate;
    } else {
      const rawBody = await request.text();
      if (rawBody.length > 12_000) return NextResponse.json({ error: "حجم الطلب أكبر من المسموح." }, { status: 413 });
      const payload = JSON.parse(rawBody) as { username?: unknown; body?: unknown; turnstileToken?: unknown };
      username = typeof payload.username === "string" ? payload.username : ""; body = typeof payload.body === "string" ? payload.body : ""; captchaToken = typeof payload.turnstileToken === "string" ? payload.turnstileToken : "";
    }
  } catch { return NextResponse.json({ error: "صيغة الطلب غير صحيحة." }, { status: 400 }); }
  username = username.toLowerCase().trim(); body = body.normalize("NFC").trim();
  if (!/^[a-z0-9_]{3,24}$/.test(username) || (body.length < 1 && !image) || body.length > 1000 || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(body)) return NextResponse.json({ error: "اكتب رسالة أو أرفق صورة، وبحد أقصى 1000 حرف." }, { status: 400 });
  if (image && (!/^image\/(jpeg|png|webp|gif)$/.test(image.type) || image.size > 5 * 1024 * 1024)) return NextResponse.json({ error: "اختر صورة JPEG أو PNG أو WebP أو GIF أقل من 5 ميغابايت." }, { status: 400 });

  const captchaSecret = process.env.TURNSTILE_SECRET_KEY;
  if (captchaSecret) {
    if (!captchaToken) return NextResponse.json({ error: "أكمل فحص الحماية ثم أعد المحاولة." }, { status: 400 });
    const verification = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret: captchaSecret, response: captchaToken, remoteip: request.headers.get("x-real-ip") ?? undefined }),
      cache: "no-store",
    });
    const result = await verification.json() as { success?: boolean };
    if (!result.success) return NextResponse.json({ error: "تعذر التحقق من الحماية. أعد المحاولة." }, { status: 400 });
  }

  const supabase = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: profile, error: profileError } = await supabase.from("profiles").select("id, accepts_messages").eq("username", username).maybeSingle();
  if (profileError || !profile?.accepts_messages) return NextResponse.json({ error: "هذه المساحة غير متاحة لاستقبال الرسائل." }, { status: 404 });

  const ip = request.headers.get("x-real-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const fingerprint = createHmac("sha256", hashSecret).update(ip).digest("hex");
  const { data: allowed, error: rateError } = await supabase.rpc("consume_anonymous_message_limit", { p_fingerprint: fingerprint });
  if (rateError || allowed !== true) return NextResponse.json({ error: "وصلت للحد المؤقت لإرسال الرسائل. انتظر قليلًا ثم حاول مجددًا." }, { status: 429 });
  const { data: blocked } = await supabase.from("blocks").select("id").eq("owner_id", profile.id).eq("fingerprint", fingerprint).maybeSingle();
  if (blocked) return NextResponse.json({ error: "لا يمكنك إرسال رسالة إلى هذه المساحة." }, { status: 429 });

  const accessToken = randomBytes(32).toString("base64url");
  const conversationId = randomUUID();
  const senderTokenHash = createHmac("sha256", hashSecret).update(accessToken).digest("hex");
  const { error: conversationError } = await supabase.from("conversations").insert({ id: conversationId, recipient_id: profile.id, sender_token_hash: senderTokenHash });
  if (conversationError) {
    console.error("Conversation insert failed:", conversationError.code, conversationError.message);
    return NextResponse.json({ error: "قاعدة البيانات لم تُحدّث للمحادثات بعد. شغّل ملف 20261103010000_private_conversations.sql في Supabase SQL Editor ثم حاول مجددًا." }, { status: 503 });
  }
  let imagePath: string | null = null;
  if (image) {
    const ext = image.type.split("/")[1].replace("jpeg", "jpg"); imagePath = `${conversationId}/${randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from("message-media").upload(imagePath, image, { contentType: image.type, upsert: false });
    if (error) { await supabase.from("conversations").delete().eq("id", conversationId); return NextResponse.json({ error: "تعذر رفع الصورة. تأكد من تشغيل ترحيل قاعدة البيانات." }, { status: 500 }); }
  }
  const { data: message, error: insertError } = await supabase.from("messages").insert({ recipient_id: profile.id, conversation_id: conversationId, author_side: "sender", body, image_path: imagePath }).select("id").single();
  if (insertError || !message) {
    if (imagePath) await supabase.storage.from("message-media").remove([imagePath]);
    await supabase.from("conversations").delete().eq("id", conversationId);
    return NextResponse.json({ error: "تعذر إرسال الرسالة الآن." }, { status: 500 });
  }
  await supabase.from("message_sender_fingerprints").insert({ message_id: message.id, fingerprint });
  return NextResponse.json({ success: true, conversationId, accessToken }, { status: 201 });
}
