import { createFileRoute } from "@tanstack/react-router";

import { BoardPage } from "@/board/board-page";

export const Route = createFileRoute("/board")({ component: BoardPage });
