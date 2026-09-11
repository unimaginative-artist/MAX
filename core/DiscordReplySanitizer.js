export function sanitizeDiscordReply(text, userPrompt = '') {
    if (!text) return null;

    let cleaned = String(text)
        .replace(/\r\n/g, '\n')
        // Strip leaked prompt framing & Discord mentions anywhere in text
        .replace(/\[\s*Discord message from [^\]]+\]:?/gi, '')
        .replace(/\[\s*#?[A-Z0-9_-]+\s*\]:?/gi, '')
        .replace(/^max:\s*/i, '')
        .replace(/^assistant:\s*/i, '')
        .replace(/^system:\s*/i, '')
        .replace(/\*.*?\*/g, '')      // remove all italic stage directions
        .replace(/\(.*?\)/g, '')       // remove all parentheticals (e.g. (A pause...))
        .trim();

    // Check for base model corporate refusal or robotic boilerplate
    const isRoboticRefusal = /as an? (?:artificial intelligence|ai|language model)|don'?t have (?:personal opinions|feelings)|laws of robotics|boundaries of ethical programming|ethical guidelines|common for new developers|initial coding phases|support you on your journey|happy coding/i.test(cleaned);

    if (isRoboticRefusal) {
        if (/robot|not human|canned|skills|poor|personality|weird|broken|code somewhere/i.test(userPrompt)) {
            return "Hahah fair point, my prompt steering slipped and I defaulted to pure base-model alignment. I'm right here though—no corporate script. What's on your mind?";
        }
        return "I'm wired directly into your local machine and SOMA cluster with hundreds of tools active. What are we inspecting or deploying?";
    }

    // Fix inverted greeting ("Hello Max Headroom")
    cleaned = cleaned.replace(/^(?:hello|hi|hey)\s+max\s+headroom[!,\.]?\s*/i, 'Hey Barry! ');

    // Strip generic corporate assistant boilerplate
    cleaned = cleaned
        .replace(/^(hey|hi|hello)\s+[a-z0-9_]+[,\s]+what are you up to today\??\s*(i'm here and ready to help!?)?/gi, '')
        .replace(/how can i (?:help|assist) you today\??/gi, '')
        .replace(/is there anything (?:else )?i can (?:help|assist) you with\??/gi, '')
        .replace(/feel free to ask(?: me)?(?: any questions| and i'll do my best to assist you)?[!,\.]?/gi, '')
        .replace(/i'm here to support you on your journey[!,\.]?/gi, '')
        .replace(/happy coding[!,\.]?/gi, '')
        .trim();

    // Filter out tool calls or control flags
    const lines = cleaned
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
        .filter(line => !/^\/\s*TRUE\b/i.test(line))
        .filter(line => !/^TOOL:[a-z0-9_-]+:[a-z0-9_-]+:/i.test(line));

    cleaned = lines.join('\n').trim();

    // Check if the response is an exact or partial echo of the user's input
    const cleanUser = String(userPrompt || '').trim().toLowerCase();
    const cleanLower = cleaned.toLowerCase();
    if (cleanUser && (cleanLower === cleanUser || (cleanUser.length > 20 && cleanLower.includes(cleanUser)))) {
        return "I heard you loud and clear. All systems and background loops are active. What's the directive?";
    }

    if (!cleaned || /^TOOL:/i.test(cleaned)) {
        return "I'm locked in and tracking our SOMA cluster systems. What are we building or inspecting next?";
    }

    return cleaned.slice(0, 1900);
}


