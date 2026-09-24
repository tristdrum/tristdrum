import { loadConfig } from "./config.mjs";
import { createApp } from "./mcp.mjs";
import { BrowserPilotService } from "./service.mjs";
import { BootstrapController, createBootstrapApp } from "./bootstrap.mjs";
import { assertAirbnbAutomatedAccessAuthorized } from "./runtime-authorization.mjs";

try {
  await assertAirbnbAutomatedAccessAuthorized();
  const config = loadConfig();
  if (config.bootstrapBlocked) process.stderr.write("Auth viewer disabled: exact login/MFA POST URLs have not been reviewed.\n");
  if (config.bootstrapEnabled && process.env.FLY_APP_NAME !== "tristdrum-airbnb-browser-pilot") {
    throw new Error("Bootstrap requires the pilot Fly runtime");
  }
  const service = new BrowserPilotService(config);
  await service.init();
  const server = createApp(service, { mcpToken: config.mcpToken, operatorToken: config.operatorToken }).listen(config.port, "0.0.0.0");
  let bootstrapController; let bootstrapServer;
  if (config.bootstrapEnabled) {
    bootstrapController = new BootstrapController(service, { authPostUrls: config.authPostUrls });
    bootstrapServer = createBootstrapApp(bootstrapController, config.operatorToken).listen(config.bootstrapPort, config.bootstrapHost);
  }
  service.startPolling();
  const meter = setInterval(() => { void service.flushRuntime().catch(() => {}); }, 60_000);
  let shuttingDown = false;
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { void (async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(meter);
    service.stopPolling();
    if (bootstrapController) await bootstrapController.stop().catch(() => {});
    await service.flushRuntime().catch(() => {});
    server.close();
    bootstrapServer?.close();
  })(); });
} catch (error) {
  process.stderr.write(`Airbnb browser pilot cannot start: ${error.message}\n`);
  process.exitCode = 1;
}
