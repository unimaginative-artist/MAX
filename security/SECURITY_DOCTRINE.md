# MAX Security Doctrine

Security is part of the feature, not a final polish pass.

## Non-Negotiables
- No secrets, private keys, tokens, passwords, or production credentials in source code.
- Validate and constrain every external input at the server boundary.
- Authorize every privileged action on the server, even if the UI hides it.
- Use parameterized database access. Do not build queries with string concatenation.
- Encode or sanitize user-controlled content before rendering.
- Use least privilege for files, shell commands, network calls, browser automation, and agent tools.
- Log enough to diagnose abuse, but never log credentials, tokens, full payment data, or sensitive personal data.
- Add abuse-case verification for auth, uploads, payments, admin actions, file access, shell execution, and rendered user content.

## Definition Of Done
A build is not done until normal behavior and likely abuse cases have both been checked.
