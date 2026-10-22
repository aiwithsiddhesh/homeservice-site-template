import { readFile } from 'node:fs/promises';

const schema = JSON.parse(await readFile(new URL('../schema/client.schema.json', import.meta.url)));

// A small interpreter for the JSON Schema keywords used in our schema.
function check(value, rule, path, errors) {
  if (rule.$ref) rule = schema.$defs[rule.$ref.split('/').pop()];
  const kind = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;
  if (rule.type && (rule.type === 'integer' ? !Number.isInteger(value) : kind !== rule.type)) {
    errors.push(`${path}: expected ${rule.type}`);
    return;
  }
  if (rule.enum && !rule.enum.includes(value)) errors.push(`${path}: choose ${rule.enum.join(', ')}`);
  if (kind === 'object') {
    for (const key of rule.required || []) {
      if (!Object.hasOwn(value, key)) errors.push(`${path}.${key}: required field is missing`);
    }
    for (const key of Object.keys(value)) {
      if (Object.hasOwn(rule.properties || {}, key)) check(value[key], rule.properties[key], `${path}.${key}`, errors);
      else if (rule.additionalProperties === false) errors.push(`${path}.${key}: unknown field`);
    }
  }
  if (kind === 'array') {
    if (value.length < rule.minItems || value.length > rule.maxItems) errors.push(`${path}: expected ${rule.minItems}-${rule.maxItems} items`);
    if (rule.uniqueItems && new Set(value.map(item => JSON.stringify(item))).size !== value.length) errors.push(`${path}: duplicate items`);
    value.forEach((item, i) => check(item, rule.items, `${path}[${i}]`, errors));
  }
  if (kind === 'string') {
    const length = Array.from(value).length;
    if (length < (rule.minLength || 0) || length > (rule.maxLength ?? Infinity)) errors.push(`${path}: invalid text length`);
    if (rule.pattern && !new RegExp(rule.pattern).test(value)) errors.push(`${path}: ${rule.description || `must match ${rule.pattern}`}`);
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) errors.push(`${path}: control characters are not allowed`);
  }
  if (kind === 'number' && (value < rule.minimum || value > rule.maximum)) errors.push(`${path}: expected ${rule.minimum}-${rule.maximum}`);
}

export function openingHours(hours) {
  if (hours === '24/7') return ['Mo-Su 00:00-23:59'];
  const days = { Mon: 'Mo', Tue: 'Tu', Wed: 'We', Thu: 'Th', Fri: 'Fr', Sat: 'Sa', Sun: 'Su' };
  const time = (hour, minute, period) => `${String(Number(hour) % 12 + (period === 'pm' ? 12 : 0)).padStart(2, '0')}:${minute || '00'}`;
  return hours.split(';').map(part => {
    const match = part.trim().match(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)(?:-(Mon|Tue|Wed|Thu|Fri|Sat|Sun))? (1[0-2]|[1-9])(?::([0-5][0-9]))?(am|pm)-(1[0-2]|[1-9])(?::([0-5][0-9]))?(am|pm)$/);
    if (!match) throw new Error('hours: use "Mon-Sat 7am-6pm", semicolon-separated schedules, or "24/7"');
    const [, start, end, h1, m1, p1, h2, m2, p2] = match;
    return `${days[start]}${end ? `-${days[end]}` : ''} ${time(h1, m1, p1)}-${time(h2, m2, p2)}`;
  });
}

export function videoSource(value) {
  const invalid = () => new Error('video.url: use an HTTPS YouTube watch, Shorts, or youtu.be URL with an 11-character ID, or an assets/ path ending in .mp4 or .webm');
  if (typeof value !== 'string' || /[\s\\]/.test(value)) throw invalid();
  const local = value.match(/^assets\/(?:[A-Za-z0-9_-][A-Za-z0-9._-]*\/)*[A-Za-z0-9_-][A-Za-z0-9._-]*\.(mp4|webm)$/);
  if (local) return { type: 'file', path: value, mime: `video/${local[1]}` };
  let url;
  try { url = new URL(value); } catch { throw invalid(); }
  if (!/^https:\/\//i.test(value) || url.protocol !== 'https:' || url.username || url.password || url.port) throw invalid();
  const host = url.hostname.replace(/^(www\.|m\.)/, '');
  let id;
  if (host === 'youtu.be') id = url.pathname.match(/^\/([A-Za-z0-9_-]{11})\/?$/)?.[1];
  if (host === 'youtube.com') {
    if (url.pathname === '/watch' && url.searchParams.getAll('v').length === 1) id = url.searchParams.get('v');
    else id = url.pathname.match(/^\/shorts\/([A-Za-z0-9_-]{11})\/?$/)?.[1];
  }
  if (!id || !/^[A-Za-z0-9_-]{11}$/.test(id)) throw invalid();
  return { type: 'youtube', id };
}

export function validate(client, filename) {
  const errors = [];
  check(client, schema, filename, errors);
  if (client?.video && Object.hasOwn(client.video, 'url')) {
    try { videoSource(client.video.url); } catch (error) { errors.push(error.message); }
  }
  if (!errors.length) {
    if (client.slug !== filename.replace(/\.json$/, '')) errors.push(`${filename}.slug: must match the filename`);
    try { openingHours(client.hours); } catch (error) { errors.push(error.message); }
    for (const [image, alt] of [['heroImage', 'heroImageAlt'], ['logoImage', 'logoAlt']]) {
      if (client.theme[image] && !client.theme[alt]?.trim()) errors.push(`${filename}.theme.${alt}: required when ${image} is set`);
    }
    if (client.siteUrl) {
      try {
        const url = new URL(client.siteUrl);
        if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error();
      } catch { errors.push(`${filename}.siteUrl: use an absolute HTTPS URL without credentials, query, or fragment`); }
    }
  }
  if (errors.length) throw new Error(`Client validation failed:\n- ${errors.join('\n- ')}`);
  return client;
}

function luminance(hex) {
  const rgb = hex.slice(1).match(/../g).map(value => {
    const channel = parseInt(value, 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}

export const whiteContrast = hex => 1.05 / (luminance(hex) + 0.05);
export const ink = hex => whiteContrast(hex) >= 4.5 ? '#ffffff' : '#000000';
