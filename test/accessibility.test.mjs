// Accessibility regression tests for the generated page.
// These exercise render(), validate(), the stylesheet, and the build CLI without
// a browser. Assertions parse tags, attributes, and CSS declarations rather than
// matching exact markup, so attribute order, declaration order, whitespace, and
// sample-client copy can change without breaking them, while the accessible
// behavior (names, references, contrast, focus, hiding) is still enforced.
// Behaviors already asserted in build.test.mjs (video aria-labels, iframe
// title/focus, thumbnail alt="", the heroImageAlt validation case, preview
// banner ordering, FAQ count) are intentionally not repeated.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, cp, mkdir, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { validate, ink, whiteContrast } from '../scripts/validate.mjs';
import { render } from '../scripts/render.mjs';
import { root } from '../scripts/build.mjs';

const sample = JSON.parse(await readFile(path.join(root, 'clients/acme-roofing.json')));
const copy = () => structuredClone(sample);
const css = await readFile(path.join(root, 'src/styles.css'), 'utf8');
const script = await readFile(path.join(root, 'src/script.js'), 'utf8');
const images = { hero: 'images/hero.webp', logo: 'images/logo.png' };

// --- HTML helpers ----------------------------------------------------------------
// A small tokenizer-based DOM (no dependencies). It follows the HTML syntax that
// matters for attribute and reference checks: double-, single- and unquoted
// values, whitespace around "=", case-insensitive tag/attribute names, first
// duplicate attribute wins, comments and the doctype are skipped, <script> and
// <style> hold raw text, void and self-closing elements have no children.
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const RAW = new Set(['script', 'style']);
const TOKEN = /<!--[\s\S]*?-->|<![^>]*>|<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
const ATTRIBUTE = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
const parseAttributes = source => {
  const attributes = {};
  for (const match of source.matchAll(ATTRIBUTE)) { const name = match[1].toLowerCase(); if (!(name in attributes)) attributes[name] = match[2] ?? match[3] ?? match[4] ?? ''; }
  return attributes;
};
function parseHTML(html) {
  const document = { name: '#document', attributes: {}, children: [], all: [], byId: new Map() };
  const stack = [];
  const parent = () => stack[stack.length - 1] ?? document;
  const finish = (node, end) => { node.end = end; node.inner = html.slice(node.innerStart, end); };
  let last = 0;
  const token = new RegExp(TOKEN.source, 'g');
  for (let match; (match = token.exec(html));) {
    if (match.index > last) parent().children.push(html.slice(last, match.index));
    last = token.lastIndex;
    if (match[2] === undefined) continue; // comment or doctype
    const name = match[2].toLowerCase();
    if (match[1]) {
      const index = stack.findLastIndex(node => node.name === name);
      if (index === -1) continue; // stray closing tag
      while (stack.length > index) finish(stack.pop(), match.index);
      continue;
    }
    const node = { name, attributes: parseAttributes(match[3]), tag: match[0], children: [], start: match.index, innerStart: last, parent: parent(), document, inNoscript: stack.some(ancestor => ancestor.name === 'noscript') };
    parent().children.push(node);
    document.all.push(node);
    if ('id' in node.attributes && !node.inNoscript && !document.byId.has(node.attributes.id)) document.byId.set(node.attributes.id, node);
    if (VOID.has(name) || /\/\s*>$/.test(match[0])) { finish(node, last); continue; }
    if (RAW.has(name)) {
      const close = html.indexOf(`</${name}`, last);
      const end = close === -1 ? html.length : close;
      node.children.push(html.slice(last, end));
      finish(node, end);
      token.lastIndex = last = end;
      continue;
    }
    stack.push(node);
  }
  if (last < html.length) parent().children.push(html.slice(last));
  while (stack.length) finish(stack.pop(), html.length);
  return document;
}
const documents = new Map();
const dom = html => { if (!documents.has(html)) documents.set(html, parseHTML(html)); return documents.get(html); };
const descendants = node => node.children.flatMap(child => typeof child === 'string' ? [] : [child, ...descendants(child)]);
// Elements by name (string or array) in document order; each node has tag, attributes, inner, children.
const elements = (html, names) => { const wanted = [].concat(names); return dom(html).all.filter(node => wanted.includes(node.name)); };
const decode = value => value.replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16))).replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code))).replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const normalise = value => decode(value).replace(/\s+/g, ' ').trim();
const rawText = node => node.children.map(child => typeof child === 'string' ? child : RAW.has(child.name) ? '' : rawText(child)).join('');
const text = node => normalise(rawText(node));
// Text contribution to an accessible name: aria-hidden subtrees are skipped, images contribute their alt.
const nameText = node => node.attributes['aria-hidden'] === 'true' || RAW.has(node.name) ? '' : node.name === 'img' ? ` ${node.attributes.alt ?? ''} ` : node.children.map(child => typeof child === 'string' ? child : nameText(child)).join('');
const tokens = value => (value ?? '').trim().split(/\s+/).filter(Boolean);
// Approximate accessible name: aria-labelledby targets, then aria-label, then content.
const accessibleName = node => {
  const referenced = tokens(node.attributes['aria-labelledby']).map(id => node.document.byId.get(id)).filter(Boolean).map(target => target.attributes['aria-label']?.trim() || normalise(nameText(target))).filter(Boolean);
  if (referenced.length) return referenced.join(' ');
  return node.attributes['aria-label']?.trim() || normalise(nameText(node));
};
// ids that are present in the scripting-enabled DOM (noscript content is excluded) and all ids for uniqueness checks.
const idsOf = html => dom(html).all.filter(node => 'id' in node.attributes && !node.inNoscript).map(node => node.attributes.id);
// Attributes whose values are ID references; IDREFS allow a space-separated list, IDREF exactly one.
const IDREFS = ['aria-labelledby', 'aria-describedby', 'aria-controls', 'aria-owns', 'aria-flowto', 'aria-details', 'aria-errormessage', 'headers'];
const IDREF = ['aria-activedescendant', 'for', 'form', 'list'];
const focusable = node => !('disabled' in node.attributes) && Number(node.attributes.tabindex ?? 0) >= 0 && (
  (node.name === 'a' && 'href' in node.attributes) || ['button', 'input', 'select', 'textarea', 'summary', 'iframe'].includes(node.name)
  || (node.name === 'video' && 'controls' in node.attributes) || 'tabindex' in node.attributes);

// --- CSS helpers -----------------------------------------------------------------
// A minimal stylesheet parser (no dependencies). It understands strings and url()
// (braces/semicolons inside them are literal), CSS nesting with "&", conditional
// group rules (@media/@container, whose conditions accumulate), transparent
// grouping rules (@layer/@supports/@scope), statement at-rules (@import), and
// "!important". Non-style at-rules (@font-face, @keyframes, @page, @property)
// are skipped. Malformed braces raise a descriptive error instead of hanging.
const stripComments = source => source.replace(/\/\*[\s\S]*?\*\//g, '');
const skipString = (source, index) => { const quote = source[index++]; while (index < source.length && source[index] !== quote) index += source[index] === '\\' ? 2 : 1; return index + 1; };
// Split on a separator at nesting depth 0, ignoring strings, parentheses, brackets, and braces.
function splitTop(source, separator) {
  const parts = [];
  let depth = 0, start = 0;
  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    if (character === '"' || character === "'") { index = skipString(source, index) - 1; continue; }
    if ('([{'.includes(character)) depth++;
    else if (')]}'.includes(character)) depth--;
    else if (character === separator && depth === 0) { parts.push(source.slice(start, index)); start = index + 1; }
  }
  parts.push(source.slice(start));
  return parts;
}
// Separate a block body into declaration text and nested { } blocks with their preludes.
function scanBlocks(source) {
  const blocks = [];
  let text = '', segment = 0;
  // "@layer a, b;" and similar statements are kept in source order as blocks with a null body.
  const pushStatements = chunk => { for (const part of splitTop(chunk, ';')) if (part.trim().startsWith('@')) blocks.push({ prelude: part.trim(), body: null }); };
  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    if (character === '"' || character === "'") { index = skipString(source, index) - 1; continue; }
    if (character === '}') throw new Error(`stylesheet has a stray "}" near: ${source.slice(Math.max(0, index - 40), index + 1).trim()}`);
    if (character !== '{') continue;
    const before = source.slice(segment, index);
    const statement = before.lastIndexOf(';');
    text += before.slice(0, statement + 1);
    pushStatements(before.slice(0, statement + 1));
    const prelude = before.slice(statement + 1).trim();
    let depth = 1, end = index + 1;
    while (end < source.length && depth) {
      const inner = source[end];
      if (inner === '"' || inner === "'") { end = skipString(source, end); continue; }
      if (inner === '{') depth++; else if (inner === '}') depth--;
      end++;
    }
    if (depth) throw new Error(`stylesheet has an unclosed "{" for: ${prelude || '(anonymous block)'}`);
    blocks.push({ prelude, body: source.slice(index + 1, end - 1) });
    index = end - 1;
    segment = end;
  }
  pushStatements(source.slice(segment));
  return { text: text + source.slice(segment), blocks };
}
function parseDeclarations(text) {
  const declarations = {}, important = new Set();
  for (const part of splitTop(text, ';')) {
    const colon = part.indexOf(':');
    if (colon === -1) continue;
    let property = part.slice(0, colon).trim();
    if (!property.startsWith('--')) property = property.toLowerCase();
    let value = part.slice(colon + 1).trim();
    if (/!\s*important$/i.test(value)) { value = value.replace(/\s*!\s*important$/i, ''); important.add(property); } else important.delete(property);
    declarations[property] = value;
  }
  return { declarations, important };
}
const normaliseSelector = selector => {
  let out = '', depth = 0;
  for (const character of selector) {
    if (character === '(' || character === '[') depth++; else if (character === ')' || character === ']') depth--;
    out += depth === 0 && '>+~'.includes(character) ? ` ${character} ` : character;
  }
  return out.replace(/\s+/g, ' ').trim();
};
// --- conditional group rules -----------------------------------------------------
// A condition segment is one "@media …" or "@container …" or "@supports …" prelude; nested
// segments accumulate. Media queries are only evaluated as far as needed: print-only
// segments never apply on screen, trivially-true ones (screen, all, (min-width: 0)) are
// dropped, and everything else is a distinct context in which guarantees must still hold.
const mediaQueries = segment => splitTop(segment.replace(/^@media\s*/i, ''), ',').map(query => query.replace(/\s+/g, ' ').trim().toLowerCase());
const isPrintQuery = query => /^(?:only\s+)?print(?:\s+and\b.*)?$/.test(query);
const isTrueQuery = query => /^(?:only\s+)?(?:screen|all)$/.test(query) || /^(?:(?:only\s+)?(?:screen|all)\s+and\s+)?\(\s*min-width\s*:\s*0(?:px|rem|em)?\s*\)$/.test(query);
const isMediaSegment = segment => /^@media\b/i.test(segment);
const printOnly = conditions => conditions.some(segment => isMediaSegment(segment) && mediaQueries(segment).every(isPrintQuery));
// Does a query (not negated) test a feature for a value? e.g. feature('(prefers-reduced-motion: reduce)', 'prefers-reduced-motion', 'reduce')
const queryHas = (query, feature, value) => !/^not\b/.test(query) && new RegExp(`\\(\\s*${feature}\\s*:\\s*${value}\\s*\\)`).test(query);
const queryNegates = (query, feature, value) => /^not\b/.test(query) && new RegExp(`\\(\\s*${feature}\\s*:\\s*${value}\\s*\\)`).test(query);
// Forced-colors mode replaces author colors with system colors, so contrast is not measurable (or author-controlled) there.
const forcedColors = conditions => conditions.filter(isMediaSegment).flatMap(mediaQueries).some(query => queryHas(query, 'forced-colors', 'active'));
// Width ranges for mobile-first composition: "(min-width: 600px)" => { min: 600 }.
const widthRange = segment => {
  if (!isMediaSegment(segment)) return null;
  const queries = mediaQueries(segment);
  if (queries.length !== 1) return null;
  const match = queries[0].match(/^(?:(?:only\s+)?(?:screen|all)\s+and\s+)?\(\s*(min|max)-width\s*:\s*([\d.]+)(px|rem|em)?\s*\)$/);
  return match ? { [match[1]]: lengthPx(`${match[2]}${match[3] ?? 'px'}`) } : null;
};
// Segment "have" being active implies segment "want" is active.
const implies = (have, want) => {
  if (have === want) return true;
  const a = widthRange(have), b = widthRange(want);
  if (!a || !b) return false;
  return (a.min !== undefined && b.min !== undefined && a.min >= b.min) || (a.max !== undefined && b.max !== undefined && a.max <= b.max);
};
const CONDITIONAL = new Set(['media', 'container', 'supports']);
const GROUPING = new Set(['layer', 'scope', 'starting-style']);
// Flattens a stylesheet into [{ selector, conditions, layer, print, index, declarations, important }] in source order.
function parseCSS(source) {
  const rules = [];
  const layerOrder = new Map();
  let anonymous = 0;
  const layerPath = (parent, names) => { const path = [...parent]; for (const name of names) { const key = [...path.map(String), name].join('/'); if (!layerOrder.has(key)) layerOrder.set(key, layerOrder.size); path.push(layerOrder.get(key)); } return path; };
  const add = ({ prelude, body }, parents, conditions, layer) => {
    if (body === null) { // statement: "@layer a, b;" declares layer order; @import/@charset carry nothing
      const statement = prelude.match(/^@layer\s+([^;]+)/i);
      if (statement) for (const name of splitTop(statement[1], ',')) layerPath(layer, name.trim().split('.'));
      return;
    }
    if (prelude.startsWith('@')) {
      const name = prelude.slice(1).match(/^[a-z-]+/i)?.[0].toLowerCase();
      if (!CONDITIONAL.has(name) && !GROUPING.has(name)) return; // @font-face, @keyframes, @page, @property …
      let inner = conditions, innerLayer = layer;
      if (CONDITIONAL.has(name)) {
        const segment = prelude.replace(/\s+/g, ' ');
        if (!(isMediaSegment(segment) && mediaQueries(segment).every(isTrueQuery))) inner = [...conditions, segment];
      } else if (name === 'layer') {
        const names = prelude.replace(/^@layer\s*/i, '').trim();
        innerLayer = layerPath(layer, names ? names.split('.') : [`<anonymous ${anonymous++}>`]);
      }
      const { text, blocks } = scanBlocks(body);
      if (parents.length && text.trim()) for (const selector of parents) rules.push({ selector, conditions: inner, layer: innerLayer, ...parseDeclarations(text) });
      for (const block of blocks) add(block, parents, inner, innerLayer);
      return;
    }
    const selectors = splitTop(prelude, ',').map(normaliseSelector).filter(Boolean)
      .flatMap(selector => parents.length ? parents.map(parent => selector.includes('&') ? selector.replace(/&/g, parent) : `${parent} ${selector}`) : [selector]);
    const { text, blocks } = scanBlocks(body);
    const parsed = parseDeclarations(text);
    for (const selector of selectors) rules.push({ selector, conditions, layer, ...parsed });
    for (const block of blocks) add(block, selectors, conditions, layer);
  };
  for (const block of scanBlocks(stripComments(source)).blocks) add(block, [], [], []);
  return rules.map((rule, index) => ({ ...rule, index, print: printOnly(rule.conditions) }));
}
const rules = parseCSS(css);
const screenRules = rules.filter(rule => !rule.print);
// Cascade layers: unlayered beats layered; later layers beat earlier; nested layers lose to their parent's own styles. !important reverses this.
const compareLayers = (a, b) => { for (let depth = 0; depth < Math.max(a.length, b.length); depth++) { const x = a[depth] ?? Infinity, y = b[depth] ?? Infinity; if (x !== y) return x < y ? -1 : 1; } return 0; };
const cascade = matching => {
  const merged = {};
  for (const rule of [...matching].sort((a, b) => compareLayers(a.layer, b.layer) || a.index - b.index)) for (const [property, value] of Object.entries(rule.declarations)) if (!rule.important.has(property)) merged[property] = value;
  for (const rule of [...matching].sort((a, b) => -compareLayers(a.layer, b.layer) || a.index - b.index)) for (const [property, value] of Object.entries(rule.declarations)) if (rule.important.has(property)) merged[property] = value;
  return merged;
};
// Every distinct conditional context the stylesheet defines, starting with the unconditional base.
const contexts = [...new Map(screenRules.map(rule => [rule.conditions.join(' and '), rule.conditions])).values()].sort((a, b) => a.length - b.length);
const contextLabel = context => context.length ? context.join(' and ') : 'base';
const activeIn = (rule, context) => !rule.print && rule.conditions.every(segment => context.some(active => implies(active, segment)));
const rulesFor = (selector, context = []) => screenRules.filter(rule => rule.selector === normaliseSelector(selector) && activeIn(rule, context));
// Cascaded declarations for one selector in a context (default: the unconditional base).
const declarations = (selector, context = []) => {
  const matching = rulesFor(selector, context);
  assert.ok(matching.length, `stylesheet has a rule for ${selector} (${contextLabel(context)})`);
  return cascade(matching);
};
const declared = (selector, property, context = []) => { const value = declarations(selector, context)[property]; assert.ok(value !== undefined, `${selector} declares ${property} (${contextLabel(context)})`); return value; };

// --- lengths ---------------------------------------------------------------------
const LENGTH_KEYWORDS = { thin: 1, medium: 3, thick: 5 };
const FONT_SIZE_KEYWORDS = { 'xx-small': 9, 'x-small': 10, small: 13, medium: 16, large: 18, 'x-large': 24, 'xx-large': 32, 'xxx-large': 48 };
// Resolve a length to px in a 16px context. Viewport, unknown, or unitless values are null.
// clamp() yields its lower bound when the preferred value cannot be resolved; calc() supports + and -.
function lengthPx(value, keywords = LENGTH_KEYWORDS) {
  value = String(value).trim().toLowerCase();
  if (value in keywords) return keywords[value];
  const call = value.match(/^(calc|min|max|clamp)\((.*)\)$/s);
  if (call) {
    const args = splitTop(call[2], ',').map(argument => argument.trim());
    if (call[1] === 'calc') {
      if (/[*/]/.test(args[0])) return null;
      let total = 0;
      for (const term of args[0].replace(/\s-\s/g, ' + -').split(/\s\+\s/)) { const px = lengthPx(term, keywords); if (px === null) return null; total += px; }
      return total;
    }
    const resolved = args.map(argument => lengthPx(argument, keywords));
    if (call[1] === 'min') return resolved.includes(null) ? null : Math.min(...resolved);
    if (call[1] === 'max') return resolved.includes(null) ? null : Math.max(...resolved);
    return resolved[0] === null || resolved[1] === null ? resolved[0] : Math.max(resolved[0], Math.min(resolved[1], resolved[2] ?? Infinity));
  }
  const single = value.match(/^(-?\d*\.?\d+)(px|rem|em|%)?$/);
  if (single) { const number = Number(single[1]); return single[2] === 'px' ? number : single[2] === 'rem' || single[2] === 'em' ? number * 16 : single[2] === '%' ? number * 0.16 : number === 0 ? 0 : null; }
  const parts = splitTop(value, ' ').filter(Boolean);
  if (parts.length > 1) for (const part of parts) { const px = lengthPx(part, keywords); if (px !== null) return px; }
  return null;
}

// --- colors and contrast ---------------------------------------------------------
const NAMED_COLORS = { white: '#ffffff', black: '#000000', red: '#ff0000', lime: '#00ff00', blue: '#0000ff', yellow: '#ffff00', cyan: '#00ffff', aqua: '#00ffff', magenta: '#ff00ff', fuchsia: '#ff00ff', silver: '#c0c0c0', gray: '#808080', grey: '#808080', maroon: '#800000', olive: '#808000', green: '#008000', purple: '#800080', teal: '#008080', navy: '#000080', orange: '#ffa500' };
const hexByte = number => Math.max(0, Math.min(255, Math.round(number))).toString(16).padStart(2, '0');
const hslToRgb = (hue, saturation, lightness) => {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = lightness - chroma / 2;
  const sector = Math.floor((((hue % 360) + 360) % 360) / 60);
  const [r, g, b] = [[chroma, x, 0], [x, chroma, 0], [0, chroma, x], [0, x, chroma], [x, 0, chroma], [chroma, 0, x]][sector];
  return [r, g, b].map(channel => (channel + m) * 255);
};
// One color token -> { hex, alpha }, or null for contextual values (currentcolor, var(), keywords).
function parseColor(token) {
  token = token.trim().toLowerCase();
  if (token === 'transparent') return { hex: '#000000', alpha: 0 };
  if (token in NAMED_COLORS) return { hex: NAMED_COLORS[token], alpha: 1 };
  const hex = token.match(/^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/);
  if (hex) { const digits = hex[1].length <= 4 ? [...hex[1]].map(digit => digit + digit).join('') : hex[1]; return { hex: `#${digits.slice(0, 6)}`, alpha: digits.length === 8 ? parseInt(digits.slice(6), 16) / 255 : 1 }; }
  const call = token.match(/^(rgba?|hsla?)\((.*)\)$/);
  if (!call) return null;
  const [channels, slashAlpha] = call[2].split('/');
  const parts = channels.split(/[\s,]+/).filter(Boolean);
  const number = part => part.endsWith('%') ? parseFloat(part) / 100 : parseFloat(part);
  let alpha = 1, values = parts;
  if (slashAlpha !== undefined) alpha = number(slashAlpha.trim());
  else if (parts.length === 4) { alpha = number(parts[3]); values = parts.slice(0, 3); }
  if (values.length !== 3 || values.some(part => Number.isNaN(parseFloat(part))) || Number.isNaN(alpha)) return null;
  const rgb = call[1].startsWith('rgb')
    ? values.map(part => part.endsWith('%') ? parseFloat(part) * 2.55 : parseFloat(part))
    : hslToRgb(parseFloat(values[0]), number(values[1]), number(values[2]));
  return { hex: `#${rgb.map(hexByte).join('')}`, alpha };
}
// Every color in a value, in order (handles shorthands such as border and box-shadow).
const colorsIn = value => [...String(value).matchAll(/#[0-9a-f]{3,8}\b|(?:rgba?|hsla?)\([^)]*\)|\b[a-z]+\b/gi)].map(match => parseColor(match[0])).filter(Boolean);
const opaqueColors = value => colorsIn(value).filter(color => color.alpha === 1).map(color => color.hex);
const declaredColor = (selector, property, context = []) => {
  const value = declared(selector, property, context);
  const [color] = colorsIn(value);
  assert.ok(color, `${selector} { ${property}: ${value} } must use a resolvable color`);
  assert.equal(color.alpha, 1, `${selector} { ${property}: ${value} } is translucent; its contrast depends on what is behind it`);
  return color.hex;
};
// Independent WCAG 2.x relative luminance and contrast ratio, deliberately not derived from production code.
const srgbToLinear = byte => { const channel = byte / 255; return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4; };
const relativeLuminance = hex => { const [r, g, b] = [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16)); return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b); };
const contrast = (a, b) => { const [light, dark] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x); return (light + 0.05) / (dark + 0.05); };
// Effective outline from the shorthand plus longhands: { width: px|null, style, color: {hex, alpha}|null } (only what is declared).
const outlineOf = declarations => {
  const outline = { width: null, style: undefined, color: null };
  if (declarations.outline !== undefined) {
    for (const part of splitTop(declarations.outline.toLowerCase(), ' ').filter(Boolean)) {
      if (['none', 'hidden', 'dotted', 'dashed', 'solid', 'double', 'groove', 'ridge', 'inset', 'outset', 'auto'].includes(part)) outline.style = part;
      else if (lengthPx(part) !== null) outline.width = lengthPx(part);
      else if (parseColor(part)) outline.color = parseColor(part);
    }
    if (outline.style === undefined) outline.style = 'none';
    if (outline.width === null && outline.style !== 'none') outline.width = 3;
  }
  if (declarations['outline-width'] !== undefined) outline.width = lengthPx(declarations['outline-width']);
  if (declarations['outline-style'] !== undefined) outline.style = declarations['outline-style'].toLowerCase();
  if (declarations['outline-color'] !== undefined) outline.color = parseColor(declarations['outline-color']);
  return outline;
};
const durationsMs = value => [...String(value).matchAll(/(-?\d*\.?\d+)(ms|s)\b/g)].map(match => Number(match[1]) * (match[2] === 's' ? 1000 : 1));

// Every structural branch of the renderer: preview on/off, no/YouTube/local
// video, with/without images, license line, Formspree, sample/real reviews.
function pages() {
  const list = [];
  for (const preview of [true, false]) {
    for (const video of [null, { url: 'https://youtu.be/AbcD_12-xyz', title: 'Meet the team' }, { url: 'assets/promo.mp4', title: 'Our work' }]) {
      for (const withImages of [false, true]) {
        const client = copy();
        client.preview = preview;
        client.reviewsAreSamples = preview;
        client.licenseNumber = withImages ? 'TX-12345' : '';
        client.formAction = withImages ? 'https://formspree.io/f/abc123' : '';
        if (video) client.video = video;
        if (withImages) { client.theme.heroImage = 'assets/hero.webp'; client.theme.heroImageAlt = 'Crew on a roof'; client.theme.logoImage = 'assets/logo.png'; client.theme.logoAlt = 'Acme logo'; }
        const label = `preview=${preview} video=${video ? video.url : 'none'} images=${withImages}`;
        list.push({ label, client, html: render(client, withImages ? images : {}).html });
      }
    }
  }
  return list;
}

// --- document structure, landmarks, headings, ARIA references --------------------
test('every page variant has one main landmark, a working skip link, and zoom enabled', () => {
  for (const { label, html } of pages()) {
    const [root] = elements(html, 'html');
    assert.equal(elements(html, 'html').length, 1, label);
    assert.match(root.attributes.lang ?? '', /^en(-[A-Za-z0-9]+)*$/, `${label}: <html lang> declares English, the language of the interface copy`);
    const viewport = elements(html, 'meta').find(meta => meta.attributes.name === 'viewport');
    assert.ok(viewport, `${label}: viewport meta present`);
    assert.match(viewport.attributes.content, /width=device-width/, `${label}: responsive viewport`);
    assert.doesNotMatch(viewport.attributes.content, /user-scalable\s*=\s*(no|0)|maximum-scale\s*=\s*(0?\.\d+|1(\.0+)?)\b/i, `${label}: zoom must stay enabled`);
    const [title] = elements(html, 'title');
    assert.ok(title && text(title), `${label}: non-empty <title>`);
    for (const landmark of ['body', 'main', 'header', 'footer', 'h1']) assert.equal(elements(html, landmark).length, 1, `${label}: exactly one <${landmark}>`);
    // header/footer only map to the banner/contentinfo landmarks when they are not nested inside another landmark.
    for (const landmark of ['main', 'header', 'footer', 'aside']) for (const node of elements(html, landmark)) assert.equal(node.parent.name, 'body', `${label}: <${landmark}> is a top-level landmark`);
    // The skip link is the very first tabbable element and targets the main landmark, which is focusable.
    const [body] = elements(html, 'body');
    const skip = descendants(body).find(focusable);
    assert.equal(skip?.name, 'a', `${label}: first tabbable element is a link`);
    assert.match(skip.attributes.href, /^#./, `${label}: skip link is an in-page link`);
    assert.match(accessibleName(skip), /skip|content|main/i, `${label}: skip link name says what it does`);
    const [main] = elements(html, 'main');
    assert.equal(main.attributes.id, skip.attributes.href.slice(1), `${label}: skip link targets <main>`);
    assert.equal(main.attributes.tabindex, '-1', `${label}: <main> is programmatically focusable`);
    assert.ok(skip.start < elements(html, 'header')[0].start, `${label}: skip link precedes the header`);
    for (const aside of elements(html, 'aside')) assert.ok(aside.attributes['aria-label']?.trim() || tokens(aside.attributes['aria-labelledby']).length, `${label}: complementary landmark has a name`);
    // In-page anchors must point at real ids.
    const ids = idsOf(html);
    for (const { attributes, tag } of elements(html, 'a')) if (attributes.href?.startsWith('#')) assert.ok(ids.includes(attributes.href.slice(1)), `${label}: anchor ${tag} resolves`);
  }
});

test('heading levels never skip and the first heading is the h1', () => {
  for (const { label, html, client } of pages()) {
    const headings = elements(html, ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']).map(node => ({ level: Number(node.name[1]), name: text(node) }));
    assert.equal(headings[0]?.level, 1, `${label}: first heading is h1`);
    headings.slice(1).reduce((previous, { level }) => { assert.ok(level <= previous + 1, `${label}: h${previous} followed by h${level}`); return level; }, headings[0].level);
    for (const heading of headings) assert.ok(heading.name, `${label}: heading h${heading.level} has text`);
    const h1 = headings.find(heading => heading.level === 1).name;
    assert.ok(text(elements(html, 'title')[0]).includes(h1), `${label}: <title> describes the same topic as the h1`);
    assert.equal(headings.filter(heading => heading.level === 3).length, client.services.length, `${label}: one h3 per service`);
    // One section heading per section; the hero uses the h1, every other section an h2.
    assert.equal(headings.filter(heading => heading.level === 2).length, elements(html, 'section').length - 1, `${label}: one h2 per non-hero section`);
    const titles = headings.filter(heading => heading.level <= 2).map(heading => heading.name);
    assert.equal(new Set(titles).size, titles.length, `${label}: section headings are distinct`);
  }
});

test('ids are unique and every ARIA or label reference resolves to a real element', () => {
  const headingNames = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];
  for (const { label, html } of pages()) {
    const ids = idsOf(html);
    for (const id of ids) assert.ok(id.trim() && !/\s/.test(id), `${label}: id "${id}" must be non-empty without whitespace`);
    assert.equal(new Set(ids).size, ids.length, `${label}: duplicate ids ${ids.filter((id, i) => ids.indexOf(id) !== i)}`);
    const resolvable = new Set(ids);
    // Every ID reference attribute anywhere: present means non-empty, each token resolves, IDREF holds one token.
    for (const node of dom(html).all) {
      for (const attribute of [...IDREFS, ...IDREF]) {
        if (!(attribute in node.attributes)) continue;
        const references = tokens(node.attributes[attribute]);
        assert.ok(references.length, `${label}: ${node.tag} has an empty ${attribute}`);
        if (IDREF.includes(attribute)) assert.equal(references.length, 1, `${label}: ${attribute} takes a single id`);
        for (const reference of references) assert.ok(resolvable.has(reference), `${label}: ${attribute}="${reference}" on ${node.tag} does not resolve`);
      }
      if ('aria-label' in node.attributes) assert.ok(node.attributes['aria-label'].trim(), `${label}: ${node.tag} has an empty aria-label`);
      if ('aria-hidden' in node.attributes) {
        assert.equal(node.attributes['aria-hidden'], 'true', `${label}: aria-hidden is only used to hide (${node.tag})`);
        for (const child of descendants(node)) assert.ok(!focusable(child), `${label}: ${child.tag} is keyboard-focusable but hidden from assistive tech inside ${node.tag}`);
      }
    }
    // Each section is named by (at least) a heading that lives inside it, and no two sections share that heading.
    const sections = elements(html, 'section');
    assert.ok(sections.length >= 1, `${label}: the page is divided into sections`);
    const labellingHeadings = [];
    for (const section of sections) {
      const references = tokens(section.attributes['aria-labelledby']);
      assert.ok(references.length, `${label}: ${section.tag} needs aria-labelledby`);
      const inside = descendants(section);
      const headings = references.filter(reference => inside.some(node => node.attributes.id === reference && headingNames.includes(node.name)));
      assert.ok(headings.length, `${label}: ${section.tag} must be labelled by a heading inside the section`);
      assert.ok(accessibleName(section), `${label}: ${section.tag} resolves to a non-empty name`);
      labellingHeadings.push(...headings);
    }
    assert.equal(new Set(labellingHeadings).size, labellingHeadings.length, `${label}: two sections share a labelling heading`);
    const trust = elements(html, 'ul').find(({ attributes }) => tokens(attributes.class).includes('trust'));
    assert.ok(trust && accessibleName(trust) && accessibleName(trust) !== text(trust), `${label}: the business-details list has an explicit accessible name`);
  }
});

test('links, buttons, and disclosures always expose a non-empty accessible name', () => {
  for (const { label, html, client } of pages()) {
    for (const link of elements(html, 'a')) {
      assert.ok(accessibleName(link), `${label}: link ${link.tag} has no accessible name`);
      assert.ok(link.attributes.href, `${label}: ${link.tag} has an href`);
    }
    for (const button of elements(html, 'button')) {
      assert.ok(accessibleName(button), `${label}: button ${button.tag} has no accessible name`);
      assert.match(button.attributes.type ?? '', /^(button|submit)$/, `${label}: button declares its type`);
    }
    assert.deepEqual(elements(html, 'summary').map(accessibleName), client.faqs.map(faq => faq.q), `${label}: each FAQ disclosure is named by its question`);
    // Links that read the same must go to the same place (WCAG 2.4.4).
    const destinations = new Map();
    for (const link of elements(html, 'a')) { const name = accessibleName(link).toLowerCase(); destinations.set(name, (destinations.get(name) ?? new Set()).add(link.attributes.href)); }
    for (const [name, hrefs] of destinations) assert.equal(hrefs.size, 1, `${label}: links named "${name}" point to different targets: ${[...hrefs].join(', ')}`);
    // Telephone links are named by the action and number, never by a bare decorative glyph.
    const calls = elements(html, 'a').filter(link => link.attributes.href?.startsWith('tel:'));
    assert.ok(calls.length >= 1, `${label}: at least one call link`);
    for (const link of calls) assert.ok(accessibleName(link).includes(client.phoneDisplay), `${label}: ${link.tag} named by the displayed number`);
  }
});

// --- images and text alternatives ------------------------------------------------
test('hero and logo images render escaped alt text that also feeds og:image:alt', () => {
  const client = copy();
  client.theme.heroImage = 'assets/roof.webp';
  client.theme.heroImageAlt = 'Crew on a "steep" roof & <ladder>';
  client.theme.logoImage = 'assets/logo.png';
  client.theme.logoAlt = 'Acme <Roofing> "logo"';
  assert.doesNotThrow(() => validate(client, 'acme-roofing.json'));
  const { html } = render(client, images);
  const imgs = elements(html, 'img');
  const hero = imgs.find(img => img.attributes.src === images.hero);
  const logo = imgs.find(img => img.attributes.src === images.logo);
  assert.ok(hero && logo, 'both images are rendered');
  assert.equal(decode(hero.attributes.alt), client.theme.heroImageAlt);
  assert.equal(decode(logo.attributes.alt), client.theme.logoAlt);
  for (const img of [hero, logo]) assert.doesNotMatch(img.attributes.alt, /[<>"]/, 'alt is escaped inside the attribute');
  const ogAlt = elements(html, 'meta').find(meta => meta.attributes.property === 'og:image:alt');
  assert.equal(decode(ogAlt?.attributes.content ?? ''), client.theme.heroImageAlt);
  assert.doesNotMatch(html, /hero-art/, 'decorative fallback is dropped when a photo exists');
  // The brand link keeps the business name in its accessible name even with the logo present.
  const brand = elements(html, 'a').find(link => descendants(link).includes(logo));
  assert.ok(brand && accessibleName(brand).includes(client.businessName));
});

test('image-less layouts hide the decorative hero art and every img keeps an alt attribute', () => {
  const plain = render(copy()).html;
  assert.equal(elements(plain, 'img').length, 0);
  assert.doesNotMatch(plain, /og:image/);
  const art = elements(plain, 'div').find(({ attributes }) => tokens(attributes.class).includes('hero-art'));
  assert.equal(art?.attributes['aria-hidden'], 'true', 'CSS-only hero art is decorative');
  const heroOnly = render(copy(), { hero: images.hero }).html;
  assert.equal(elements(heroOnly, 'img').length, 1);
  assert.doesNotMatch(heroOnly, /hero-art/);
  const logoOnly = render(copy(), { logo: images.logo }).html;
  assert.equal(elements(logoOnly, 'img').length, 1);
  assert.match(logoOnly, /hero-art/);
  assert.doesNotMatch(logoOnly, /og:image/);
  for (const { label, html } of pages()) {
    for (const { tag, attributes } of elements(html, 'img')) {
      assert.ok('alt' in attributes, `${label}: ${tag} must declare alt`);
      if (attributes.alt === '') assert.match(attributes.src, /i\.ytimg\.com/, `${label}: only the YouTube thumbnail may be decorative`);
      else assert.ok(attributes.alt.trim(), `${label}: ${tag} alt must not be blank`);
    }
  }
});

test('validation rejects a logo without alt text and whitespace-only alt for either image', () => {
  const logo = copy(); logo.theme.logoImage = 'assets/logo.png';
  assert.throws(() => validate(logo, 'acme-roofing.json'), /theme\.logoAlt/);
  for (const [image, alt] of [['heroImage', 'heroImageAlt'], ['logoImage', 'logoAlt']]) {
    for (const blank of ['', ' ', '\t\n']) {
      const client = copy();
      client.theme[image] = 'assets/photo.webp';
      client.theme[alt] = blank;
      assert.throws(() => validate(client, 'acme-roofing.json'), new RegExp(`theme\\.${alt}`), `${alt}=${JSON.stringify(blank)}`);
    }
    const optional = copy();
    optional.theme[alt] = 'Unused description';
    assert.doesNotThrow(() => validate(optional, 'acme-roofing.json'), 'alt text without an image is harmless');
  }
});

// --- ratings and decorative graphics ---------------------------------------------
test('star ratings pair hidden glyphs with screen-reader text for every star count', () => {
  const client = copy();
  client.reviews = [1, 2, 3, 4, 5].map(stars => ({ name: `Reviewer ${stars}`, text: 'Fine work.', stars }));
  const { html } = render(client);
  const figures = elements(html, 'figure');
  assert.equal(figures.length, 5);
  figures.forEach((figure, index) => {
    const stars = index + 1;
    const spans = descendants(figure).filter(node => node.name === 'span');
    const glyphs = spans.filter(span => /^[★☆]+$/.test(rawText(span)));
    assert.equal(glyphs.length, 1, 'one glyph run per review');
    assert.equal(glyphs[0].attributes['aria-hidden'], 'true', 'glyphs are hidden from assistive tech');
    assert.equal(rawText(glyphs[0]).length, 5);
    assert.equal((rawText(glyphs[0]).match(/★/g) || []).length, stars);
    const spoken = spans.find(span => /out of 5 stars/.test(text(span)));
    assert.ok(spoken && !('aria-hidden' in spoken.attributes), 'spoken rating is exposed');
    assert.equal(text(spoken), `${stars} out of 5 stars`);
    const hidden = declarations(`.${tokens(spoken.attributes.class)[0]}`);
    assert.equal(hidden.position, 'absolute', 'spoken rating is visually hidden with the clip pattern');
    assert.notEqual(hidden.display, 'none');
    // The whole rating paragraph reads as the spoken text only.
    const paragraph = descendants(figure).find(node => node.name === 'p' && descendants(node).includes(spoken));
    assert.equal(accessibleName(paragraph), `${stars} out of 5 stars`);
  });
  for (const { label, html: page, client: variant } of pages()) {
    for (const { tag, attributes } of elements(page, 'svg')) assert.equal(attributes['aria-hidden'], 'true', `${label}: ${tag}`);
    // The hero call-to-action reads as "Call <number>": its arrow glyph is decorative.
    const cta = elements(page, 'a').find(link => tokens(link.attributes.class).includes('accent') && link.attributes.href?.startsWith('tel:'));
    assert.equal(accessibleName(cta), `Call ${variant.phoneDisplay}`, label);
  }
});

// --- form labels, honeypot, live region ------------------------------------------
test('every form control has exactly one visible label and the honeypot is hidden from everyone', () => {
  for (const { label, html, client } of pages()) {
    const [form] = elements(html, 'form');
    const inside = descendants(form);
    const controls = inside.filter(node => ['input', 'textarea', 'select'].includes(node.name));
    const labels = inside.filter(node => node.name === 'label');
    assert.ok(controls.length >= 4, label);
    assert.equal(new Set(labels.map(({ attributes }) => attributes.for)).size, controls.length, `${label}: one label per control`);
    for (const control of controls) {
      assert.ok(control.attributes.id, `${label}: control needs an id: ${control.tag}`);
      const pair = labels.find(candidate => candidate.attributes.for === control.attributes.id);
      assert.ok(pair && text(pair), `${label}: label for="${control.attributes.id}" with text`);
      assert.ok(!('placeholder' in control.attributes), `${label}: placeholders are not used as labels`);
    }
    const byName = Object.fromEntries(controls.map(control => [control.attributes.name, control]));
    assert.equal(byName.name.attributes.autocomplete, 'name', label);
    assert.equal(byName.phone.attributes.autocomplete, 'tel', label);
    assert.equal(byName.phone.attributes.type, 'tel', label);
    assert.equal(byName.phone.attributes.inputmode, 'tel', label);
    // Honeypot: hidden from assistive tech, out of the tab order, never required, visually hidden by CSS.
    const honeypot = inside.find(node => tokens(node.attributes.class).includes('honeypot'));
    assert.equal(honeypot?.attributes['aria-hidden'], 'true', label);
    const trap = descendants(honeypot).filter(node => node.name === 'input');
    assert.equal(trap.length, 1, label);
    assert.ok(!focusable(trap[0]), `${label}: honeypot is skipped by keyboard`);
    assert.equal(trap[0].attributes.autocomplete, 'off', label);
    assert.ok(!('required' in trap[0].attributes), `${label}: honeypot must not block submission`);
    assert.equal(declared(`.${tokens(honeypot.attributes.class)[0]}`, 'display'), 'none', 'honeypot is hidden visually');
    for (const field of ['name', 'phone', 'message']) {
      assert.ok(!descendants(honeypot).includes(byName[field]), `${label}: ${field} must stay outside the hidden honeypot`);
      assert.ok(focusable(byName[field]) && !('tabindex' in byName[field].attributes), `${label}: ${field} keeps natural tab order`);
      assert.ok('required' in byName[field].attributes, `${label}: ${field} is required`);
    }
    // The status element the script writes to is an initially empty polite live region inside the form.
    const statusId = [...script.matchAll(/querySelector\(['"]#([^'"]+)['"]\)/g)].map(match => match[1]).find(id => inside.some(node => node.attributes.id === id));
    assert.ok(statusId, `${label}: script.js targets an element inside the form`);
    const status = inside.find(node => node.attributes.id === statusId);
    assert.ok(status.attributes.role === 'status' || status.attributes['aria-live'] === 'polite', `${label}: #${statusId} is a polite live region`);
    assert.equal(text(status), '', `${label}: live region starts empty`);
    const submit = inside.find(node => node.name === 'button' && node.attributes.type === 'submit');
    assert.ok(submit && accessibleName(submit), `${label}: submit button is named`);
    assert.equal(/email/i.test(accessibleName(submit)), !client.formAction, `${label}: submit label matches the delivery method`);
    const fallback = inside.find(node => node.name === 'noscript');
    assert.ok(fallback, `${label}: no-JS fallback exists`);
    assert.ok(descendants(fallback).some(link => link.name === 'a' && link.attributes.href?.startsWith('mailto:') && accessibleName(link)), `${label}: fallback offers a named email link`);
    assert.ok(text(fallback).includes(client.phoneDisplay), `${label}: fallback offers the phone number`);
  }
});

// --- contrast --------------------------------------------------------------------
// Shared color sweep: every gray plus the 216 web-safe colors, the sample themes, and saturated primaries.
const sweep = (() => {
  const colors = [];
  for (let value = 0; value < 256; value++) colors.push(`#${value.toString(16).padStart(2, '0').repeat(3)}`);
  const steps = ['00', '33', '66', '99', 'cc', 'ff'];
  for (const r of steps) for (const g of steps) for (const b of steps) colors.push(`#${r}${g}${b}`);
  return [...new Set([...colors, '#153e52', '#f5be62', '#293e72', '#f4ae7c', '#24513d', '#d4dd82', '#ff0000', '#00ff00', '#0000ff', '#767676', '#777777'])];
})();

test('production contrast math matches an independent WCAG calculation and published reference ratios', () => {
  // Reference ratios computed independently (and matching WebAIM's published values).
  for (const [a, b, expected] of [['#767676', '#ffffff', 4.5422], ['#777777', '#ffffff', 4.4781], ['#ff0000', '#ffffff', 3.9985], ['#0000ff', '#ffffff', 8.5925], ['#008000', '#ffffff', 5.1374], ['#ffff00', '#ffffff', 1.0738], ['#000000', '#ffffff', 21], ['#0000ff', '#ff0000', 2.1489], ['#008000', '#ffff00', 4.7841]]) {
    assert.ok(Math.abs(contrast(a, b) - expected) < 0.0001, `independent contrast(${a}, ${b}) = ${contrast(a, b).toFixed(4)}, expected ${expected}`);
  }
  assert.equal(contrast('#ffffff', '#000000'), contrast('#000000', '#ffffff'), 'contrast is symmetric');
  // Production whiteContrast/ink must agree with the independent formula on chromatic colors, not just grays.
  for (const color of sweep) {
    const expected = contrast(color, '#ffffff');
    assert.ok(Math.abs(whiteContrast(color) - expected) < 1e-9, `whiteContrast(${color}) = ${whiteContrast(color)}, independent ${expected}`);
    assert.equal(ink(color), expected >= 4.5 ? '#ffffff' : '#000000', `ink(${color}) follows the 4.5:1 rule`);
  }
  assert.equal(whiteContrast('#ABCDEF'), whiteContrast('#abcdef'), 'hex case does not change the result');
});

test('automatic ink always reaches 4.5:1 against any theme color', () => {
  let worst = Infinity;
  for (const color of sweep) {
    const foreground = ink(color);
    assert.ok(['#ffffff', '#000000'].includes(foreground), color);
    const ratio = contrast(color, foreground);
    assert.ok(ratio >= 4.5, `${color} with ${foreground} is ${ratio.toFixed(2)}:1`);
    worst = Math.min(worst, ratio);
  }
  assert.ok(worst < 4.6, 'sweep reaches the tight boundary (#767676), so the assertion is meaningful');
});

test('theme CSS emits the chosen ink for primary and accent and an opposing shade', () => {
  const variables = source => Object.fromEntries([...source.matchAll(/--([a-z-]+)\s*:\s*([^;}]+)/g)].map(match => [match[1], match[2].trim()]));
  for (const [primary, accent] of [['#153E52', '#F5BE62'], ['#F5BE62', '#153E52'], ['#767676', '#777777'], ['#ffffff', '#000000']]) {
    const client = copy();
    client.theme.primary = primary;
    client.theme.accent = accent;
    const theme = variables(render(client).themeCSS);
    assert.equal(theme.primary, primary);
    assert.equal(theme.accent, accent);
    assert.equal(theme['on-primary'], ink(primary));
    assert.equal(theme['on-accent'], ink(accent));
    assert.ok(contrast(theme.primary, theme['on-primary']) >= 4.5 && contrast(theme.accent, theme['on-accent']) >= 4.5);
    assert.ok(['#000000', '#ffffff'].includes(theme.shade) && theme.shade !== theme['on-primary'], 'shade opposes the text so the hero pattern stays subtle');
  }
  // Every surface painted with a theme color must use the matching ink, never a fixed color.
  const painted = rules.filter(rule => /var\(--(primary|accent)\)/.test(rule.declarations.background ?? ''));
  assert.ok(painted.length >= 1, 'theme backgrounds are in use');
  for (const rule of painted) {
    const tone = rule.declarations.background.match(/var\(--(primary|accent)\)/)[1];
    assert.equal(rule.declarations.color, `var(--on-${tone})`, `${rule.selector} pairs --${tone} with --on-${tone}`);
  }
  for (const selector of ['.button', '.accent', '.hero', '.icon', '.hero-facts']) assert.ok(painted.some(rule => rule.selector === selector), `${selector} is theme-painted`);
});

test('shipped sample themes and the static palette meet AA text contrast', async () => {
  for (const name of ['acme-roofing', 'cool-air-hvac', 'green-leaf-landscaping']) {
    const { theme } = JSON.parse(await readFile(path.join(root, `clients/${name}.json`)));
    assert.ok(whiteContrast(theme.primary) >= 4.5, `${name}: primary should not trigger the build warning`);
    assert.ok(contrast(theme.accent, ink(theme.accent)) >= 4.5, `${name}: accent text`);
  }
  // Colors are read from the stylesheet so a palette edit is measured, not assumed, and re-checked in every conditional context.
  const themes = [];
  for (const name of ['acme-roofing', 'cool-air-hvac', 'green-leaf-landscaping']) themes.push(JSON.parse(await readFile(path.join(root, `clients/${name}.json`))).theme);
  for (const context of contexts.filter(context => !forcedColors(context))) {
    const color = (selector, property) => declaredColor(selector, property, context);
    const pairs = [
      ['body text', color('body', 'color'), color('body', 'background')],
      ['body text on review/FAQ bands', color('body', 'color'), color('.reviews', 'background')],
      ['body text on cards (quotes, captions)', color('body', 'color'), color('.card', 'background')],
      ['card copy', color('.card p', 'color'), color('.card', 'background')],
      ['star glyphs', color('.stars', 'color'), color('.card', 'background')],
      ['form notes and status', color('.form-note', 'color'), color('form', 'background')],
      ['input text', color('input', 'color'), color('input', 'background')],
      ['footer', color('footer', 'color'), color('footer', 'background')],
      ['preview banner', color('.preview-banner', 'color'), color('.preview-banner', 'background')],
      ['sample tag', color('.sample-tag', 'color'), color('.sample-tag', 'background')],
      ['sample note', color('.sample-note', 'color'), color('.sample-note', 'background')],
      ['skip link', color('.skip-link', 'color'), color('.skip-link', 'background')]
    ];
    for (const [label, foreground, background] of pairs) assert.ok(contrast(foreground, background) >= 4.5, `${label}: ${foreground} on ${background} is ${contrast(foreground, background).toFixed(2)}:1 (${contextLabel(context)})`);
    assert.ok(contrast(color('input', 'border'), color('input', 'background')) >= 3, `input border meets the 3:1 non-text minimum (${contextLabel(context)})`);
    // The two-tone focus ring must be visible on the lightest and darkest surfaces, including every sample theme.
    const ring = declarations(':focus-visible', context);
    const ringColors = [...(outlineOf(ring).color?.alpha === 1 ? [outlineOf(ring).color.hex] : []), ...opaqueColors(ring['box-shadow'] ?? '')];
    assert.ok(ringColors.length >= 1, `focus ring declares an opaque color (${contextLabel(context)})`);
    const surfaces = [color('body', 'background'), color('footer', 'background'), color('.card', 'background'), color('.reviews', 'background'), ...themes.flatMap(theme => [theme.primary.toLowerCase(), theme.accent.toLowerCase()])];
    for (const surface of surfaces) assert.ok(Math.max(...ringColors.map(ringColor => contrast(ringColor, surface))) >= 3, `focus ring is visible on ${surface} (${contextLabel(context)})`);
  }
});

test('build warns on a low-contrast primary, switches to black text, and stays quiet otherwise', async () => {
  const fixture = await mkdtemp(path.join(tmpdir(), 'homeservice-a11y-'));
  try {
    for (const directory of ['scripts', 'schema', 'src']) await cp(path.join(root, directory), path.join(fixture, directory), { recursive: true });
    await mkdir(path.join(fixture, 'clients'));
    const filename = path.join(fixture, 'clients/acme-roofing.json');
    const run = () => spawnSync(process.execPath, ['scripts/build.mjs', 'acme-roofing'], { cwd: fixture, encoding: 'utf8' });
    const builtTheme = async () => { const styles = await readFile(path.join(fixture, 'dist/acme-roofing/styles.css'), 'utf8'); assert.ok(styles.endsWith(css), 'theme variables are prepended to the unchanged stylesheet'); return Object.fromEntries([...styles.slice(0, styles.length - css.length).matchAll(/--([a-z-]+)\s*:\s*([^;}]+)/g)].map(match => [match[1], match[2].trim()])); };
    const client = copy();
    client.theme.primary = '#F5BE62';
    await writeFile(filename, JSON.stringify(client));
    let result = run();
    assert.equal(result.status, 0, result.stderr);
    const warning = result.stderr.split('\n').find(line => /theme\.primary/.test(line));
    assert.ok(warning, 'a warning names theme.primary');
    assert.match(warning, /acme-roofing\.json/);
    assert.ok(warning.includes(`${whiteContrast('#F5BE62').toFixed(2)}:1`), 'warning reports the measured ratio');
    assert.match(warning, /4\.5:1/);
    assert.match(warning, /black/i);
    let theme = await builtTheme();
    assert.equal(theme['on-primary'], '#000000');
    assert.equal(theme.primary, '#F5BE62');
    client.theme.primary = '#153E52';
    await writeFile(filename, JSON.stringify(client));
    result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stderr, /theme\.primary|4\.5:1|black text/i);
    theme = await builtTheme();
    assert.equal(theme['on-primary'], '#ffffff');
  } finally { await rm(fixture, { recursive: true, force: true }); }
});

// --- stylesheet guards -----------------------------------------------------------
test('stylesheet parser handles nesting, strings, conditional and layered rules, and rejects malformed braces', () => {
  // Guards the test infrastructure itself: a parser bug here would silently weaken every CSS assertion.
  const find = (source, selector, property) => parseCSS(source).filter(rule => rule.selector === selector).map(rule => [rule.conditions, rule.declarations[property]]);
  assert.deepEqual(find('@import url(x.css); body { color: red }', 'body', 'color'), [[[], 'red']], 'statement at-rules do not swallow the next rule');
  assert.deepEqual(find('@layer base { body { color: red } }', 'body', 'color'), [[[], 'red']], '@layer is not a condition');
  assert.deepEqual(find('@media (prefers-reduced-motion: reduce) { @layer x { html { scroll-behavior: auto } } }', 'html', 'scroll-behavior'), [[['@media (prefers-reduced-motion: reduce)'], 'auto']], 'media condition survives nested grouping');
  assert.deepEqual(find('@media (a) { @supports (b) { p { x: 1 } } }', 'p', 'x'), [[['@media (a)', '@supports (b)'], '1']], 'nested conditions accumulate; @supports is conditional');
  assert.deepEqual(find('@media screen { @media all { p { x: 1 } } } @media (min-width: 0) { q { x: 2 } }', 'p', 'x').concat(find('@media (min-width: 0) { q { x: 2 } }', 'q', 'x')), [[[], '1'], [[], '2']], 'always-true media is unconditional');
  assert.deepEqual(parseCSS('@media print { p { x: 1 } } @media only print and (color) { q { x: 1 } } @media print, screen { r { x: 1 } }').map(rule => rule.print), [true, true, false], 'print-only rules are flagged');
  assert.deepEqual(find('a { background: url("data:image/svg+xml;base64,AA{}"); color: red }', 'a', 'color'), [[[], 'red']], 'braces and semicolons inside strings are literal');
  assert.deepEqual(find('a::before { content: "{"; color: red } b { color: blue }', 'b', 'color'), [[[], 'blue']]);
  assert.deepEqual(find('.a { color: red; &:hover { color: blue } .b { color: green } }', '.a:hover', 'color'), [[[], 'blue']], 'nesting with &');
  assert.deepEqual(find('.a { color: red; &:hover { color: blue } .b { color: green } }', '.a .b', 'color'), [[[], 'green']], 'nesting without &');
  assert.deepEqual(find('.a { color: red; &:hover { color: blue } }', '.a', 'color'), [[[], 'red']], 'parent keeps only its own declarations');
  assert.deepEqual(find('.a { color: red; @media (x) { color: blue } }', '.a', 'color'), [[[], 'red'], [['@media (x)'], 'blue']], 'nested media inside a rule');
  assert.deepEqual(find('A { COLOR: Red }', 'A', 'color'), [[[], 'Red']], 'property names are case-insensitive');
  assert.equal(parseCSS(':is(a, b), c>d { x: 1 }').map(rule => rule.selector).join('|'), ':is(a, b)|c > d', 'selector lists split only at the top level; combinators are normalised');
  const important = parseCSS('.s { color: #765200 !important }')[0];
  assert.equal(important.declarations.color, '#765200');
  assert.ok(important.important.has('color'));
  assert.equal(parseCSS('@keyframes spin { from { opacity: 0 } to { opacity: 1 } } @font-face { font-family: x }').length, 0, 'non-style at-rules are skipped');
  assert.equal(parseCSS('/* a { color: red } */ b { color: blue }').length, 1, 'comments are ignored');
  assert.throws(() => parseCSS('a { color: red'), /unclosed "\{" for: a/);
  assert.throws(() => parseCSS('a { color: red } }'), /stray "\}"/);
  assert.throws(() => parseCSS('a { content: "{" '), /unclosed/);
  // Cascade: layers, layer statements, nesting, !important.
  const winner = (source, selector, property) => cascade(parseCSS(source).filter(rule => rule.selector === selector))[property];
  assert.equal(winner('p { x: unlayered } @layer a { p { x: a } }', 'p', 'x'), 'unlayered', 'unlayered beats a later layer');
  assert.equal(winner('@layer a { p { x: a } } @layer b { p { x: b } } @layer a { p { x: a2 } }', 'p', 'x'), 'b', 'later layer beats earlier even when re-opened');
  assert.equal(winner('@layer b, a; @layer a { p { x: a } } @layer b { p { x: b } }', 'p', 'x'), 'a', '@layer statement fixes the order');
  assert.equal(winner('@layer a { @layer inner { p { x: inner } } p { x: outer } }', 'p', 'x'), 'outer', "a layer's own styles beat its nested layers");
  assert.equal(winner('@layer a { p { x: a !important } } p { x: unlayered }', 'p', 'x'), 'a', '!important reverses layer precedence');
  assert.equal(winner('p { x: first !important } p { x: second }', 'p', 'x'), 'first', '!important beats later normal declarations');
  // Context activation: mobile-first width chains compose, other features must match exactly.
  assert.ok(implies('@media (min-width: 900px)', '@media (min-width: 600px)') && !implies('@media (min-width: 600px)', '@media (min-width: 900px)'));
  assert.ok(implies('@media (max-width: 400px)', '@media (max-width: 600px)') && !implies('@media (max-width: 600px)', '@media (max-width: 400px)'));
  assert.ok(!implies('@media (min-width: 900px)', '@media (hover: hover)') && !implies('@media (min-width: 900px)', '@supports (x)'));
  assert.ok(forcedColors(['@media (forced-colors: active)']) && !forcedColors(['@media (forced-colors: none)']) && !forcedColors(['@media not (forced-colors: active)']));
  // Length and color helpers.
  assert.equal(lengthPx('5vw'), null); assert.equal(lengthPx('50%'), 8); assert.equal(lengthPx('1.65'), null); assert.equal(lengthPx('0'), 0);
  assert.equal(lengthPx('calc(2rem + 12px)'), 44); assert.equal(lengthPx('calc(3rem - 4px)'), 44); assert.equal(lengthPx('max(44px, 2.5rem)'), 44); assert.equal(lengthPx('clamp(2.5rem, 6.5vw, 5.5rem)'), 40);
  assert.equal(lengthPx('medium'), 3); assert.equal(lengthPx('solid thick #fff'), 5); assert.equal(lengthPx('3px solid #fff'), 3); assert.equal(lengthPx('small', FONT_SIZE_KEYWORDS), 13);
  assert.deepEqual(parseColor('white'), { hex: '#ffffff', alpha: 1 });
  assert.deepEqual(parseColor('#1117'), { hex: '#111111', alpha: 7 / 15 });
  assert.deepEqual(parseColor('rgb(255, 0, 0)'), { hex: '#ff0000', alpha: 1 });
  assert.deepEqual(parseColor('rgb(0 0 255 / 50%)'), { hex: '#0000ff', alpha: 0.5 });
  assert.deepEqual(parseColor('hsl(120, 100%, 25%)'), { hex: '#008000', alpha: 1 });
  assert.equal(parseColor('currentColor'), null); assert.equal(parseColor('var(--primary)'), null);
  assert.deepEqual(colorsIn('0 0 0 6px #111, inset 0 0 0 2px rgba(0,0,0,.5)').map(color => [color.hex, color.alpha]), [['#111111', 1], ['#000000', 0.5]]);
});

test('stylesheet keeps focus indicators, skip-link reveal, sr-only, reduced motion, and touch targets in every context', () => {
  assert.ok(contexts[0].length === 0, `contexts found: ${contexts.map(contextLabel).join(' | ')}`);
  for (const context of contexts) {
    const where = contextLabel(context);
    // A visible, two-part focus indicator.
    const ring = declarations(':focus-visible', context);
    const ringOutline = outlineOf(ring);
    assert.ok(ringOutline.style && ringOutline.style !== 'none', `focus-visible sets a visible outline style (${where})`);
    assert.ok(ringOutline.width >= 2, `outline is at least 2px thick (${ringOutline.width}px, ${where})`);
    assert.ok(ring['box-shadow'] && ring['box-shadow'] !== 'none', `focus-visible adds a contrasting halo (${where})`);
    assert.ok(/inset/.test(declarations('.video-facade:focus-visible', context)['box-shadow'] ?? ''), `clipped media keeps an inset focus ring (${where})`);
    // Skip link: off-canvas until focused, then revealed above the sticky bars.
    const skip = declarations('.skip-link', context);
    assert.match(skip.position, /^(fixed|absolute)$/, where);
    assert.ok(lengthPx(skip.top) < 0, `skip link is parked off-screen (${where})`);
    assert.ok(lengthPx(declared('.skip-link:focus', 'top', context)) >= 0, `skip link is revealed on focus (${where})`);
    for (const bar of ['.topbar', '.mobile-call']) assert.ok(Number(skip['z-index']) > Number(declared(bar, 'z-index', context)), `skip link stacks above ${bar} (${where})`);
    // Visually hidden text remains in the accessibility tree; the honeypot stays hidden.
    const hidden = declarations('.sr-only', context);
    assert.equal(hidden.position, 'absolute', where);
    assert.equal(lengthPx(hidden.width), 1, where);
    assert.equal(lengthPx(hidden.height), 1, where);
    assert.equal(hidden.overflow, 'hidden', where);
    assert.ok(hidden['clip-path'] || hidden.clip, `clipped rather than removed (${where})`);
    assert.notEqual(hidden.display, 'none', where);
    assert.notEqual(hidden.visibility, 'hidden', where);
    assert.equal(declared('.honeypot', 'display', context), 'none', `honeypot stays hidden (${where})`);
    // Touch targets hold in every context.
    for (const selector of ['.button', 'summary', 'input', 'textarea', '.call-link', '.brand', 'footer a', '.video-media noscript a']) assert.ok(lengthPx(declared(selector, 'min-height', context)) >= 44, `${selector} keeps a 44px target (${where})`);
  }
  // Nothing removes the outline anywhere on screen, except the programmatic skip target.
  const hidesOutline = declarations => { const outline = outlineOf(declarations); return outline.width === 0 || outline.style === 'none' || outline.color?.alpha === 0; };
  assert.deepEqual(screenRules.filter(rule => hidesOutline(rule.declarations)).map(rule => rule.selector), ['main:focus'], 'only the programmatic skip target hides its outline');
  for (const rule of screenRules.filter(rule => /focus/.test(rule.selector) && rule.selector !== 'main:focus')) assert.ok(!/none/.test(rule.declarations['box-shadow'] ?? ''), `${rule.selector} keeps its halo (${contextLabel(rule.conditions)})`);
  assert.ok(!screenRules.some(rule => [...rule.important].some(property => property.startsWith('outline'))), 'no !important outline overrides');
  // Motion: every motion declaration that can reach reduce-motion users needs an override that applies to all of them.
  const isMotion = (property, value) => property === 'scroll-behavior' ? value === 'smooth' : /^(animation|transition)(-duration)?$/.test(property) && value !== 'none' && durationsMs(value).some(ms => ms > 0);
  const isNeutral = (property, value) => value !== undefined && (property === 'scroll-behavior' ? value === 'auto' : value === 'none' || (durationsMs(value).length > 0 && durationsMs(value).every(ms => ms === 0)));
  const segmentQueries = conditions => conditions.filter(isMediaSegment).flatMap(mediaQueries);
  const gatedOffReduce = conditions => segmentQueries(conditions).some(query => queryHas(query, 'prefers-reduced-motion', 'no-preference') || queryNegates(query, 'prefers-reduced-motion', 'reduce'));
  const servedOnlyToReduce = conditions => segmentQueries(conditions).some(query => queryHas(query, 'prefers-reduced-motion', 'reduce'));
  // An override reaches every reduce-motion user only if each segment is satisfied by that preference alone (extra OR alternatives are fine; @supports is assumed true).
  const coversAllReduceUsers = conditions => conditions.length > 0 && conditions.every(segment => /^@supports\b/i.test(segment) || (isMediaSegment(segment) && mediaQueries(segment).some(query => /^(?:(?:only\s+)?(?:screen|all)\s+and\s+)?\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)$/.test(query))));
  const motion = screenRules.filter(rule => !gatedOffReduce(rule.conditions)).flatMap(rule => Object.entries(rule.declarations).filter(([property, value]) => isMotion(property, value)).map(([property]) => ({ rule, property })));
  assert.ok(motion.some(({ property }) => property === 'scroll-behavior'), 'smooth scrolling is the motion in use');
  for (const { rule, property } of motion) {
    assert.ok(!servedOnlyToReduce(rule.conditions), `${rule.selector} { ${property} } is motion served specifically to reduce-motion users (${contextLabel(rule.conditions)})`);
    const shorthand = property.replace(/-duration$/, '');
    const override = screenRules.find(candidate => candidate.selector === rule.selector && coversAllReduceUsers(candidate.conditions) && (isNeutral(property, candidate.declarations[property]) || isNeutral(shorthand, candidate.declarations[shorthand])));
    assert.ok(override, `${rule.selector} { ${property} } (${contextLabel(rule.conditions)}) has a reduced-motion override that reaches every reduce-motion user`);
  }
  // Readable text.
  const body = declarations('body');
  const shorthand = body.font ? splitTop(body.font, ' ').find(part => lengthPx(part.split('/')[0], FONT_SIZE_KEYWORDS) !== null) : undefined;
  const baseSize = body['font-size'] ?? shorthand?.split('/')[0];
  const lineHeight = body['line-height'] ?? shorthand?.split('/')[1];
  assert.ok(lengthPx(baseSize, FONT_SIZE_KEYWORDS) >= 16, `base text is at least 16px (${baseSize})`);
  assert.ok(Number(lineHeight) >= 1.5 || lengthPx(lineHeight) >= 24, `base line height is readable (${lineHeight})`);
  const sizes = screenRules.flatMap(rule => {
    const values = [];
    if (rule.declarations['font-size']) values.push(rule.declarations['font-size']);
    if (rule.declarations.font && rule.declarations.font !== 'inherit') { const size = splitTop(rule.declarations.font, ' ').map(part => part.split('/')[0]).find(part => lengthPx(part, FONT_SIZE_KEYWORDS) !== null); if (size) values.push(size); }
    return values.map(value => ({ selector: rule.selector, value, px: lengthPx(value, FONT_SIZE_KEYWORDS) })).filter(size => size.px !== null);
  });
  assert.ok(sizes.length >= 1, 'font sizes were found');
  for (const size of sizes) assert.ok(size.px >= 12, `${size.selector} { font-size: ${size.value} } renders at ${size.px}px, below 12px`);
});
