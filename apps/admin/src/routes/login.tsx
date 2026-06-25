import { Button } from "@better-agent/ui/components/button";
import { Input } from "@better-agent/ui/components/input";
import { useMutation } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { setTokens } from "@/utils/auth";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/login")({ component: LoginPage });

type Mode = "signin" | "forgot" | "magic";

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

function BackLink({ onBack }: { onBack: () => void }) {
	return (
		<button
			className="text-center text-muted-foreground text-sm hover:text-foreground"
			onClick={onBack}
			type="button"
		>
			Back to sign in
		</button>
	);
}

function Notice({ onBack, text }: { onBack: () => void; text: string }) {
	return (
		<div className="flex w-full max-w-sm flex-col gap-3">
			<p className="text-sm">{text}</p>
			<BackLink onBack={onBack} />
		</div>
	);
}

function SignInLinks({
	onForgot,
	onMagic,
}: {
	onForgot: () => void;
	onMagic: () => void;
}) {
	return (
		<div className="flex justify-between text-muted-foreground text-sm">
			<button
				className="hover:text-foreground"
				onClick={onForgot}
				type="button"
			>
				Forgot password?
			</button>
			<button className="hover:text-foreground" onClick={onMagic} type="button">
				Email a magic link
			</button>
		</div>
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

function SignInForm({
	onForgot,
	onMagic,
}: {
	onForgot: () => void;
	onMagic: () => void;
}) {
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
			<SignInLinks onForgot={onForgot} onMagic={onMagic} />
		</div>
	);
}

function ForgotForm({ onBack }: { onBack: () => void }) {
	const [email, setEmail] = useState("");
	const request = useMutation(orpc.auth.requestPasswordReset.mutationOptions());
	if (request.isSuccess) {
		return (
			<Notice
				onBack={onBack}
				text="If that email has an account, we sent a reset link."
			/>
		);
	}
	return (
		<div className="flex w-full max-w-sm flex-col gap-4">
			<div>
				<h1 className="font-semibold text-lg">Reset password</h1>
				<p className="text-muted-foreground text-sm">
					We'll email you a link to set a new password.
				</p>
			</div>
			<form
				className="flex flex-col gap-3"
				onSubmit={(event) => {
					event.preventDefault();
					request.mutate({ email });
				}}
			>
				<EmailInput onChange={setEmail} value={email} />
				<Button disabled={request.isPending} type="submit">
					Send reset link
				</Button>
				<BackLink onBack={onBack} />
			</form>
		</div>
	);
}

function MagicForm({ onBack }: { onBack: () => void }) {
	const [email, setEmail] = useState("");
	const request = useMutation(orpc.auth.requestLink.mutationOptions());
	if (request.isSuccess) {
		return (
			<Notice onBack={onBack} text={`Check ${email} for your sign-in link.`} />
		);
	}
	return (
		<div className="flex w-full max-w-sm flex-col gap-4">
			<div>
				<h1 className="font-semibold text-lg">Magic link</h1>
				<p className="text-muted-foreground text-sm">
					We'll email you a one-time sign-in link.
				</p>
			</div>
			<form
				className="flex flex-col gap-3"
				onSubmit={(event) => {
					event.preventDefault();
					request.mutate({ email, audience: "admin" });
				}}
			>
				<EmailInput onChange={setEmail} value={email} />
				<Button disabled={request.isPending} type="submit">
					Send magic link
				</Button>
				<BackLink onBack={onBack} />
			</form>
		</div>
	);
}

function LoginBody({
	mode,
	setMode,
}: {
	mode: Mode;
	setMode: (mode: Mode) => void;
}) {
	if (mode === "forgot") {
		return <ForgotForm onBack={() => setMode("signin")} />;
	}
	if (mode === "magic") {
		return <MagicForm onBack={() => setMode("signin")} />;
	}
	return (
		<SignInForm
			onForgot={() => setMode("forgot")}
			onMagic={() => setMode("magic")}
		/>
	);
}

function LoginPage() {
	const [mode, setMode] = useState<Mode>("signin");
	return (
		<div className="flex flex-1 items-center justify-center p-6">
			<LoginBody mode={mode} setMode={setMode} />
		</div>
	);
}
