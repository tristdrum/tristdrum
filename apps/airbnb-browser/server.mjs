import { loadConfig } from "./config.mjs";
import { createApp } from "./mcp.mjs";
import { BrowserPilotService } from "./service.mjs";

try {
  const config = loadConfig();
  const service = new BrowserPilotService(config);
  await service.init();
  const server = createApp(service, config.mcpToken).listen(config.port, "0.0.0.0", () => service.start());
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => {
    service.stop();
    server.close();
  });
} catch (error) {
  process.stderr.write(`Airbnb browser pilot cannot start: ${error.message}\n`);
  process.exitCode = 1;
}
