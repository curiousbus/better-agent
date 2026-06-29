import { Button } from "@better-agent/ui/components/button";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@better-agent/ui/components/card";
import { Input } from "@better-agent/ui/components/input";
import { Label } from "@better-agent/ui/components/label";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { login, TOKEN_KEY } from "@/api";

export const Route = createFileRoute("/login")({
	beforeLoad: () => {
		if (localStorage.getItem(TOKEN_KEY)) {
			throw redirect({ to: "/" });
		}
	},
	component: LoginPage,
});

interface LoginFormProps {
	onSuccess: (token: string) => void;
}

function LoginForm({ onSuccess }: LoginFormProps) {
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		setPending(true);
		setError(null);
		login(email, password)
			.then((token) => {
				onSuccess(token);
			})
			.catch((err: unknown) => {
				const message = err instanceof Error ? err.message : "Login failed";
				setError(message);
				setPending(false);
			});
	};

	return (
		<form className="flex flex-col gap-4" onSubmit={handleSubmit}>
			{pending && <div className="authz-progress" />}
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="email">Email</Label>
				<Input
					disabled={pending}
					id="email"
					onChange={(e) => setEmail(e.target.value)}
					placeholder="admin@example.com"
					required
					type="email"
					value={email}
				/>
			</div>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="password">Password</Label>
				<Input
					disabled={pending}
					id="password"
					onChange={(e) => setPassword(e.target.value)}
					placeholder="••••••••"
					required
					type="password"
					value={password}
				/>
			</div>
			{error !== null && <p className="text-destructive text-xs">{error}</p>}
			<Button disabled={pending} type="submit">
				Sign in
			</Button>
		</form>
	);
}

function LoginPage() {
	const navigate = useNavigate();

	const handleSuccess = (token: string) => {
		localStorage.setItem(TOKEN_KEY, token);
		// biome-ignore lint/suspicious/noEmptyBlockStatements: navigation errors are non-recoverable
		navigate({ to: "/" }).catch(() => {});
	};

	return (
		<div className="authz-enter flex min-h-screen items-center justify-center">
			<Card className="w-full max-w-sm">
				<CardHeader>
					<CardTitle>Sign in to authz</CardTitle>
				</CardHeader>
				<CardContent>
					<LoginForm onSuccess={handleSuccess} />
				</CardContent>
			</Card>
		</div>
	);
}
