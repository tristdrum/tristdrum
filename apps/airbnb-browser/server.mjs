import { loadConfig } from "./config.mjs";
import { createApp } from "./mcp.mjs";
import { BrowserPilotService } from "./service.mjs";

try {
  const config = loadConfig();
  const service = new BrowserPilotService(config);
  await service.init();
  const server = createApp(service, { mcpToken: config.mcpToken, operatorToken: config.operatorToken }).listen(config.port, "0.0.0.0");
  const meter = setInterval(() => { void service.flushRuntime().catch(() => {}); }, 60_000);
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => {
    clearInterval(meter);
    void service.flushRuntime().finally(() => server.close());
  });
} catch (error) {
  process.stderr.write(`Airbnb browser pilot cannot start: ${error.message}\n`);
  process.exitCode = 1;
}
