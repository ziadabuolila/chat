import { AuthForm } from "@/app/(auth)/auth-form";
export const instant = false;

export default async function Signup({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
	const { next } = await searchParams;
	return <AuthForm mode="signup" redirectTo={next}/>;
}
