import {
	Avatar,
	AvatarFallback,
	AvatarImage,
} from "@better-agent/ui/components/avatar";
import { Badge } from "@better-agent/ui/components/badge";
import { Button } from "@better-agent/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@better-agent/ui/components/card";
import { Input } from "@better-agent/ui/components/input";
import { Label } from "@better-agent/ui/components/label";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { loadRefreshToken } from "@/utils/auth";
import { userAvatar } from "@/utils/avatar";
import { orpc } from "@/utils/orpc";
import { relativeTime } from "@/utils/relative-time";

export const Route = createFileRoute("/account")({ component: AccountPage });

interface Login {
	createdAt: Date;
	current: boolean;
	id: string;
	label: string;
}

function ProfileCard({
	email,
	emailVerified,
}: {
	email: string;
	emailVerified: boolean;
}) {
	const initial = email ? email[0].toUpperCase() : "?";
	return (
		<Card>
			<CardContent className="flex items-center gap-4">
				<Avatar size="lg">
					<AvatarImage alt={email} src={userAvatar(email)} />
					<AvatarFallback>{initial}</AvatarFallback>
				</Avatar>
				<div className="flex min-w-0 flex-col gap-1">
					<span className="truncate font-medium text-sm">{email}</span>
					<div>
						<Badge variant={emailVerified ? "secondary" : "outline"}>
							{emailVerified ? "Email verified" : "Email not verified"}
						</Badge>
					</div>
				</div>
			</CardContent>
		</Card>
	);
}

function PasswordForm({
	password,
	setPassword,
	pending,
	onSubmit,
}: {
	password: string;
	setPassword: (v: string) => void;
	pending: boolean;
	onSubmit: (event: React.FormEvent) => void;
}) {
	return (
		<form className="flex flex-col gap-3" onSubmit={onSubmit}>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="new-password">New password</Label>
				<Input
					autoComplete="new-password"
					id="new-password"
					minLength={8}
					onChange={(e) => setPassword(e.target.value)}
					placeholder="At least 8 characters"
					required
					type="password"
					value={password}
				/>
			</div>
			<div>
				<Button disabled={pending} size="sm" type="submit">
					{pending ? "Saving…" : "Save password"}
				</Button>
			</div>
		</form>
	);
}

function PasswordCard({
	hasPassword,
	onSaved,
}: {
	hasPassword: boolean;
	onSaved: () => void;
}) {
	const [password, setPassword] = useState("");
	const setPasswordMutation = useMutation({
		...orpc.account.setPassword.mutationOptions(),
		onSuccess: () => {
			toast.success(hasPassword ? "Password updated." : "Password set.");
			setPassword("");
			onSaved();
		},
		onError: (error) => toast.error(error.message),
	});
	const handleSubmit = (event: React.FormEvent) => {
		event.preventDefault();
		setPasswordMutation.mutate({ password });
	};
	return (
		<Card>
			<CardHeader>
				<CardTitle>Security</CardTitle>
				<CardDescription>
					{hasPassword
						? "Change the password you sign in with."
						: "Set a password to sign in without a magic link."}
				</CardDescription>
			</CardHeader>
			<CardContent>
				<PasswordForm
					onSubmit={handleSubmit}
					password={password}
					pending={setPasswordMutation.isPending}
					setPassword={setPassword}
				/>
			</CardContent>
		</Card>
	);
}

function SessionRow({
	login,
	onRevoke,
}: {
	login: Login;
	onRevoke: (id: string) => void;
}) {
	return (
		<div className="flex items-center justify-between gap-3 py-2.5">
			<div className="min-w-0">
				<div className="truncate text-sm">
					{login.label}
					{login.current ? " · this device" : ""}
				</div>
				<div className="text-muted-foreground text-xs">
					last active {relativeTime(new Date(login.createdAt).toISOString())}
				</div>
			</div>
			{login.current ? (
				<Badge variant="secondary">Current</Badge>
			) : (
				<Button onClick={() => onRevoke(login.id)} size="sm" variant="ghost">
					Sign out
				</Button>
			)}
		</div>
	);
}

function SessionsCard({
	logins,
	onRevoke,
	onRevokeOthers,
}: {
	logins: Login[];
	onRevoke: (id: string) => void;
	onRevokeOthers: () => void;
}) {
	const hasOthers = logins.some((login) => !login.current);
	return (
		<Card>
			<CardHeader>
				<CardTitle>Active sessions</CardTitle>
				<CardDescription>
					Devices currently signed in to your account.
				</CardDescription>
			</CardHeader>
			<CardContent className="divide-y">
				{logins.map((login) => (
					<SessionRow key={login.id} login={login} onRevoke={onRevoke} />
				))}
			</CardContent>
			{hasOthers ? (
				<CardFooter>
					<Button onClick={onRevokeOthers} size="sm" variant="outline">
						Sign out other devices
					</Button>
				</CardFooter>
			) : null}
		</Card>
	);
}

function useAccountPage() {
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
		onError: (error) => toast.error(error.message),
	});
	const revokeOthers = useMutation({
		...orpc.account.revokeOthers.mutationOptions(),
		onSuccess: invalidateLogins,
		onError: (error) => toast.error(error.message),
	});
	return {
		currentRefreshToken,
		email: meQuery.data?.email ?? "",
		emailVerified: meQuery.data?.emailVerified ?? false,
		hasPassword: meQuery.data?.hasPassword ?? false,
		invalidateMe,
		logins: loginsQuery.data ?? [],
		revokeLogin,
		revokeOthers,
	};
}

function AccountPage() {
	const page = useAccountPage();
	return (
		<div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 overflow-auto p-4 sm:p-6">
			<ProfileCard email={page.email} emailVerified={page.emailVerified} />
			<PasswordCard
				hasPassword={page.hasPassword}
				onSaved={page.invalidateMe}
			/>
			<SessionsCard
				logins={page.logins}
				onRevoke={(id) => page.revokeLogin.mutate({ id })}
				onRevokeOthers={() =>
					page.revokeOthers.mutate({
						currentRefreshToken: page.currentRefreshToken,
					})
				}
			/>
		</div>
	);
}
