"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function MessageActions({ id, body, ownerId, isRead, isFavorite, canDelete = true, onUpdate, onDelete }: {
  id: string; body: string; ownerId: string; isRead: boolean; isFavorite: boolean;
  canDelete?: boolean;
  onUpdate: (patch: { is_read?: boolean; is_favorite?: boolean }) => void;
  onDelete: () => void;
}) {
  const [message, setMessage] = useState("");
  async function report() {
    const { error } = await createClient().from("reports").insert({ message_id: id, reporter_id: ownerId, reason: "محتوى مسيء أو غير مناسب" });
    setMessage(error ? "تعذر إرسال البلاغ" : "تم إرسال البلاغ");
  }
  async function block() {
    if (!window.confirm("حظر هذا المرسل سيمنعه من إرسال رسائل أخرى من نفس بصمة الشبكة. متأكد؟")) return;
    const response = await fetch(`/api/messages/${id}/block`, { method: "POST" });
    setMessage(response.ok ? "تم حظر المرسل" : "تعذر حظر المرسل");
  }
  return <>
    <button onClick={() => onUpdate({ is_read: !isRead })}>{isRead ? "◉ تحديد كغير مقروءة" : "◉ تحديد كمقروءة"}</button>
    <button onClick={() => onUpdate({ is_favorite: !isFavorite })}>{isFavorite ? "★ إزالة من المفضلة" : "☆ حفظ"}</button>
    <button onClick={() => navigator.clipboard.writeText(body)}>▢ نسخ</button>
    <button onClick={report}>⚑ إبلاغ</button>
    <button onClick={block}>⊘ حظر المرسل</button>
    {canDelete&&<button className="danger-link" onClick={onDelete}>⌫ حذف</button>}
    {message && <span role="status">{message}</span>}
  </>;
}
