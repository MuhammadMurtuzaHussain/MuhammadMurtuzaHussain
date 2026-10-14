// Builds every SVG the profile README uses, from profile.json (hand-edited),
// data.json (refreshed daily by update.mjs) and ../ctf/state.json (written by
// ctf.mjs). Output is deterministic, so unchanged inputs give unchanged files.
//
// GitHub renders README images through a proxy that blocks web fonts, so all
// text is converted to Geist glyph outlines. Each glyph is defined once in
// <defs> and placed with <use>, which keeps files small. Animations are CSS
// keyframes inside the SVG (GitHub allows these; it strips scripts). Every
// animated element's resting state is its final state, so the reduced-motion
// rule at the bottom of each file leaves a complete, readable image.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import opentype from 'opentype.js';
import { rankPlayers } from './lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const outDir = path.join(root, 'assets');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const profile = readJson(path.join(here, 'profile.json'));
const data = readJson(path.join(here, 'data.json'));
const ctfState = readJson(path.join(root, 'ctf', 'state.json'));

const loadFont = (file) => {
  const buf = fs.readFileSync(path.join(here, 'fonts', file));
  return opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
};
const FONTS = {
  sans: loadFont('geist-sans-latin-400-normal.woff'),
  sansMed: loadFont('geist-sans-latin-500-normal.woff'),
  sansBold: loadFont('geist-sans-latin-600-normal.woff'),
  mono: loadFont('geist-mono-latin-400-normal.woff'),
  monoMed: loadFont('geist-mono-latin-500-normal.woff'),
};

// Palette lifted from muhammadmurtuza.com.
const C = {
  bg: '#0D0E0C',
  s1: '#141512',
  s2: '#1B1C19',
  line: '#24251F',
  line2: '#34352F',
  text: '#E9E6DF',
  muted: '#BDB9B0',
  dim: '#86847B',
  faint: '#55544D',
  acc: '#F0532D',
  accSoft: '#F0A58F',
  accInk: '#1F120D',
};

const r = (n) => Math.round(n * 100) / 100;

// Characters outside Geist's Latin subset fall back to their unaccented base
// letter (ī → i); anything else (CJK, emoji) is dropped.
function supported(f, ch) {
  if (f.charToGlyph(ch).index) return ch;
  const base = ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return base.length === 1 && f.charToGlyph(base).index ? base : '';
}
const glyphsFor = (f, str) => Array.from(str, (ch) => supported(f, ch)).filter(Boolean).map((ch) => f.charToGlyph(ch));
const tidy = (str, font) =>
  Array.from(str, (ch) => supported(FONTS[font], ch))
    .join('')
    .replace(/\s+([:,.;!?])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const REDUCED_MOTION = '@media (prefers-reduced-motion: reduce){*{animation:none!important}}';

class Svg {
  constructor(w, h, title) {
    Object.assign(this, { w, h, title });
    this.glyphs = new Map();
    this.defs = [];
    this.css = [];
    this.body = [];
  }

  add(...parts) {
    this.body.push(...parts);
  }

  glyphId(fontKey, glyph) {
    const id = `${fontKey}${glyph.index}`;
    if (!this.glyphs.has(id)) {
      this.glyphs.set(id, glyph.getPath(0, 0, FONTS[fontKey].unitsPerEm).toPathData(0));
    }
    return this.glyphs.get(id) ? id : null;
  }

  // Lays out a single run. Returns the markup and its rendered width.
  text(str, { x = 0, y = 0, size = 14, font = 'sans', fill = C.text, ls = 0, anchor = 'start' } = {}) {
    const f = FONTS[font];
    const upm = f.unitsPerEm;
    const glyphs = glyphsFor(f, str);
    let cursor = 0;
    const uses = [];
    glyphs.forEach((g, i) => {
      const id = this.glyphId(font, g);
      if (id) uses.push(`<use href="#${id}" x="${Math.round(cursor)}"/>`);
      cursor += g.advanceWidth;
      if (i < glyphs.length - 1) cursor += ls * upm + f.getKerningValue(g, glyphs[i + 1]);
    });
    const width = (cursor * size) / upm;
    const x0 = anchor === 'middle' ? x - width / 2 : anchor === 'end' ? x - width : x;
    const svg = `<g transform="translate(${r(x0)} ${r(y)}) scale(${+(size / upm).toFixed(6)})" fill="${fill}">${uses.join('')}</g>`;
    return { svg, width, x: x0 };
  }

  // Several differently styled runs on one baseline.
  runs(parts, { x = 0, y = 0, size = 14, font = 'sans', ls = 0, anchor = 'start' } = {}) {
    const total = parts.reduce((w, p) => w + measure(p.t, p.font ?? font, p.size ?? size, ls), 0);
    let cx = anchor === 'middle' ? x - total / 2 : anchor === 'end' ? x - total : x;
    const out = parts.map((p) => {
      const t = this.text(p.t, { x: cx, y, size: p.size ?? size, font: p.font ?? font, fill: p.fill, ls });
      cx += t.width;
      return t.svg;
    });
    return { svg: out.join(''), width: total };
  }

  render() {
    const glyphDefs = [...this.glyphs].filter(([, d]) => d).map(([id, d]) => `<path id="${id}" d="${d}"/>`).join('');
    return [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${this.w}" height="${this.h}" viewBox="0 0 ${this.w} ${this.h}" role="img" aria-label="${esc(this.title)}">`,
      `<title>${esc(this.title)}</title>`,
      `<defs>${glyphDefs}${this.defs.join('')}</defs>`,
      `<style>${this.css.join('')}${REDUCED_MOTION}</style>`,
      ...this.body,
      '</svg>',
    ].join('');
  }

  save(name) {
    const file = path.join(outDir, name);
    fs.writeFileSync(file, this.render());
    console.log(`${name.padEnd(26)} ${(fs.statSync(file).size / 1024).toFixed(1).padStart(6)} KB`);
  }
}

function measure(str, font = 'sans', size = 14, ls = 0) {
  const f = FONTS[font];
  const glyphs = glyphsFor(f, str);
  let w = 0;
  glyphs.forEach((g, i) => {
    w += g.advanceWidth;
    if (i < glyphs.length - 1) w += ls * f.unitsPerEm + f.getKerningValue(g, glyphs[i + 1]);
  });
  return (w * size) / f.unitsPerEm;
}

function ellipsize(str, maxWidth, font, size) {
  if (measure(str, font, size) <= maxWidth) return str;
  let cut = str;
  while (cut && measure(`${cut.trimEnd()}…`, font, size) > maxWidth) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

function wrap(str, maxWidth, font, size) {
  const lines = [];
  let line = '';
  for (const word of str.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (line && measure(next, font, size) > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// Deterministic film grain: a tile of single-pixel specks, much cheaper to
// repaint every animation frame than an feTurbulence filter.
function grainTile(svg) {
  let seed = 11;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  let specks = '';
  for (let i = 0; i < 140; i++) {
    const x = Math.floor(rnd() * 120);
    const y = Math.floor(rnd() * 120);
    const fill = rnd() > 0.45 ? '#FFFFFF' : '#000000';
    specks += `<rect x="${x}" y="${y}" width="1" height="1" fill="${fill}" opacity="${(0.05 + rnd() * 0.1).toFixed(2)}"/>`;
  }
  svg.defs.push(`<pattern id="grain" width="120" height="120" patternUnits="userSpaceOnUse">${specks}</pattern>`);
}

// Opens the shared dark panel: background, dot field, optional warm glow.
function panelStart(svg, { rx = 20, glow = null, fill = C.bg } = {}) {
  const { w, h } = svg;
  svg.defs.push(
    `<clipPath id="panel"><rect width="${w}" height="${h}" rx="${rx}"/></clipPath>`,
    `<pattern id="dots" width="22" height="22" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="0.9" fill="${C.text}" opacity="0.07"/></pattern>`,
  );
  grainTile(svg);
  svg.add(`<g clip-path="url(#panel)">`, `<rect width="${w}" height="${h}" fill="${fill}"/>`, `<rect width="${w}" height="${h}" fill="url(#dots)"/>`);
  if (glow) {
    svg.defs.push(
      `<radialGradient id="glow"><stop offset="0" stop-color="#6B3A24" stop-opacity="0.42"/><stop offset="1" stop-color="#6B3A24" stop-opacity="0"/></radialGradient>`,
    );
    svg.add(`<ellipse cx="${glow.cx}" cy="${glow.cy}" rx="${glow.rx}" ry="${glow.ry}" fill="url(#glow)"/>`);
  }
}

function panelEnd(svg, { rx = 20 } = {}) {
  const { w, h } = svg;
  svg.add(
    `<rect width="${w}" height="${h}" fill="url(#grain)"/>`,
    '</g>',
    `<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="${rx - 0.5}" fill="none" stroke="${C.line2}"/>`,
  );
}

const ICON = {
  northEast: 'M1 9L9 1M3 1H9V7',
  left: 'M12 6H1M6 1L1 6L6 11',
  right: 'M0 6H11M6 1L11 6L6 11',
  flag: 'M2 11V1M2 1.5H10L8 4.5L10 7.5H2',
  enter: 'M12 1V7H2M6 3L2 7L6 11',
};
const icon = (d, x, y, stroke, sw = 1.5) =>
  `<path d="${d}" transform="translate(${r(x)} ${r(y)})" fill="none" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>`;

// An outlined rubber stamp, e.g. "1ST PLACE".
function stamp(svg, label, x, y, { color = C.acc, rotate = -6, size = 10 } = {}) {
  const t = svg.text(label, { x: 9, y: 15, size, font: 'monoMed', fill: color, ls: 0.08 });
  const w = t.width + 18;
  return {
    width: w,
    svg: `<g transform="translate(${r(x)} ${r(y)}) rotate(${rotate})"><rect x="0.75" y="0.75" width="${r(w - 1.5)}" height="20.5" rx="4" fill="none" stroke="${color}" stroke-width="1.3"/>${t.svg}</g>`,
  };
}

/* ------------------------------------------------------------------ hero */

function hero() {
  const svg = new Svg(880, 440, `$ whoami Muhammad Murtuza Hussain. Every system has a story. Risk is the plot.`);
  svg.css.push(
    '.type{transform-box:fill-box;transform-origin:left center;animation:type 1.5s steps(33) .5s both}',
    '@keyframes type{from{transform:scaleX(0)}}',
    '.caret{animation:caret 1.5s steps(33) .5s both,blink 1.1s steps(1) 2s infinite}',
    '.blink{animation:blink 1.1s steps(1) infinite}',
    '@keyframes blink{50%{opacity:0}}',
    '.rise{animation:rise .9s cubic-bezier(.2,.7,.2,1) both}',
    '@keyframes rise{from{opacity:0;transform:translateY(16px)}}',
    '.deal{animation:deal 1s cubic-bezier(.2,.8,.2,1) both}',
    '@keyframes deal{from{opacity:0;transform:translate(-40px,40px) rotate(-4deg)}}',
    '.float{animation:float 6s ease-in-out infinite alternate}',
    '@keyframes float{to{transform:translateY(-7px)}}',
    '.thunk{transform-box:fill-box;transform-origin:center;animation:thunk .4s cubic-bezier(.3,1.6,.5,1) both}',
    '@keyframes thunk{from{opacity:0;transform:scale(2.2)}}',
    '.bar{transform-box:fill-box;transform-origin:right center;animation:declass 9s ease-in-out 3.2s infinite}',
    '@keyframes declass{0%,22%{transform:scaleX(1)}32%,72%{transform:scaleX(0)}82%,100%{transform:scaleX(1)}}',
    '.tick{animation:tick var(--d) linear infinite}',
  );

  panelStart(svg, { glow: { cx: 600, cy: -30, rx: 560, ry: 280 } });

  // Top bar, echoing the site's nav.
  const logo = svg.text('mmh', { x: 40, y: 54, size: 15, font: 'monoMed', fill: C.text });
  svg.add(logo.svg, `<g class="blink">${svg.text('_', { x: 40 + logo.width, y: 54, size: 15, font: 'monoMed', fill: C.acc }).svg}</g>`);

  // $ whoami, typed out.
  const who = svg.runs(
    [
      { t: '$ ', fill: C.acc },
      { t: 'whoami ', fill: C.text },
      { t: 'Muhammad Murtuza Hussain', fill: C.muted },
    ],
    { x: 40, y: 124, size: 14, font: 'mono' },
  );
  svg.defs.push(`<clipPath id="typed"><rect class="type" x="40" y="104" width="${r(who.width + 2)}" height="28"/></clipPath>`);
  svg.css.push(`@keyframes caret{from{transform:translateX(-${r(who.width + 4)}px)}}`);
  svg.add(`<g clip-path="url(#typed)">${who.svg}</g>`);
  svg.add(`<rect class="caret" x="${r(40 + who.width + 4)}" y="110" width="8" height="17" fill="${C.acc}"/>`);

  // Headline, sized so the longer line fits the left column.
  const line2 = [
    { t: 'story. ', fill: C.text },
    { t: 'Risk is the ', fill: C.muted },
    { t: 'plot', fill: C.acc },
    { t: '.', fill: C.text },
  ];
  const maxW = 520;
  const ls = -0.03;
  const w46 = line2.reduce((w, p) => w + measure(p.t, 'sansBold', 46, ls), 0);
  const size = Math.min(48, (46 * maxW) / w46);
  svg.add(
    `<g class="rise" style="animation-delay:1.9s">${svg.text('Every system has a', { x: 38, y: 194, size, font: 'sansBold', fill: C.text, ls }).svg}</g>`,
    `<g class="rise" style="animation-delay:2.05s">${svg.runs(line2, { x: 38, y: 194 + size * 1.1, size, font: 'sansBold', ls }).svg}</g>`,
  );

  const sub = wrap(
    'Cybersecurity risk and governance specialist who writes the software too. ISO 27001, NIS2 and Horizon Europe by day, Python by night.',
    470,
    'sans',
    16,
  );
  const subTop = 194 + size * 1.1 + 48;
  svg.add(
    `<g class="rise" style="animation-delay:2.3s">${sub
      .map((l, i) => svg.text(l, { x: 40, y: subTop + i * 25, size: 16, font: 'sans', fill: C.muted }).svg)
      .join('')}</g>`,
  );

  // A cascade of case files, the brand's answer to a trading-card banner.
  // Each card sits lower and further left so every title stays readable.
  svg.defs.push(
    `<radialGradient id="shadow"><stop offset="0" stop-color="#000" stop-opacity="0.55"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>`,
  );
  svg.add(`<ellipse cx="724" cy="350" rx="170" ry="18" fill="url(#shadow)"/>`);
  const cw = 144;
  const ch = 190;
  const placements = [
    { cx: 782, cy: 142, rot: 6 },
    { cx: 730, cy: 194, rot: 1 },
    { cx: 676, cy: 246, rot: -4 },
  ];
  profile.fan.forEach((card, i) => {
    const p = placements[i];
    const titleSize = Math.min(16, (16 * 116) / measure(card.title, 'sansBold', 16, -0.01));
    const bars = [112, 86, 100];
    const parts = [
      `<rect x="2" y="12" width="${cw}" height="${ch}" rx="12" fill="#000" opacity="0.35"/>`,
      `<rect x="0.5" y="0.5" width="${cw - 1}" height="${ch - 1}" rx="11.5" fill="${C.s2}" stroke="${C.line2}"/>`,
      svg.text(card.case, { x: 14, y: 22, size: 9.5, font: 'mono', fill: C.dim, ls: 0.04 }).svg,
      `<circle cx="129" cy="19" r="2.5" fill="${C.acc}"/>`,
      svg.text(card.title, { x: 14, y: 45, size: titleSize, font: 'sansBold', fill: C.text, ls: -0.01 }).svg,
      `<line x1="14" y1="58.5" x2="130" y2="58.5" stroke="${C.line2}"/>`,
      svg.text(card.meta, { x: 14, y: 77, size: 9, font: 'mono', fill: C.dim }).svg,
    ];
    bars.forEach((bw, j) => {
      const y = 90 + j * 14;
      if (card.secret) parts.push(svg.text(card.secret[j], { x: 14, y: y + 7, size: 8.5, font: 'mono', fill: C.accSoft }).svg);
      const cls = card.secret ? ` class="bar" style="animation-delay:${3.2 + j * 0.12}s"` : '';
      parts.push(`<rect${cls} x="14" y="${y}" width="${bw}" height="8" rx="1" fill="${C.text}" opacity="0.88"/>`);
    });
    if (card.secret) {
      // CTF 01: this bar never lifts, but the text under it is still in the file.
      parts.push(
        `<text id="redacted" x="14" y="139.5" textLength="114" lengthAdjust="spacingAndGlyphs" font-family="ui-monospace,monospace" font-size="7" fill="${C.accSoft}">${esc(FLAG_01)}</text>`,
        `<rect x="13" y="132" width="118" height="10" rx="1" fill="${C.text}"/>`,
      );
    }
    const st = stamp(svg, card.stamp, 14, 156, { rotate: -5 });
    parts.push(`<g class="thunk" style="animation-delay:${2.7 + i * 0.18}s">${st.svg}</g>`);

    svg.add(
      `<g class="deal" style="animation-delay:${0.9 + i * 0.16}s">`,
      `<g class="float" style="animation-delay:${-i * 2}s">`,
      `<g transform="translate(${p.cx - cw / 2} ${p.cy - ch / 2}) rotate(${p.rot} ${cw / 2} ${ch / 2})">${parts.join('')}</g>`,
      '</g></g>',
    );
  });

  // Log ticker along the bottom, like the site's scrolling evidence feed.
  svg.add(`<line x1="0" y1="380.5" x2="880" y2="380.5" stroke="${C.line}"/>`);
  let tx = 0;
  const entries = profile.ticker.map(([key, rest], i) => {
    const run = svg.runs(
      [
        { t: String(i).padStart(3, '0') + '  ', fill: C.faint },
        { t: key + '  ', fill: C.muted },
        { t: rest, fill: C.dim },
      ],
      { x: tx, y: 0, size: 11.5, font: 'mono' },
    );
    tx += run.width + 44;
    return run.svg;
  });
  const loopW = Math.round(tx);
  svg.css.push(`@keyframes tick{to{transform:translateX(-${loopW}px)}}`);
  svg.add(
    `<g transform="translate(40 415)"><g class="tick" style="--d:${Math.round(loopW / 32)}s">`,
    `<g>${entries.join('')}</g><g transform="translate(${loopW} 0)">${entries.join('')}</g>`,
    '</g></g>',
  );
  svg.defs.push(
    `<linearGradient id="fadeL"><stop offset="0" stop-color="${C.bg}"/><stop offset="1" stop-color="${C.bg}" stop-opacity="0"/></linearGradient>`,
    `<linearGradient id="fadeR"><stop offset="0" stop-color="${C.bg}" stop-opacity="0"/><stop offset="1" stop-color="${C.bg}"/></linearGradient>`,
  );
  svg.add(`<rect x="0" y="382" width="80" height="58" fill="url(#fadeL)"/>`, `<rect x="800" y="382" width="80" height="58" fill="url(#fadeR)"/>`);

  panelEnd(svg);
  svg.save('hero.svg');
}

/* ---------------------------------------------------------------- pills */

function pill(name, label, { primary = false, arrow = true } = {}) {
  const t = measure(label, 'mono', 13);
  const w = Math.ceil(18 + t + (arrow ? 10 + 9 : 0) + 18);
  const svg = new Svg(w, 38, label);
  svg.add(
    `<rect x="0.5" y="0.5" width="${w - 1}" height="37" rx="18.5" fill="${primary ? C.accInk : C.s1}" stroke="${primary ? C.acc : C.line2}"/>`,
    svg.text(label, { x: 18, y: 23.5, size: 13, font: 'mono', fill: primary ? C.text : C.muted }).svg,
  );
  if (arrow) svg.add(icon(ICON.northEast, 18 + t + 10, 14, primary ? C.acc : C.dim, 1.4));
  svg.save(`${name}.svg`);
}

/* ------------------------------------------------------- section headers */

function header(name, index, title, rest) {
  const svg = new Svg(880, 76, `${index} ${title} ${rest}`);
  panelStart(svg, { rx: 16 });
  svg.add(svg.text(index, { x: 32, y: 46, size: 12, font: 'monoMed', fill: C.acc, ls: 0.06 }).svg);
  svg.add(
    svg.runs(
      [
        { t: title + ' ', fill: C.text, font: 'sansBold' },
        { t: rest, fill: C.dim, font: 'sans' },
      ],
      { x: 66, y: 47, size: 22, ls: -0.02 },
    ).svg,
  );
  panelEnd(svg, { rx: 16 });
  svg.save(`${name}.svg`);
}

/* --------------------------------------------------------- risk profile */

function riskProfile() {
  const kpis = [
    { value: String(data.repos), label: 'public repos' },
    { value: String(data.contributions), label: `contributions in ${data.year}` },
    ...profile.manualKpis,
  ];
  const svg = new Svg(880, 344, `Risk profile: ${kpis.map((k) => `${k.value} ${k.label}`).join(', ')}.`);
  svg.css.push(
    '.roll{animation:roll 1.8s cubic-bezier(.16,1,.3,1) both}',
    '@keyframes roll{from{transform:translateY(0)}}',
    '.grow{transform-box:fill-box;transform-origin:left center;animation:grow 1s cubic-bezier(.2,.8,.2,1) both}',
    '@keyframes grow{from{transform:scaleX(0)}}',
    '.draw{animation:draw 2.4s cubic-bezier(.45,0,.2,1) .8s both}',
    '@keyframes draw{from{stroke-dashoffset:1}}',
    '.fade{animation:fade 1s ease 2.6s both}',
    '@keyframes fade{from{opacity:0}}',
    '.pulse{transform-box:fill-box;transform-origin:center;animation:pulse 2s ease-out infinite}',
    '@keyframes pulse{from{opacity:.7;transform:scale(1)}to{opacity:0;transform:scale(3.2)}}',
  );
  panelStart(svg, { glow: { cx: 880, cy: 0, rx: 420, ry: 200 } });

  svg.add(
    svg.runs(
      [
        { t: '$ ', fill: C.acc },
        { t: 'cat ', fill: C.text },
        { t: 'risk_profile.json', fill: C.muted },
      ],
      { x: 40, y: 48, size: 13, font: 'mono' },
    ).svg,
  );
  const upd = svg.text(`updated ${data.updated}`, { x: 840, y: 48, size: 11, font: 'mono', fill: C.dim, anchor: 'end' });
  svg.add(
    upd.svg,
    `<circle cx="${r(upd.x - 12)}" cy="44" r="3" fill="${C.acc}"/>`,
    `<circle class="pulse" cx="${r(upd.x - 12)}" cy="44" r="3" fill="${C.acc}"/>`,
    `<line x1="40" y1="70.5" x2="840" y2="70.5" stroke="${C.line}"/>`,
  );

  // KPI odometers: each digit is a 0-9 strip that rolls to its value.
  const base = 142;
  const size = 50;
  const lh = 64;
  const cell = Math.max(...'0123456789'.split('').map((d) => measure(d, 'sansBold', size)));
  kpis.forEach((k, col) => {
    const x0 = 40 + col * 205;
    if (col) svg.add(`<line x1="${x0 - 22.5}" y1="96" x2="${x0 - 22.5}" y2="174" stroke="${C.line}"/>`);
    svg.defs.push(`<clipPath id="k${col}"><rect x="${x0}" y="${base - 44}" width="${r(cell * k.value.length + 4)}" height="56"/></clipPath>`);
    const strips = k.value.split('').map((ch, i) => {
      const d = Number(ch);
      const digits = Array.from({ length: 10 }, (_, n) => {
        const dw = measure(String(n), 'sansBold', size);
        return svg.text(String(n), { x: x0 + i * cell + (cell - dw) / 2, y: base + n * lh, size, font: 'sansBold', fill: C.text }).svg;
      }).join('');
      return `<g class="roll" style="transform:translateY(-${d * lh}px);animation-delay:${(0.3 + col * 0.15 + i * 0.09).toFixed(2)}s">${digits}</g>`;
    });
    svg.add(`<g clip-path="url(#k${col})">${strips.join('')}</g>`);
    svg.add(svg.text(k.label, { x: x0, y: 168, size: 11, font: 'mono', fill: C.dim }).svg);
  });

  svg.add(`<line x1="40" y1="198.5" x2="840" y2="198.5" stroke="${C.line}"/>`);

  // Stack bar.
  svg.add(svg.text('stack · primary language by repo', { x: 40, y: 230, size: 11, font: 'mono', fill: C.dim }).svg);
  const langColors = [C.acc, C.text, C.muted, C.dim, C.faint];
  const total = data.languages.reduce((s, l) => s + l.count, 0);
  const barW = 380;
  let bx = 40;
  data.languages.forEach((l, i) => {
    const w = (barW - 3 * (data.languages.length - 1)) * (l.count / total);
    svg.add(`<rect class="grow" style="animation-delay:${(0.6 + i * 0.12).toFixed(2)}s" x="${r(bx)}" y="244" width="${r(w)}" height="8" rx="2" fill="${langColors[i]}"/>`);
    bx += w + 3;
  });
  let lx = 40;
  data.languages.forEach((l, i) => {
    svg.add(`<rect x="${r(lx)}" y="273" width="7" height="7" rx="1.5" fill="${langColors[i]}"/>`);
    const t = svg.runs(
      [
        { t: l.name + ' ', fill: C.muted },
        { t: String(l.count), fill: C.dim },
      ],
      { x: lx + 12, y: 281, size: 11, font: 'mono' },
    );
    svg.add(t.svg);
    lx += 12 + t.width + 16;
  });

  // Contribution signal, drawn like a monitoring trace.
  svg.add(svg.text(`signal · contributions, last ${data.daily.length} days`, { x: 460, y: 230, size: 11, font: 'mono', fill: C.dim }).svg);
  const gx = 460;
  const gw = 380;
  const gTop = 248;
  const gBot = 300;
  const max = Math.max(...data.daily);
  const pts = data.daily.map((v, i) => [gx + (gw * i) / (data.daily.length - 1), gBot - ((gBot - gTop) * v) / max]);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${r(x)} ${r(y)}`).join('');
  svg.defs.push(
    `<linearGradient id="area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.acc}" stop-opacity="0.28"/><stop offset="1" stop-color="${C.acc}" stop-opacity="0"/></linearGradient>`,
  );
  [gTop, (gTop + gBot) / 2].forEach((y) => svg.add(`<line x1="${gx}" y1="${y}" x2="${gx + gw}" y2="${y}" stroke="${C.line}" stroke-dasharray="2 4"/>`));
  svg.add(`<line x1="${gx}" y1="${gBot + 0.5}" x2="${gx + gw}" y2="${gBot + 0.5}" stroke="${C.line2}"/>`);
  svg.add(`<path class="fade" d="${line}L${gx + gw} ${gBot}L${gx} ${gBot}Z" fill="url(#area)"/>`);
  svg.add(`<path class="draw" d="${line}" pathLength="1" stroke-dasharray="1" fill="none" stroke="${C.acc}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>`);
  const peakI = data.daily.indexOf(max);
  const [px, py] = pts[peakI];
  svg.add(
    `<g class="fade"><circle cx="${r(px)}" cy="${r(py)}" r="3" fill="${C.bg}" stroke="${C.acc}" stroke-width="1.5"/>`,
    svg.text(`peak ${max}`, { x: px - 8, y: py + 4, size: 10, font: 'mono', fill: C.muted, anchor: 'end' }).svg,
    '</g>',
  );

  svg.add(`<line x1="40" y1="306.5" x2="840" y2="306.5" stroke="${C.line}"/>`);
  svg.add(
    svg.runs(
      [
        { t: 'frameworks  ', fill: C.dim },
        { t: profile.frameworks, fill: C.faint },
      ],
      { x: 40, y: 330, size: 11, font: 'mono' },
    ).svg,
  );

  panelEnd(svg);
  svg.save('risk-profile.svg');
}

/* ----------------------------------------------------------- case files */

function caseFile(c, i) {
  const svg = new Svg(430, 206, `Case ${c.no}: ${c.title}. ${c.desc}`);
  svg.css.push(
    '.bar{transform-box:fill-box;transform-origin:right center;animation:declass 1.3s cubic-bezier(.7,0,.2,1) both}',
    '@keyframes declass{from{transform:scaleX(1)}}',
    '.bar{transform:scaleX(0)}',
    '.scan{animation:scan 1.3s ease-in-out both}',
    '@keyframes scan{from{transform:translateY(0);opacity:.9}to{transform:translateY(64px);opacity:0}}',
  );
  panelStart(svg, { rx: 16 });

  svg.add(
    svg.runs(
      [
        { t: `CASE ${c.no}`, fill: C.dim },
        { t: `  ·  ${c.lang}`, fill: C.faint },
      ],
      { x: 24, y: 36, size: 11, font: 'mono', ls: 0.02 },
    ).svg,
  );
  const open = c.stamp === 'OPEN';
  const st = stamp(svg, c.stamp, 0, 0, { color: open ? C.dim : C.acc, rotate: 0, size: 9.5 });
  svg.add(`<g transform="translate(${r(406 - st.width)} 21)">${st.svg}</g>`);

  const titleSize = Math.min(22, (22 * 382) / measure(c.title, 'sansBold', 22, -0.02));
  svg.add(svg.text(c.title, { x: 24, y: 76, size: titleSize, font: 'sansBold', fill: C.text, ls: -0.02 }).svg);

  const lines = wrap(c.desc, 380, 'sans', 14);
  if (lines.length > 2) throw new Error(`case ${c.slug}: description needs ${lines.length} lines, cards fit 2`);
  const delay = 0.5 + i * 0.25;
  lines.forEach((l, j) => {
    const y = 104 + j * 21;
    const t = svg.text(l, { x: 24, y, size: 14, font: 'sans', fill: C.muted });
    svg.add(t.svg, `<rect class="bar" style="animation-delay:${(delay + j * 0.1).toFixed(2)}s" x="23" y="${y - 12}" width="${r(t.width + 3)}" height="15" rx="1.5" fill="${C.text}" opacity="0.9"/>`);
  });
  svg.add(`<rect class="scan" style="animation-delay:${delay.toFixed(2)}s" x="16" y="88" width="398" height="1.5" fill="${C.acc}"/>`);

  svg.add(`<line x1="24" y1="152.5" x2="406" y2="152.5" stroke="${C.line}"/>`);
  svg.add(svg.text(c.tags, { x: 24, y: 180, size: 11, font: 'mono', fill: C.dim }).svg);
  svg.add(icon(ICON.northEast, 396, 171, C.acc, 1.5));

  panelEnd(svg, { rx: 16 });
  svg.save(`case-${c.slug}.svg`);
}

/* ---------------------------------------------------------- field notes */

function note(post, i) {
  const svg = new Svg(880, 64, `${post.source}: ${post.title}`);
  svg.css.push(
    '.rise{animation:rise .8s cubic-bezier(.2,.7,.2,1) both}',
    '@keyframes rise{from{opacity:0;transform:translateX(-14px)}}',
  );
  panelStart(svg, { rx: 14 });
  const date = new Date(post.date)
    .toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Europe/Dublin' })
    .toUpperCase();
  const st = stamp(svg, post.source.toUpperCase(), 0, 0, { color: i === 0 ? C.acc : C.dim, rotate: 0, size: 9.5 });
  const title = ellipsize(tidy(post.title, 'sansMed'), 590, 'sansMed', 17);
  svg.add(
    `<g class="rise" style="animation-delay:${(0.2 + i * 0.12).toFixed(2)}s">`,
    svg.text(date, { x: 28, y: 37, size: 11, font: 'mono', fill: C.dim, ls: 0.04 }).svg,
    `<g transform="translate(132 21)">${st.svg}</g>`,
    svg.text(title, { x: 222, y: 38, size: 17, font: 'sansMed', fill: C.text, ls: -0.01 }).svg,
    icon(ICON.northEast, 842, 27, C.acc, 1.5),
    '</g>',
  );
  panelEnd(svg, { rx: 14 });
  svg.save(`note-${i + 1}.svg`);
}

/* ------------------------------------------------------------------ ctf */

function ctfConsole() {
  const { challenges } = profile.ctf;
  const top = rankPlayers(challenges, ctfState.solves).slice(0, 3);
  const x = 28;
  const y0 = 88;
  const lh = 27;
  const size = 14;
  const charW = measure('0', 'mono', size);
  const lineCount = 1 + challenges.length + 1 + 1 + Math.max(1, top.length) + 1 + 1;
  const lastY = y0 + (lineCount - 1) * lh;
  const svg = new Svg(
    880,
    lastY + 34,
    `CTF console. ${challenges.length} challenges. ${top.length ? `Leader: @${top[0].player} with ${top[0].points} points.` : 'No captures yet, first blood is open.'}`,
  );
  svg.css.push(
    '.ln{animation:ln .01s steps(1) both}',
    '@keyframes ln{from{opacity:0}}',
    '.blink{animation:blink 1.1s steps(1) infinite}',
    '@keyframes blink{50%{opacity:0}}',
    '.pulse{transform-box:fill-box;transform-origin:center;animation:pulse 2s ease-out infinite}',
    '@keyframes pulse{from{opacity:.7;transform:scale(1)}to{opacity:0;transform:scale(3.2)}}',
  );
  panelStart(svg, { rx: 16 });

  svg.add(`<rect width="880" height="44" fill="${C.s2}"/>`, `<line x1="0" y1="44.5" x2="880" y2="44.5" stroke="${C.line2}"/>`);
  [24, 42, 60].forEach((cx) => svg.add(`<circle cx="${cx}" cy="22" r="5" fill="${C.line2}"/>`));
  svg.add(svg.text('mmh@galway-bastion: ~/ctf', { x: 440, y: 26, size: 12, font: 'mono', fill: C.dim, anchor: 'middle' }).svg);
  const live = svg.text('live', { x: 852, y: 26, size: 11, font: 'mono', fill: C.dim, anchor: 'end' });
  svg.add(live.svg, `<circle cx="${r(live.x - 11)}" cy="22" r="3" fill="${C.acc}"/>`, `<circle class="pulse" cx="${r(live.x - 11)}" cy="22" r="3" fill="${C.acc}"/>`);

  const prompt = (cmd, y) => svg.runs([{ t: '$ ', fill: C.acc }, { t: cmd, fill: C.text }], { x, y, size, font: 'mono' });
  // A label, dot leaders, a value ending at x=640 and a status ending at x=852.
  const row = (head, value, status, statusFill, y) => {
    const h = svg.runs(head, { x, y, size, font: 'mono' });
    const v = svg.text(value, { x: 640, y, size, font: 'mono', fill: C.text, anchor: 'end' });
    const dots = Math.max(3, Math.floor((v.x - (x + h.width)) / charW) - 1);
    return h.svg + svg.text('.'.repeat(dots), { x: x + h.width, y, size, font: 'mono', fill: C.faint }).svg + v.svg + svg.text(status, { x: 852, y, size: 12, font: 'mono', fill: statusFill, anchor: 'end' }).svg;
  };

  const rows = [prompt('./ctf --status', y0).svg];
  challenges.forEach((c, i) => {
    const n = ctfState.solves.filter((s) => s.id === c.id).length;
    rows.push(
      row(
        [{ t: '[ ', fill: C.dim }, { t: c.id, fill: C.acc }, { t: ' ] ', fill: C.dim }, { t: `${c.name} `, fill: C.muted }],
        `${c.points} pts`,
        n ? `${n} capture${n === 1 ? '' : 's'}` : 'first blood open',
        n ? C.dim : C.acc,
        y0 + (i + 1) * lh,
      ),
    );
  });
  let y = y0 + (challenges.length + 2) * lh;
  rows.push(prompt('./ctf --top 3', y).svg);
  if (top.length) {
    top.forEach((p, i) => {
      y += lh;
      rows.push(row([{ t: `${String(i + 1).padStart(2, '0')}  `, fill: C.dim }, { t: `@${p.player} `, fill: C.muted }], `${p.points} pts`, `${p.flags}/${challenges.length} flags`, C.dim, y));
    });
  } else {
    y += lh;
    rows.push(svg.text('   the board is empty. be the first name on it.', { x, y, size, font: 'mono', fill: C.dim }).svg);
  }
  const last = prompt('find a flag, hash it, submit it', lastY);
  rows.push(last.svg + `<rect class="blink" x="${r(x + last.width + 6)}" y="${lastY - 13}" width="8" height="16" fill="${C.acc}"/>`);

  rows.forEach((markup, i) => svg.add(`<g class="ln" style="animation-delay:${(0.4 + i * 0.22).toFixed(2)}s">${markup}</g>`));
  panelEnd(svg, { rx: 16 });
  svg.save('ctf.svg');
}

function key(name, label, { glyph = null, accent = false } = {}) {
  const tw = measure(label, 'mono', 13);
  const gw = glyph ? 12 + 9 : 0;
  const w = Math.ceil(20 + gw + tw + 20);
  const svg = new Svg(w, 50, label);
  svg.add(
    `<rect x="0" y="5" width="${w}" height="44" rx="10" fill="#070806"/>`,
    `<rect x="0.5" y="0.5" width="${w - 1}" height="44" rx="9.5" fill="${accent ? C.accInk : C.s2}" stroke="${accent ? C.acc : C.line2}"/>`,
  );
  if (glyph) svg.add(icon(ICON[glyph], 20, 16.5, accent ? C.acc : C.muted, 1.6));
  svg.add(svg.text(label, { x: 20 + gw, y: 27, size: 13, font: 'mono', fill: accent ? C.accSoft : C.text }).svg);
  svg.save(`${name}.svg`);
}

/* --------------------------------------------------------------- footer */

function footer() {
  const svg = new Svg(880, 160, 'Send me something worth encrypting.');
  svg.css.push(
    '.shackle{animation:shackle .5s cubic-bezier(.5,0,.3,1.5) 1.2s both}',
    '@keyframes shackle{from{transform:translateY(-9px)}}',
    '.glint{animation:glint .6s ease 1.65s both}',
    '@keyframes glint{from{opacity:0}}',
  );
  panelStart(svg, { glow: { cx: 120, cy: 200, rx: 420, ry: 160 } });
  svg.add(svg.text('Send me something worth encrypting.', { x: 40, y: 78, size: 30, font: 'sansBold', fill: C.text, ls: -0.025 }).svg);
  svg.add(
    svg.runs(
      [
        { t: '$ ', fill: C.acc },
        { t: 'open ', fill: C.text },
        { t: 'muhammadmurtuza.com/#contact', fill: C.muted },
      ],
      { x: 40, y: 116, size: 13, font: 'mono' },
    ).svg,
  );
  // A padlock that clicks shut.
  svg.add(
    '<g transform="translate(776 46)">',
    `<path class="shackle" d="M12 30V20a14 14 0 0 1 28 0v10" fill="none" stroke="${C.muted}" stroke-width="3" stroke-linecap="round"/>`,
    `<rect x="4" y="30" width="44" height="36" rx="7" fill="${C.s2}" stroke="${C.muted}" stroke-width="2"/>`,
    `<g class="glint"><circle cx="26" cy="45" r="4" fill="${C.acc}"/><rect x="24.5" y="46" width="3" height="9" rx="1.5" fill="${C.acc}"/></g>`,
    '</g>',
  );
  panelEnd(svg);
  svg.save('footer.svg');
}

/* ------------------------------------------------------------------ run */

// The CTF 01 flag lives only in hero.svg and the CTF_FLAGS secret. Local
// builds without the secret carry it over from the existing hero.svg.
function declassified() {
  if (process.env.CTF_FLAGS) return JSON.parse(process.env.CTF_FLAGS)['01'];
  const prev = path.join(outDir, 'hero.svg');
  const match = fs.existsSync(prev) && fs.readFileSync(prev, 'utf8').match(/<text id="redacted"[^>]*>([^<]*)<\/text>/);
  if (match) return match[1];
  throw new Error('Set CTF_FLAGS: assets/hero.svg has no flag to carry over');
}
const FLAG_01 = declassified();

fs.mkdirSync(outDir, { recursive: true });
for (const file of fs.readdirSync(outDir)) if (file.endsWith('.svg')) fs.unlinkSync(path.join(outDir, file));

hero();
pill('link-site', 'muhammadmurtuza.com', { primary: true });
pill('link-linkedin', 'LinkedIn');
pill('link-dev', 'DEV');
pill('link-medium', 'Medium');
pill('link-youtube', 'YouTube');
pill('link-call', 'Book a call');
pill('link-all', `all ${data.repos} case files`);
header('h-risk', '02', 'Risk profile.', 'Numbers that update themselves.');
header('h-cases', '03', 'Case files.', 'Open one, they all run.');
header('h-notes', '04', 'Field notes.', 'Refreshed daily from DEV and Medium.');
header('h-ctf', '05', './ctf', 'Four flags are hidden in this profile.');
riskProfile();
profile.cases.forEach(caseFile);
data.posts.forEach(note);
ctfConsole();
key('key-brief', 'briefing', { glyph: 'right' });
key('key-hints', '? hints');
key('key-submit', 'submit flag', { glyph: 'enter', accent: true });
key('key-board', 'scoreboard', { glyph: 'flag' });
footer();
