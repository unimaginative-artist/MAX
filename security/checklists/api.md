# API Security Checklist

- Require authentication where data or actions are user-specific.
- Check authorization per object, tenant, role, and admin capability.
- Validate request body, query, params, headers, and content type.
- Return safe errors without stack traces or secret values.
- Set deliberate CORS rules. Avoid wildcard credentials.
- Rate-limit login, signup, password reset, webhooks, search, uploads, and AI/tool endpoints.
- Verify direct API calls cannot bypass UI restrictions.
