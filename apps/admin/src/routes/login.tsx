import { Button } from "@better-agent/ui/components/button";
import { Input } from "@better-agent/ui/components/input";
import { useMutation } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { setTokens } from "@/utils/auth";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/login")({ component: LoginPage });

const PASSWORD_MIN = 8;

function EmailInput({
	onChange,
	value,
}: {
	onChange: (value: string) => void;
	value: string;
}) {
	return (
		<Input
			aria-label="Email address"
			autoComplete="email"
			onChange={(event) => onChange(event.target.value)}
			placeholder="you@example.com"
			required
			type="email"
			value={value}
		/>
	);
}

function useSignIn() {
	const navigate = useNavigate();
	return useMutation({
		...orpc.auth.loginWithPassword.mutationOptions(),
		onSuccess: (result) => {
			setTokens(result);
			navigate({ to: "/" });
		},
	});
}

function SignInForm() {
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const login = useSignIn();
	return (
		<div className="flex w-full max-w-sm flex-col gap-4">
			<div>
				<h1 className="font-semibold text-lg">Admin sign in</h1>
				<p className="text-muted-foreground text-sm">
					Sign in with your email and password.
				</p>
			</div>
			<form
				className="flex flex-col gap-3"
				onSubmit={(event) => {
					event.preventDefault();
					login.mutate({ email, password });
				}}
			>
				<EmailInput onChange={setEmail} value={email} />
				<Input
					aria-label="Password"
					autoComplete="current-password"
					minLength={PASSWORD_MIN}
					onChange={(event) => setPassword(event.target.value)}
					placeholder="Password"
					required
					type="password"
					value={password}
				/>
				{login.error ? (
					<p className="text-destructive text-sm">{login.error.message}</p>
				) : null}
				<Button disabled={login.isPending} type="submit">
					Sign in
				</Button>
			</form>
		</div>
	);
}

function LoginPage() {
	return (
		<div className="flex flex-1 items-center justify-center p-6">
			<SignInForm />
		</div>
	);
}
