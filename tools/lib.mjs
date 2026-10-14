// Helpers shared by build.mjs, update.mjs and ctf.mjs.

// Replaces the text between <!-- NAME:START --> and <!-- NAME:END -->.
export function replaceBlock(text, name, content) {
  const re = new RegExp(`(<!-- ${name}:START -->)[\\s\\S]*?(<!-- ${name}:END -->)`);
  if (!re.test(text)) throw new Error(`Missing ${name} markers`);
  return text.replace(re, (_, start, end) => `${start}\n${content}\n${end}`);
}

// Gives asset URLs a fresh ?v= so GitHub shows regenerated images straight
// away. Pass `only` to restamp a subset, e.g. ['ctf'].
export function restamp(text, version, only = null) {
  return text.replace(/(assets\/([a-z0-9-]+)\.svg)(\?v=\w+)?/g, (match, url, name) =>
    only && !only.includes(name) ? match : `${url}?v=${version}`,
  );
}

export const versionNow = () => new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);

export const escapeHtml = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Totals per player, highest score first; ties go to whoever got there first.
export function rankPlayers(challenges, solves) {
  const players = new Map();
  for (const s of solves) {
    const points = challenges.find((c) => c.id === s.id)?.points ?? 0;
    const p = players.get(s.player) ?? { player: s.player, points: 0, flags: 0, last: s.at };
    p.points += points;
    p.flags += 1;
    if (s.at > p.last) p.last = s.at;
    players.set(s.player, p);
  }
  return [...players.values()].sort((a, b) => b.points - a.points || a.last.localeCompare(b.last));
}
