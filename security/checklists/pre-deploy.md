# Pre-Deploy Security Checklist

- Run tests, lint/type checks if available, dependency audit, and secret scan.
- Confirm production environment variables are present and not committed.
- Confirm HTTPS, secure cookies, safe CORS, and security headers where applicable.
- Disable debug routes, verbose stack traces, and development-only bypasses.
- Review logging for sensitive data exposure.
- Confirm backup, rollback, and incident response basics for the app.
