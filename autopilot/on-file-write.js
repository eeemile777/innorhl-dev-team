/**
 * autopilot/on-file-write.js
 *
 * Claude Code hook: fires after every Write or Edit tool use (PostToolUse).
 * If PLAN.md was just written, logs the task progress.
 *
 * Configured in .claude/settings.json → hooks → PostToolUse
 * Input: JSON via stdin with tool_name and tool_input
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');

// Read hook input from stdin
let input = '';
process.stdin.on('data', d => { input += d; });
process.stdin.on('end', () => {
  try {
    const hook = JSON.parse(input || '{}');
    const filePath = hook?.tool_input?.file_path || hook?.tool_input?.path || '';

    // Only care about PLAN.md writes
    if (!filePath.endsWith('PLAN.md')) {
      process.exit(0);
      return;
    }

    const planPath = resolve(PROJECT_ROOT, 'PLAN.md');
    if (!existsSync(planPath)) {
      process.exit(0);
      return;
    }

    const plan = readFileSync(planPath, 'utf8');
    const total = (plan.match(/^- \[[ x]\]/gm) || []).length;
    const done = (plan.match(/^- \[x\]/gm) || []).length;

    if (total > 0) {
      console.log(`[autopilot] PLAN.md updated: ${done}/${total} tasks complete`);
    }

    process.exit(0);
  } catch {
    process.exit(0);
  }
});
