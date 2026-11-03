"use client";
import { useState } from "react";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";

export function AvatarUpload({ userId, avatarUrl }: { userId: string; avatarUrl: string | null }) {
  const [status, setStatus] = useState("");
  async function upload(file?: File) {
    if (!file) return;
    if (!(["image/jpeg", "image/png", "image/webp"].includes(file.type)) || file.size > 5 * 1024 * 1024) {
      setStatus("اختر صورة PNG أو JPEG أو WebP بحجم أقل من 5 ميغابايت."); return;
    }
    const client = createClient();
    const ext = file.type === "image/jpeg" ? "jpg" : file.type.split("/")[1];
    const path = `${userId}/${crypto.randomUUID()}.${ext}`;
    const { error: uploadError } = await client.storage.from("avatars").upload(path, file, { contentType: file.type, upsert: false });
    if (uploadError) { setStatus("تعذر رفع الصورة. تحقق من تشغيل مخطط Supabase."); return; }
    const { data } = client.storage.from("avatars").getPublicUrl(path);
    const { error } = await client.from("profiles").update({ avatar_url: data.publicUrl }).eq("id", userId);
    setStatus(error ? "تم رفع الصورة لكن تعذر ربطها بالملف." : "تم تحديث الصورة.");
    if (!error) window.location.reload();
  }
  return <div className="avatar-upload"><label>صورة الملف الشخصي <input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => void upload(e.target.files?.[0])}/></label>{avatarUrl&&<Image src={avatarUrl} alt="صورة الملف الشخصي" width={40} height={40} unoptimized/>}{status&&<small role="status">{status}</small>}</div>;
}
