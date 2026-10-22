import { readFile, writeFile, readdir, mkdir, rm, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate, whiteContrast, videoSource } from './validate.mjs';
import { render, escapeHTML } from './render.mjs';

export const root = fileURLToPath(new URL('../', import.meta.url));
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

async function assetFile(source, outputName, limit, label) {
  if (!source) return null;
  const base = await realpath(path.join(root, 'assets'));
  const filename = await realpath(path.join(root, source));
  const relative = path.relative(base, filename);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`${source}: asset must remain inside assets/`);
  const bytes = await readFile(filename);
  if (bytes.length > limit) console.warn(`Warning: ${source} is over ${label}; compress it for mobile.`);
  return { name: `${outputName}${path.extname(source)}`, bytes };
}

export async function build(selected = '--all') {
  if (selected !== '--all' && !slugPattern.test(selected)) throw new Error('Use a lowercase client slug, such as acme-roofing.');
  const filenames = selected === '--all'
    ? (await readdir(path.join(root, 'clients'))).filter(name => name.endsWith('.json')).sort()
    : [`${selected}.json`];
  if (!filenames.length) throw new Error('No client JSON files found in clients/.');
  const css = await readFile(path.join(root, 'src/styles.css'), 'utf8');
  const script = await readFile(path.join(root, 'src/script.js'), 'utf8');
  const compiled = [];
  for (const filename of filenames) {
    let client;
    try { client = JSON.parse(await readFile(path.join(root, 'clients', filename), 'utf8')); }
    catch (error) { throw new Error(`${filename}: cannot read valid JSON: ${error.message}`); }
    validate(client, filename);
    const contrast = whiteContrast(client.theme.primary);
    if (contrast < 4.5) console.warn(`Warning: ${filename}: theme.primary against white is ${contrast.toFixed(2)}:1 (AA needs 4.5:1). Using black text.`);
    if (!client.siteUrl) console.warn(`Warning: ${filename}: siteUrl is empty; replace the example.com canonical before publishing.`);
    if (!client.reviewsAreSamples) console.log(`Note: ${filename}: reviews are shown as real customer reviews.`);
    const hero = await assetFile(client.theme.heroImage, 'images/hero', 500_000, '500 KB');
    const logo = await assetFile(client.theme.logoImage, 'images/logo', 500_000, '500 KB');
    const source = client.video ? videoSource(client.video.url) : null;
    const video = source?.type === 'file' ? await assetFile(source.path, 'media/promo', 15_000_000, '15 MB') : null;
    const poster = source?.type === 'file' ? await assetFile(client.video.poster, 'media/poster', 300_000, '300 KB') : null;
    const page = render(client, { hero: hero?.name, logo: logo?.name });
    const files = {
      'index.html': page.html,
      'styles.css': page.themeCSS + css,
      'script.js': script,
      'robots.txt': `User-agent: *\nAllow: /\nSitemap: ${page.canonical}sitemap.xml\n`,
      'sitemap.xml': `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${escapeHTML(page.canonical)}</loc></url></urlset>\n`
    };
    const size = Object.values(files).reduce((total, contents) => total + Buffer.byteLength(contents), 0);
    if (size >= 150_000) throw new Error(`${filename}: generated files exceed the 150 KB budget (${size} bytes). Shorten the content.`);
    compiled.push({ slug: client.slug, files, assets: [hero, logo, video, poster].filter(Boolean), size });
  }
  // Validate and read every input before replacing any previous output.
  for (const site of compiled) {
    const destination = path.join(root, 'dist', site.slug);
    await rm(destination, { recursive: true, force: true });
    await mkdir(destination, { recursive: true });
    for (const [name, contents] of Object.entries(site.files)) await writeFile(path.join(destination, name), contents);
    for (const asset of site.assets) {
      await mkdir(path.dirname(path.join(destination, asset.name)), { recursive: true });
      await writeFile(path.join(destination, asset.name), asset.bytes);
    }
    console.log(`Built dist/${site.slug}/ — ${site.size} bytes excluding images and video`);
  }
  return compiled.map(site => site.slug);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 1) {
    console.error('Usage: npm run build -- <client-slug> OR npm run build:all');
    process.exitCode = 1;
  } else {
    try { await build(args[0]); }
    catch (error) { console.error(`Build failed: ${error.message}`); process.exitCode = 1; }
  }
}
