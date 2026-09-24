const READ_TOOLS = Object.freeze([
  "get_calendar_snapshot", "list_message_threads", "get_message_snapshot", "refresh_before_plan", "get_pilot_status",
]);

export function agentsApiConnection(serverUrl, bearerToken) {
  const url = new URL(serverUrl);
  if (url.protocol !== "https:" || url.pathname !== "/mcp" || url.username || url.password || url.hash || url.search) {
    throw new Error("Agents API MCP URL must be an HTTPS /mcp endpoint");
  }
  if (typeof bearerToken !== "string" || bearerToken.length < 32) throw new Error("MCP bearer token is missing");
  return {
    environment: { type: "none" },
    tool: {
      type: "mcp",
      server_label: "airbnb_browser",
      transport: { type: "http", server_url: url.href, authorization: `Bearer ${bearerToken}` },
      connection_origin: "service",
      required: true,
      allowed_tools: [...READ_TOOLS],
    },
  };
}
