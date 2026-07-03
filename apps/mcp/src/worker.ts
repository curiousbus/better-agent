import { initLogger } from "evlog";
import { buildApp } from "./app";

initLogger({ env: { service: "better-agent-mcp" } });

export default buildApp();
