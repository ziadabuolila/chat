import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "صارح — صارح صديقك بدون ما يعرفك",
  description: "أنشئ رابطك واستقبل رسائل مجهولة. اسمك المسجّل وبيانات حسابك الخاصة لا تظهر لمستقبل الرسالة.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ar" dir="rtl" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
