import { AuthForm } from "@/app/(auth)/auth-form";
export const instant = false;

export default async function Login({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
	const { next } = await searchParams;
	return <AuthForm mode="login" redirectTo={next}/>;
}
