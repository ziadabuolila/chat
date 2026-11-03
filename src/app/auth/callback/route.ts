import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getSupabasePublishableKey } from "@/lib/supabase/keys";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  if (code) {
    const response = NextResponse.redirect(new URL("/dashboard", request.url));
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      getSupabasePublishableKey(),
      { cookies: { getAll: () => request.cookies.getAll(), setAll: (items) => items.forEach(({ name, value, options }) => response.cookies.set(name, value, options)) } },
    );
    await supabase.auth.exchangeCodeForSession(code);
    return response;
  }
  return NextResponse.redirect(new URL("/login?error=auth", request.url));
}
