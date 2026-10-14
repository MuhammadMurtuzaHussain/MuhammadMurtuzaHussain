// Refreshes data.json from GitHub, DEV and Medium, rebuilds the SVGs and
// rewrites the generated parts of README.md. Runs daily from
// .github/workflows/update.yml; locally: GITHUB_TOKEN=$(gh auth token) node update.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { escapeHtml, replaceBlock, restamp, versionNow } from './lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const dataPath = path.join(here, 'data.json');
const profile = JSON.parse(fs.readFileSync(path.join(here, 'profile.json'), 'utf8'));
const previous = fs.existsSync(dataPath) ? JSON.parse(fs.readFileSync(dataPath, 'utf8')) : {};
const token = process.env.GITHUB_TOKEN;
if (!token) throw new Error('GITHUB_TOKEN is required');
const UA = { 'User-Agent': 'mmh-profile-readme' };

async function github(query, variables) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { ...UA, Authorization: `bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (!res.ok || json.errors) throw new Error(`GitHub API: ${JSON.stringify(json.errors ?? json)}`);
  return json.data.user;
}

async function githubStats() {
  const year = new Date().getUTCFullYear();
  const user = await github(
    `query($login: String!, $from: DateTime!) {
      user(login: $login) {
        repositories(first: 100, ownerAffiliations: OWNER, privacy: PUBLIC, isFork: false) {
          totalCount
          nodes { primaryLanguage { name } }
        }
        thisYear: contributionsCollection(from: $from) { contributionCalendar { totalContributions } }
        recent: contributionsCollection { contributionCalendar { weeks { contributionDays { contributionCount } } } }
      }
    }`,
    { login: profile.user, from: `${year}-01-01T00:00:00Z` },
  );
  const tally = new Map();
  for (const repo of user.repositories.nodes) {
    const name = repo.primaryLanguage?.name;
    if (name) tally.set(name, (tally.get(name) ?? 0) + 1);
  }
  const ranked = [...tally].sort((a, b) => b[1] - a[1]);
  const languages = ranked.slice(0, 4).map(([name, count]) => ({ name, count }));
  const other = ranked.slice(4).reduce((n, [, count]) => n + count, 0);
  if (other) languages.push({ name: 'Other', count: other });
  const days = user.recent.contributionCalendar.weeks.flatMap((w) => w.contributionDays.map((d) => d.contributionCount));
  return {
    year,
    repos: user.repositories.totalCount,
    contributions: user.thisYear.contributionCalendar.totalContributions,
    languages,
    daily: days.slice(-32),
  };
}

const decode = (s) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim();

async function devPosts(cfg) {
  const res = await fetch(`https://dev.to/api/articles?username=${cfg.devUser}&per_page=30`, { headers: UA });
  if (!res.ok) throw new Error(`DEV API ${res.status}`);
  return (await res.json()).map((a) => ({
    source: 'DEV',
    title: a.title,
    url: a.url,
    date: a.published_at,
    tags: a.tag_list,
    long: a.reading_time_minutes >= cfg.minDevMinutes,
  }));
}

async function mediumPosts(cfg) {
  const res = await fetch(`https://medium.com/feed/@${cfg.mediumUser}`, { headers: { 'User-Agent': 'Mozilla/5.0 (mmh-profile-readme)' } });
  if (!res.ok) throw new Error(`Medium feed ${res.status}`);
  const xml = await res.text();
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, item]) => {
    const field = (tag) => decode(item.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1] ?? '');
    const body = field('content:encoded').replace(/<[^>]+>/g, ' ');
    return {
      source: 'Medium',
      title: field('title'),
      url: field('link').split('?')[0],
      date: new Date(field('pubDate')).toISOString(),
      tags: [...item.matchAll(/<category>([\s\S]*?)<\/category>/g)].map(([, c]) => decode(c)),
      long: body.split(/\s+/).filter(Boolean).length >= cfg.minMediumWords,
    };
  });
}

// Only technical write-ups make the list; personal posts stay off the profile.
async function latestPosts() {
  const cfg = profile.posts;
  const sources = [
    ['DEV', devPosts],
    ['Medium', mediumPosts],
  ];
  const all = [];
  for (const [name, fetchPosts] of sources) {
    try {
      all.push(
        ...(await fetchPosts(cfg)).filter(
          (p) =>
            p.long &&
            p.tags.some((t) => cfg.includeTags.includes(t)) &&
            !p.tags.some((t) => cfg.excludeTags.includes(t)) &&
            !cfg.exclude.includes(p.url),
        ),
      );
    } catch (err) {
      console.warn(`Keeping previous ${name} posts: ${err.message}`);
      all.push(...(previous.posts ?? []).filter((p) => p.source === name));
    }
  }
  return all
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, cfg.count)
    .map(({ source, title, url, date }) => ({ source, title, url, date }));
}

const data = {
  updated: new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Europe/Dublin' }),
  ...(await githubStats()),
  posts: await latestPosts(),
};
fs.writeFileSync(dataPath, `${JSON.stringify(data, null, 2)}\n`);
execFileSync(process.execPath, [path.join(here, 'build.mjs')], { stdio: 'inherit' });

const readmePath = path.join(root, 'README.md');
let readme = fs.readFileSync(readmePath, 'utf8');
const rows = data.posts.map(
  (p, i) => `<a href="${escapeHtml(p.url)}"><img src="assets/note-${i + 1}.svg" width="100%" alt="${escapeHtml(`${p.source}: ${p.title}`)}"></a>`,
);
readme = replaceBlock(readme, 'POSTS', rows.join('\n'));
readme = readme.replace(/all \d+ case files/g, `all ${data.repos} case files`);
fs.writeFileSync(readmePath, restamp(readme, versionNow()));
console.log(`updated: ${data.repos} repos, ${data.contributions} contributions, ${data.posts.length} posts`);
