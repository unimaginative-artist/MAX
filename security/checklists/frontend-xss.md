# Frontend XSS Checklist

- Prefer `textContent`, framework escaping, or vetted markdown sanitization.
- Avoid `innerHTML`, `dangerouslySetInnerHTML`, `document.write`, and untrusted template injection.
- Sanitize URLs before assigning links, images, redirects, or iframe sources.
- Use `rel="noopener noreferrer"` on untrusted external links.
- Do not expose secrets, admin-only data, or privileged flags in client bundles.
- Test malicious strings in names, comments, markdown, search, filenames, and rich text.
