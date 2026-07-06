export function sanitizeDiscordReply(text) {
    const lines = String(text || '')
        .replace(/\r\n/g, '\n')
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
        .filter(line => !/^\/\s*TRUE\b/i.test(line))
        .filter(line => !/^TOOL:[a-z0-9_-]+:[a-z0-9_-]+:/i.test(line));
    const cleaned = lines.join('\n').trim();
    if (!cleaned || /^TOOL:/i.test(cleaned)) return null;
    return cleaned.slice(0, 1900);
}
