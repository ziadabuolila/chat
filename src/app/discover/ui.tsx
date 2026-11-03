"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

type Profile = { id: string; username: string; display_name: string | null; bio: string | null; avatar_url: string | null; created_at: string };
export function Directory({ initialProfiles, initialError, initialOffset }: { initialProfiles: Profile[]; initialError: string; initialOffset: number }) {
  const [profiles, setProfiles] = useState(initialProfiles);
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [offset, setOffset] = useState(initialOffset);
  const [hasMore, setHasMore] = useState(initialProfiles.length === 60);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError);
  const filtered = profiles;

  async function searchAccounts(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    const term = query.trim();
    try {
      const response = await fetch(`/api/discover?q=${encodeURIComponent(term)}&offset=0`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "تعذر البحث في الحسابات.");
      setProfiles(result.profiles as Profile[]); setOffset(result.profiles.length); setHasMore(Boolean(result.hasMore)); setSubmittedQuery(term);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "تعذر البحث في الحسابات."); }
    finally { setBusy(false); }
  }

  async function loadMore() {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/discover?offset=${offset}&q=${encodeURIComponent(submittedQuery)}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "تعذر تحميل الحسابات.");
      const next = result.profiles as Profile[];
      setProfiles(current => [...current, ...next]);
      setOffset(current => current + next.length);
      setHasMore(Boolean(result.hasMore));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "تعذر تحميل الحسابات."); }
    finally { setBusy(false); }
  }

  return <main className="directory-page" dir="rtl">
    <header className="directory-top"><Link className="brand" href="/"><span className="brand-mark">ص</span> صارح<span className="brand-dot">.</span></Link><Link href="/dashboard" className="directory-back">← لوحة التحكم</Link></header>
    <section className="directory-content">
      <span className="eyebrow">مساحات صارح</span>
      <h1>ابدأ حوارًا صادقًا</h1>
      <p className="directory-intro">اختار حسابًا وابعث رسالة من غير ما يظهر اسمك أو صورتك لصاحب الحساب.</p>
      <form className="directory-search" onSubmit={searchAccounts}><span>⌕</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="ابحث بالاسم أو اسم المستخدم"/><button className="button button-small" disabled={busy}>{busy ? "بحث…" : "بحث"}</button></form>
      <p className="directory-count">{filtered.length} حساب ظاهر{submittedQuery ? " مطابق للبحث" : ""}{hasMore ? " · حمّل المزيد لاستكشاف حسابات أخرى" : ""}</p>
      {initialError && <div className="directory-error" role="alert">{initialError}</div>}
      {!initialError && filtered.length > 0 && <div className="directory-grid">{filtered.map(profile => <article className="directory-card" key={profile.id}>
        <Link href={`/u/${profile.username}`} className="directory-identity" aria-label={`زيارة صفحة ${profile.display_name || profile.username}`}>
          <span className="directory-avatar">{profile.avatar_url ? <Image src={profile.avatar_url} alt="" width={72} height={72} unoptimized/> : (profile.display_name || profile.username).slice(0, 1)}</span>
          <span className="directory-name">{profile.display_name || `@${profile.username}`}</span>
          <span className="directory-username" dir="ltr">@{profile.username}</span>
          {profile.bio && <span className="directory-bio">{profile.bio}</span>}
        </Link>
        <Link className="button button-small directory-start" href={`/u/${profile.username}`}>ابدأ دردشة بدون أن يعرفك <span>↗</span></Link>
      </article>)}</div>}
      {!initialError && filtered.length === 0 && <div className="directory-empty">{submittedQuery ? "مفيش حسابات مطابقة لبحثك." : "لسه مفيش حسابات أخرى تستقبل الرسائل."}</div>}
      {hasMore && <button className="directory-more" onClick={() => void loadMore()} disabled={busy}>{busy ? "جاري تحميل حسابات…" : "تحميل المزيد"}</button>}
      {error && !initialError && <p className="directory-error" role="alert">{error}</p>}
      <p className="directory-privacy">الرسائل التي ترسلها مجهولة، وسجل المحادثة لا يراه سوى طرفيها.</p>
    </section>
  </main>;
}
