import { Button } from "@better-agent/ui/components/button";
import { Input } from "@better-agent/ui/components/input";
import { useMutation } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";

import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/reset-password")({
	validateSearch: (search: Record<string, unknown>) => ({
		token: typeof search.token === "string" ? search.token : "",
	}),
	component: ResetPasswordPage,
});

function CenteredNotice({ text, cta }: { text: string; cta: string }) {
	return (
		<div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
			<p className="text-sm">{text}</p>
			<Button render={<Link to="/login" />}>{cta}</Button>
		</div>
	);
}

function PasswordField({
	label,
	onChange,
	placeholder,
	value,
}: {
	label: string;
	onChange: (value: string) => void;
	placeholder: string;
	value: string;
}) {
	return (
		<Input
			aria-label={label}
			autoComplete="new-password"
			minLength={8}
			onChange={(event) => onChange(event.target.value)}
			placeholder={placeholder}
			required
			type="password"
			value={value}
		/>
	);
}

interface ResetFormViewProps {
	confirm: string;
	error: string | null;
	matchError: string;
	onSubmit: (event: FormEvent) => void;
	password: string;
	pending: boolean;
	setConfirm: (value: string) => void;
	setPassword: (value: string) => void;
}

function ResetFormView(props: ResetFormViewProps) {
	return (
		<div className="flex w-full max-w-sm flex-col gap-4">
			<div>
				<h1 className="font-semibold text-lg">Set a new password</h1>
				<p className="text-muted-foreground text-sm">
					Choose a password with at least 8 characters.
				</p>
			</div>
			<form className="flex flex-col gap-3" onSubmit={props.onSubmit}>
				<PasswordField
					label="New password"
					onChange={props.setPassword}
					placeholder="New password"
					value={props.password}
				/>
				<PasswordField
					label="Confirm new password"
					onChange={props.setConfirm}
					placeholder="Confirm password"
					value={props.confirm}
				/>
				{props.matchError ? (
					<p className="text-destructive text-sm">{props.matchError}</p>
				) : null}
				{props.error ? (
					<p className="text-destructive text-sm">{props.error}</p>
				) : null}
				<Button disabled={props.pending} type="submit">
					Save password
				</Button>
				<Link
					className="text-center text-muted-foreground text-sm hover:text-foreground"
					to="/login"
				>
					Back to sign in
				</Link>
			</form>
		</div>
	);
}

function ResetForm({ token }: { token: string }) {
	const [password, setPassword] = useState("");
	const [confirm, setConfirm] = useState("");
	const [matchError, setMatchError] = useState("");
	const reset = useMutation(orpc.auth.resetPassword.mutationOptions());

	if (reset.isSuccess) {
		return <CenteredNotice cta="Sign in" text="Password updated." />;
	}

	const handleSubmit = (event: FormEvent) => {
		event.preventDefault();
		if (password !== confirm) {
			setMatchError("Passwords do not match.");
			return;
		}
		setMatchError("");
		reset.mutate({ token, password });
	};

	return (
		<ResetFormView
			confirm={confirm}
			error={reset.error?.message ?? null}
			matchError={matchError}
			onSubmit={handleSubmit}
			password={password}
			pending={reset.isPending}
			setConfirm={setConfirm}
			setPassword={setPassword}
		/>
	);
}

function ResetPasswordPage() {
	const { token } = Route.useSearch();
	if (!token) {
		return <CenteredNotice cta="Back to sign in" text="Invalid reset link." />;
	}
	return (
		<div className="flex flex-1 items-center justify-center p-6">
			<ResetForm token={token} />
		</div>
	);
}
