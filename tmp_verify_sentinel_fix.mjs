// Stronger verification of SentinelLoop._checkSyntax fix
import { SentinelLoop } from './core/loops/SentinelLoop.js';

async function main() {
  const loop = new SentinelLoop();
  let pass = 0, fail = 0;
  function check(name, cond) {
    if (cond) { console.log(`  \u2705 ${name}`); pass++; }
    else      { console.log(`  \u274c ${name}`); fail++; }
  }

  const REAL_FILE = 'tmp_verify_sentinel_fix.mjs';

  // Shell returns a blocked result WITH NO .stderr field (the original trap)
  const blockedMax = {
    tools: {
      execute: async () => ({
        success: false,
        blocked: true,
        policy: { risk: 'high', reason: 'Command not in allowlist' },
        error: '[AutonomyPolicy] Shell policy blocked command'
      })
    }
  };

  // Shell returns a legit syntax error with stderr present
  const stderrMax = {
    tools: { execute: async () => ({ success: false, stderr: 'SyntaxError: Unexpected token', code: 1 }) }
  };

  // Shell returns entirely empty failure object (worst case)
  const emptyMax = {
    tools: { execute: async () => ({ success: false }) }
  };

  console.log('Scenario 1: non-existent file (phantom git-diff path)');
  const r1 = await loop._checkSyntax('server/loaders/agents.js', blockedMax);
  check('success=true (skipped)', r1.success === true);
  check('skipped flag set', r1.skipped === true);
  check('error is null (not undefined)', r1.error === null);

  console.log('Scenario 2: real file, shell blocked with NO stderr');
  const r2 = await loop._checkSyntax(REAL_FILE, blockedMax);
  check('success=false', r2.success === false);
  check('error is a non-empty string', typeof r2.error === 'string' && r2.error.length > 0);
  check('error never the literal "undefined"', r2.error !== 'undefined');
  console.log('     -> goal detail would read:', `\"Sentinel found a smell in ${REAL_FILE}: ${r2.error}\"`);

  console.log('Scenario 3: real file, shell returns stderr');
  const r3 = await loop._checkSyntax(REAL_FILE, stderrMax);
  check('error uses stderr', r3.error === 'SyntaxError: Unexpected token');

  console.log('Scenario 4: real file, shell returns empty failure object');
  const r4 = await loop._checkSyntax(REAL_FILE, emptyMax);
  check('error is still a non-empty string', typeof r4.error === 'string' && r4.error.length > 0);

  console.log(`\nResult: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main();
