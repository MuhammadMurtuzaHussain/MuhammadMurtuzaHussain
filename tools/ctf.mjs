// Checks one CTF submission (an issue) and updates the scoreboard.
//
// Runs from .github/workflows/ctf.yml. The issue text arrives in environment
// variables and is only ever matched against patterns, never executed.
// Submissions are sha256("flag{...}:<github-login>"), so a public issue never
// reveals a flag and a hash cannot be reused by anyone else.
//
// Writes the reply to $REPLY_DIR/reply.md and the close reason to
// $REPLY_DIR/reason.txt; the workflow posts them after the commit lands.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { rankPlayers, replaceBlock, restamp, versionNow } from './lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const { ISSUE_TITLE = '', ISSUE_BODY = '', PLAYER, CTF_FLAGS, REPLY_DIR } = process.env;
if (!PLAYER || !CTF_FLAGS || !REPLY_DIR) throw new Error('PLAYER, CTF_FLAGS and REPLY_DIR are required');

const profile = JSON.parse(fs.readFileSync(path.join(here, 'profile.json'), 'utf8'));
const { challenges } = profile.ctf;
const flags = JSON.parse(CTF_FLAGS);
const statePath = path.join(root, 'ctf', 'state.json');
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
const repo = `https://github.com/${profile.user}/${profile.user}`;
const howTo = [
  'Hash the flag together with your GitHub username, then submit the hash:',
  '',
  '```sh',
  `printf '%s' 'flag{...}:${PLAYER}' | shasum -a 256`,
  '```',
  '',
  `Full briefing: ${repo}/tree/main/ctf`,
].join('\n');

function finish(reply, reason) {
  fs.writeFileSync(path.join(REPLY_DIR, 'reply.md'), reply);
  fs.writeFileSync(path.join(REPLY_DIR, 'reason.txt'), reason);
  process.exit(0);
}

const text = `${ISSUE_TITLE}\n${ISSUE_BODY}`;
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

if (/flag\{/i.test(text)) {
  finish(
    [
      `@${PLAYER} careful: that looks like a plaintext flag, and issues are public. No points for this one.`,
      '',
      howTo,
    ].join('\n'),
    'not planned',
  );
}

const hashes = new Set((text.match(/\b[a-f0-9]{64}\b/gi) ?? []).map((h) => h.toLowerCase()));
if (!hashes.size) finish([`@${PLAYER} I couldn't find a 64-character hash in this issue.`, '', howTo].join('\n'), 'not planned');

const logins = new Set([PLAYER, PLAYER.toLowerCase()]);
const matched = challenges.filter((c) => [...logins].some((login) => hashes.has(sha256(`${flags[c.id]}:${login}`))));
if (!matched.length) {
  finish(
    [
      `@${PLAYER} no match. Each hash has to be sha256 of \`flag{...}:${PLAYER}\` exactly, with no trailing newline.`,
      '',
      howTo,
    ].join('\n'),
    'not planned',
  );
}

const now = new Date().toISOString();
const lines = [];
for (const c of matched) {
  if (state.solves.some((s) => s.player === PLAYER && s.id === c.id)) {
    lines.push(`- \`${c.id}\` ${c.name}: already on the board.`);
    continue;
  }
  const firstBlood = !state.solves.some((s) => s.id === c.id);
  state.solves.push({ player: PLAYER, id: c.id, at: now });
  lines.push(`- \`${c.id}\` ${c.name}: captured, +${c.points}${firstBlood ? '. **First blood.**' : '.'}`);
}
fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);

const ranking = rankPlayers(challenges, state.solves);
const table = [
  '| # | player | flags | points |',
  '|--:|:--|--:|--:|',
  ...ranking.map((p, i) => `| ${i + 1} | [@${p.player}](https://github.com/${p.player}) | ${p.flags}/${challenges.length} | ${p.points} |`),
].join('\n');
const briefPath = path.join(root, 'ctf', 'README.md');
fs.writeFileSync(briefPath, replaceBlock(fs.readFileSync(briefPath, 'utf8'), 'SCOREBOARD', table));

execFileSync(process.execPath, [path.join(here, 'build.mjs')], { stdio: 'inherit' });
const readmePath = path.join(root, 'README.md');
fs.writeFileSync(readmePath, restamp(fs.readFileSync(readmePath, 'utf8'), versionNow(), ['ctf']));

const me = ranking.find((p) => p.player === PLAYER);
const rank = ranking.indexOf(me) + 1;
finish(
  [
    `@${PLAYER} verified:`,
    '',
    ...lines,
    '',
    `You're #${rank} with ${me.points} points (${me.flags}/${challenges.length} flags). Scoreboard: ${repo}/tree/main/ctf#scoreboard`,
  ].join('\n'),
  'completed',
);
