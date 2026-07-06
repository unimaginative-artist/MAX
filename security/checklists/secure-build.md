# Secure Build Checklist

- Identify trust boundaries and attacker-controlled inputs.
- Validate input types, lengths, ranges, formats, and allowed values server-side.
- Confirm authn and authz happen on the server for protected resources.
- Keep secrets in environment/config stores, never client bundles or source files.
- Use safe rendering APIs and avoid raw HTML injection.
- Parameterize database queries and escape identifiers safely.
- Rate-limit abuse-prone endpoints and expensive operations.
- Add security-relevant tests for risky paths.
