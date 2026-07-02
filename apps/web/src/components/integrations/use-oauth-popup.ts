import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

import { orpc } from "@/utils/orpc";

const POPUP_WIDTH = 600;
const POPUP_HEIGHT = 720;
const CLOSE_POLL_MS = 800;

// Center the auth popup over the current window.
function popupFeatures(): string {
	const left = window.screenX + (window.outerWidth - POPUP_WIDTH) / 2;
	const top = window.screenY + (window.outerHeight - POPUP_HEIGHT) / 2;
	return `width=${POPUP_WIDTH},height=${POPUP_HEIGHT},left=${left},top=${top}`;
}

// Point the pre-opened popup at the authorize URL; fall back to a tab when the
// popup was blocked (window.open returned null) or already closed.
function navigatePopup(opts: {
	onRefresh: () => void;
	onWatch: (popup: Window) => void;
	popup: Window | null;
	redirectUrl: string;
}) {
	const { popup, redirectUrl } = opts;
	if (redirectUrl && popup && !popup.closed) {
		popup.location.href = redirectUrl;
		opts.onWatch(popup);
		return;
	}
	popup?.close();
	if (redirectUrl) {
		window.open(redirectUrl, "_blank", "noopener,noreferrer");
	}
	opts.onRefresh();
}

// Poll until the auth popup is closed, then run onClosed (refresh connections).
function watchPopupClose(
	popup: Window,
	watcherRef: { current: number | null },
	onClosed: () => void
) {
	watcherRef.current = window.setInterval(() => {
		if (popup.closed) {
			if (watcherRef.current !== null) {
				window.clearInterval(watcherRef.current);
				watcherRef.current = null;
			}
			onClosed();
		}
	}, CLOSE_POLL_MS);
}

/**
 * OAuth in a small popup instead of a tab. The popup MUST be opened
 * synchronously in the click (popup blockers kill async window.open), so we
 * open it blank first and point it at the redirect URL once the server
 * responds. When the user finishes and the popup closes, connections refresh.
 */
export function useOauthPopup(accountId: string) {
	const queryClient = useQueryClient();
	const popupRef = useRef<Window | null>(null);
	const watcherRef = useRef<number | null>(null);

	const refreshConnections = () =>
		queryClient.invalidateQueries({
			queryKey: orpc.composio.connections.key(),
		});

	const watchClose = (popup: Window) =>
		watchPopupClose(popup, watcherRef, refreshConnections);

	useEffect(
		() => () => {
			if (watcherRef.current !== null) {
				window.clearInterval(watcherRef.current);
			}
		},
		[]
	);

	const connect = useMutation(
		orpc.composio.connect.mutationOptions({
			onSuccess: (result) =>
				navigatePopup({
					popup: popupRef.current,
					redirectUrl: result.redirectUrl,
					onWatch: watchClose,
					onRefresh: refreshConnections,
				}),
			onError: (error) => {
				popupRef.current?.close();
				toast.error(error.message);
			},
		})
	);

	const start = (toolkit: string) => {
		// Synchronous open inside the click handler; navigated after the server
		// returns the authorize URL.
		popupRef.current = window.open(
			"about:blank",
			"composio-auth",
			popupFeatures()
		);
		connect.mutate({ accountId, toolkit });
	};

	return { start, isPending: connect.isPending };
}
