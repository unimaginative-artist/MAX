# Auth Security Checklist

- Store password hashes with a modern password hashing function when passwords are used.
- Use secure, httpOnly, sameSite cookies for browser sessions.
- Regenerate sessions after login and privilege changes.
- Enforce server-side authorization on every protected object.
- Protect password reset, email change, MFA, and admin promotion flows.
- Avoid long-lived bearer tokens in localStorage.
- Test cross-user and lower-role access attempts.
