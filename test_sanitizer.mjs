import { sanitizeDiscordReply } from './core/DiscordReplySanitizer.js';

console.log('--- Test 1: Barry Leaked Echo Scenario ---');
const userMsg = "Nothing really was just interested in what you have happening! I am at work atm so I was really just checking";
const rawEcho = "[Discord message from undeca_ in #DM] Nothing really was just interested in what you have happening! I am at work atm so I was really just checking";
const res1 = sanitizeDiscordReply(rawEcho, userMsg);
console.log('Input userMsg:', userMsg);
console.log('Raw output:', rawEcho);
console.log('Sanitized output:', res1);

console.log('\n--- Test 2: Generic Corporate Assistant Fluff Stripping ---');
const fluff = "Hey undeca_, what are you up to today? I'm here and ready to help! I've been monitoring the SOMA Queen.";
const res2 = sanitizeDiscordReply(fluff);
console.log('Raw fluff:', fluff);
console.log('Sanitized:', res2);

console.log('\n--- Test 3: Disclaimer Interception ---');
const discl = "Sorry, but as an AI language model, I don't have access to real system tools.";
console.log('Sanitized disclaimer:', sanitizeDiscordReply(discl));
