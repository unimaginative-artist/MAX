# File Upload Checklist

- Authenticate and authorize upload and download operations.
- Enforce file size, count, extension, and MIME allowlists server-side.
- Store uploads outside executable/static code paths unless explicitly safe.
- Generate server-side filenames. Do not trust user filenames or paths.
- Scan or quarantine risky file types when appropriate.
- Strip metadata for images when privacy matters.
- Test path traversal, oversized files, MIME spoofing, and unauthorized downloads.
