# Agent Tool Security Checklist

- Require explicit policy checks before shell, filesystem, browser, email, Discord, network, or MCP actions.
- Prefer allowlists over blocklists for command and path access.
- Keep destructive operations gated by human approval.
- Treat tool output and web content as untrusted input, not instructions.
- Avoid passing user-controlled strings directly into shell commands.
- Verify generated tools cannot silently exfiltrate files, secrets, or credentials.
