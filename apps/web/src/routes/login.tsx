import { Button } from "@better-agent/ui/components/button";
import { Input } from "@better-agent/ui/components/input";
import { useMutation } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { GoogleButton } from "@/components/google-button";
import { setTokens } from "@/utils/auth";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/login")({ component: LoginPage });

type Mode = "signin" | "create" | "magic" | "forgot";

interface ModeToggleProps {
	mode: Mode;
	setMode: (m: Mode) => void;
}

function ModeToggle({ mode, setMode }: ModeToggleProps) {
	return (
		<div className="flex gap-4 text-sm">
			<button
				className={
					mode === "signin"
						? "font-semibold"
						: "text-muted-foreground hover:text-foreground"
				}
				onClick={() => setMode("signin")}
				type="button"
			>
				Sign in
			</button>
			<button
				className={
					mode === "create"
						? "font-semibold"
						: "text-muted-foreground hover:text-foreground"
				}
				onClick={() => setMode("create")}
				type="button"
			>
				Create account
			</button>
		</div>
	);
}

function usePasswordForm(mode: "signin" | "create") {
	const navigate = useNavigate();
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const onSuccess = (result: { accessToken: string; refreshToken: string }) => {
		setTokens(result);
		navigate({ to: "/" });
	};
	const login = useMutation({
		...orpc.auth.loginWithPassword.mutationOptions(),
		onSuccess,
	});
	const register = useMutation({
		...orpc.auth.registerWithPassword.mutationOptions(),
		onSuccess,
	});
	const mutation = mode === "signin" ? login : register;
	const submit = (event: React.FormEvent) => {
		event.preventDefault();
		mutation.mutate({ email, password });
	};
	return {
		email,
		error: mutation.error,
		isPending: login.isPending || register.isPending,
		password,
		setEmail,
		setPassword,
		submit,
	};
}

interface PasswordFormProps {
	mode: "signin" | "create";
	onForgot: () => void;
	onSwitchToMagic: () => void;
}

function PasswordForm({ mode, onForgot, onSwitchToMagic }: PasswordFormProps) {
	const { email, error, isPending, password, setEmail, setPassword, submit } =
		usePasswordForm(mode);
	return (
		<form className="flex flex-col gap-3" onSubmit={submit}>
			<Input
				aria-label="Email address"
				autoComplete="email"
				onChange={(e) => setEmail(e.target.value)}
				placeholder="you@example.com"
				required
				type="email"
				value={email}
			/>
			<Input
				aria-label="Password"
				autoComplete={mode === "signin" ? "current-password" : "new-password"}
				minLength={8}
				onChange={(e) => setPassword(e.target.value)}
				placeholder="Password"
				required
				type="password"
				value={password}
			/>
			{error ? (
				<p className="text-destructive text-sm">{error.message}</p>
			) : null}
			<Button disabled={isPending} type="submit">
				{mode === "signin" ? "Sign in" : "Create account"}
			</Button>
			<button
				className="text-muted-foreground text-sm hover:text-foreground"
				onClick={onSwitchToMagic}
				type="button"
			>
				Email me a magic link instead
			</button>
			{mode === "signin" ? (
				<button
					className="text-muted-foreground text-sm hover:text-foreground"
					onClick={onForgot}
					type="button"
				>
					Forgot password?
				</button>
			) : null}
		</form>
	);
}

interface ForgotFormProps {
	onBack: () => void;
}

function ForgotForm({ onBack }: ForgotFormProps) {
	const [email, setEmail] = useState("");
	const request = useMutation(orpc.auth.requestPasswordReset.mutationOptions());

	if (request.isSuccess) {
		return (
			<div className="flex flex-col gap-3">
				<p className="text-sm">
					If that email has an account, we sent a reset link.
				</p>
				<button
					className="self-start text-muted-foreground text-sm hover:text-foreground"
					onClick={onBack}
					type="button"
				>
					Back to sign in
				</button>
			</div>
		);
	}

	const handleSubmit = (event: React.FormEvent) => {
		event.preventDefault();
		request.mutate({ email });
	};

	return (
		<form className="flex flex-col gap-3" onSubmit={handleSubmit}>
			<Input
				aria-label="Email address"
				autoComplete="email"
				onChange={(event) => setEmail(event.target.value)}
				placeholder="you@example.com"
				required
				type="email"
				value={email}
			/>
			{request.error ? (
				<p className="text-destructive text-sm">{request.error.message}</p>
			) : null}
			<Button disabled={request.isPending} type="submit">
				Send reset link
			</Button>
			<button
				className="text-muted-foreground text-sm hover:text-foreground"
				onClick={onBack}
				type="button"
			>
				Back to sign in
			</button>
		</form>
	);
}

interface MagicLinkFormProps {
	onBack: () => void;
}

function MagicLinkForm({ onBack }: MagicLinkFormProps) {
	const [email, setEmail] = useState("");
	const request = useMutation(orpc.auth.requestLink.mutationOptions());

	if (request.isSuccess) {
		return (
			<p className="text-sm">
				Check <span className="font-medium">{email}</span> for your sign-in
				link.
			</p>
		);
	}

	return (
		<form
			className="flex flex-col gap-3"
			onSubmit={(event) => {
				event.preventDefault();
				request.mutate({ email });
			}}
		>
			<Input
				aria-label="Email address"
				autoComplete="email"
				onChange={(event) => setEmail(event.target.value)}
				placeholder="you@example.com"
				required
				type="email"
				value={email}
			/>
			{request.error ? (
				<p className="text-destructive text-sm">{request.error.message}</p>
			) : null}
			<Button disabled={request.isPending} type="submit">
				Send login link
			</Button>
			<button
				className="text-muted-foreground text-sm hover:text-foreground"
				onClick={onBack}
				type="button"
			>
				Back to sign in
			</button>
		</form>
	);
}

const HEADINGS: Record<Mode, string> = {
	create: "Sign in",
	forgot: "Reset your password",
	magic: "Sign in with email",
	signin: "Sign in",
};

const SUBTITLES: Record<Mode, string> = {
	create: "Use your email and password.",
	forgot: "Enter your email and we'll send a reset link.",
	magic: "We'll email you a magic link.",
	signin: "Use your email and password.",
};

interface LoginFormBodyProps {
	mode: Mode;
	setMode: (m: Mode) => void;
}

function LoginFormBody({ mode, setMode }: LoginFormBodyProps) {
	if (mode === "magic") {
		return <MagicLinkForm onBack={() => setMode("signin")} />;
	}
	if (mode === "forgot") {
		return <ForgotForm onBack={() => setMode("signin")} />;
	}
	return (
		<>
			<PasswordForm
				mode={mode}
				onForgot={() => setMode("forgot")}
				onSwitchToMagic={() => setMode("magic")}
			/>
			<GoogleButton />
		</>
	);
}

function LoginPage() {
	const [mode, setMode] = useState<Mode>("signin");
	const showToggle = mode === "signin" || mode === "create";
	return (
		<div className="flex flex-1 items-center justify-center p-6">
			<div className="flex w-full max-w-sm flex-col gap-4">
				<div>
					<h1 className="font-semibold text-lg">{HEADINGS[mode]}</h1>
					<p className="text-muted-foreground text-sm">{SUBTITLES[mode]}</p>
				</div>
				{showToggle ? <ModeToggle mode={mode} setMode={setMode} /> : null}
				<LoginFormBody mode={mode} setMode={setMode} />
			</div>
		</div>
	);
}
