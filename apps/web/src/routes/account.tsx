import { Button } from "@better-agent/ui/components/button";
import { Input } from "@better-agent/ui/components/input";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { clearTokens, loadRefreshToken } from "@/utils/auth";
import { client, orpc } from "@/utils/orpc";

export const Route = createFileRoute("/account")({ component: AccountPage });

const SEC = 1000;
const MINUTE = 60;
const HOUR = 3600;
const DAY = 86_400;
const WEEK = 604_800;
const MONTH = 2_592_000;
const YEAR = 31_536_000;

function relativeTime(date: Date): string {
	const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
	const diffSec = Math.round((date.getTime() - Date.now()) / SEC);
	const abs = Math.abs(diffSec);
	if (abs < MINUTE) {
		return rtf.format(diffSec, "second");
	}
	if (abs < HOUR) {
		return rtf.format(Math.round(diffSec / MINUTE), "minute");
	}
	if (abs < DAY) {
		return rtf.format(Math.round(diffSec / HOUR), "hour");
	}
	if (abs < WEEK) {
		return rtf.format(Math.round(diffSec / DAY), "day");
	}
	if (abs < MONTH) {
		return rtf.format(Math.round(diffSec / WEEK), "week");
	}
	if (abs < YEAR) {
		return rtf.format(Math.round(diffSec / MONTH), "month");
	}
	return rtf.format(Math.round(diffSec / YEAR), "year");
}

interface Login {
	createdAt: Date;
	current: boolean;
	id: string;
	label: string;
}

interface SessionRowProps {
	login: Login;
	onRevoke: (id: string) => void;
}

function SessionRow({ login, onRevoke }: SessionRowProps) {
	return (
		<div
			className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 hover:bg-accent"
			key={login.id}
		>
			<div className="min-w-0">
				<div className="truncate text-sm">
					{login.label}
					{login.current ? " · this device" : ""}
				</div>
				<div className="text-muted-foreground text-xs">
					last active {relativeTime(new Date(login.createdAt))}
				</div>
			</div>
			{login.current ? (
				<span className="text-muted-foreground text-xs">current</span>
			) : (
				<Button onClick={() => onRevoke(login.id)} size="sm" variant="ghost">
					Sign out
				</Button>
			)}
		</div>
	);
}

interface PasswordSectionProps {
	hasPassword: boolean;
	onSaved: () => void;
}

function PasswordSection({ hasPassword, onSaved }: PasswordSectionProps) {
	const [password, setPassword] = useState("");
	const setPasswordMutation = useMutation({
		...orpc.account.setPassword.mutationOptions(),
		onSuccess: () => {
			toast.success(hasPassword ? "Password updated." : "Password set.");
			setPassword("");
			onSaved();
		},
	});

	const handleSubmit = (event: React.FormEvent) => {
		event.preventDefault();
		setPasswordMutation.mutate({ password });
	};

	return (
		<div className="flex flex-col gap-2">
			<div className="text-muted-foreground text-sm">
				{hasPassword ? "Change password" : "Set a password"}
			</div>
			<form className="flex flex-col gap-2" onSubmit={handleSubmit}>
				<Input
					aria-label="New password"
					autoComplete="new-password"
					minLength={8}
					onChange={(e) => setPassword(e.target.value)}
					placeholder="New password"
					required
					type="password"
					value={password}
				/>
				{setPasswordMutation.error ? (
					<p className="text-destructive text-sm">
						{setPasswordMutation.error.message}
					</p>
				) : null}
				<div>
					<Button
						disabled={setPasswordMutation.isPending}
						size="sm"
						type="submit"
					>
						Save
					</Button>
				</div>
			</form>
		</div>
	);
}

function useAccountPage() {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const currentRefreshToken = loadRefreshToken() ?? "";
	const meQuery = useQuery(orpc.auth.me.queryOptions());
	const loginsQuery = useQuery(
		orpc.account.listLogins.queryOptions({ input: { currentRefreshToken } })
	);
	const invalidateLogins = () =>
		queryClient.invalidateQueries({ queryKey: orpc.account.listLogins.key() });
	const invalidateMe = () =>
		queryClient.invalidateQueries({ queryKey: orpc.auth.me.key() });
	const revokeLogin = useMutation({
		...orpc.account.revokeLogin.mutationOptions(),
		onSuccess: invalidateLogins,
	});
	const revokeOthers = useMutation({
		...orpc.account.revokeOthers.mutationOptions(),
		onSuccess: invalidateLogins,
	});
	const signOut = async () => {
		if (currentRefreshToken) {
			await client.auth.logout({ refreshToken: currentRefreshToken });
		}
		clearTokens();
		navigate({ to: "/login" });
	};
	return {
		currentRefreshToken,
		email: meQuery.data?.email,
		hasPassword: meQuery.data?.hasPassword ?? false,
		invalidateMe,
		logins: loginsQuery.data ?? [],
		revokeLogin,
		revokeOthers,
		signOut,
	};
}

function AccountPage() {
	const {
		currentRefreshToken,
		email,
		hasPassword,
		invalidateMe,
		logins,
		revokeLogin,
		revokeOthers,
		signOut,
	} = useAccountPage();
	return (
		<div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 overflow-auto p-4 sm:p-6">
			<div>
				<div className="text-muted-foreground text-sm">Signed in as</div>
				<div className="font-medium">{email}</div>
			</div>
			<PasswordSection hasPassword={hasPassword} onSaved={invalidateMe} />
			<div className="flex flex-col gap-2">
				<div className="text-muted-foreground text-sm">Active sessions</div>
				{logins.map((s) => (
					<SessionRow
						key={s.id}
						login={s}
						onRevoke={(id) => revokeLogin.mutate({ id })}
					/>
				))}
			</div>
			<div className="flex gap-2">
				<Button
					onClick={() => revokeOthers.mutate({ currentRefreshToken })}
					variant="outline"
				>
					Sign out other devices
				</Button>
				<Button onClick={signOut} variant="default">
					Sign out
				</Button>
			</div>
		</div>
	);
}
