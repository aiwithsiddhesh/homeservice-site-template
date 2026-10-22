import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, mkdtemp, cp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { validate, openingHours, ink, whiteContrast, videoSource } from '../scripts/validate.mjs';
import { render } from '../scripts/render.mjs';
import { root } from '../scripts/build.mjs';

const sample = JSON.parse(await readFile(path.join(root, 'clients/acme-roofing.json')));
const copy = () => structuredClone(sample);

test('validation rejects missing fields, malformed phones, and unsafe configuration', () => {
  const missing = copy(); delete missing.businessName;
  assert.throws(() => validate(missing, 'acme-roofing.json'), /businessName: required/);
  for (const phone of ['+1-214-555-0142', '2145550142', '+02145550142', '+1234567890123456']) {
    assert.throws(() => validate({ ...copy(), phone }, 'acme-roofing.json'), /E.164/);
  }
  for (const formAction of ['javascript:alert(1)', 'https://evil.example/form']) {
    assert.throws(() => validate({ ...copy(), formAction }, 'acme-roofing.json'), /formAction/);
  }
  assert.throws(() => validate({ ...copy(), siteUrl: 'https://example.com/?x=1' }, 'acme-roofing.json'), /siteUrl/);
  const image = copy(); image.theme.heroImage = 'assets/roof.webp';
  assert.throws(() => validate(image, 'acme-roofing.json'), /heroImageAlt/);
});

test('escaping protects text, attributes, and JSON-LD script boundaries', () => {
  const client = copy();
  client.preview = false;
  client.businessName = '</script><img src=x onerror=alert(1)>"&';
  validate(client, 'acme-roofing.json');
  const { html } = render(client);
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('&lt;/script&gt;'));
  const json = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1];
  assert.equal(JSON.parse(json).name, client.businessName);
  assert.ok(!json.includes('<'));
});

test('preview requires a boolean and defaults to live HTML when missing', () => {
  for (const preview of ['true', 'false', 0, 1, null, [], {}]) {
    assert.throws(() => validate({ ...copy(), preview }, 'acme-roofing.json'), /acme-roofing\.json\.preview: expected boolean/);
  }
  const client = copy();
  delete client.preview;
  assert.doesNotThrow(() => validate(client, 'acme-roofing.json'));
  const missing = render(client).html;
  client.preview = false;
  assert.doesNotThrow(() => validate(client, 'acme-roofing.json'));
  assert.equal(render(client).html, missing);
  assert.doesNotMatch(missing, /noindex|preview-banner|Design preview made for/);
  assert.match(missing, /<script type="application\/ld\+json">/);
});

test('preview HTML adds an escaped banner and noindex while omitting JSON-LD', () => {
  const client = copy();
  client.preview = true;
  client.businessName = 'Roof & Home <script>alert(1)</script>';
  for (const reviewsAreSamples of [true, false]) {
    client.reviewsAreSamples = reviewsAreSamples;
    const { html } = render(client);
    assert.match(html, /<head>[\s\S]*<meta name="robots" content="noindex, nofollow">[\s\S]*<\/head>/);
    assert.doesNotMatch(html, /application\/ld\+json|"@type":"LocalBusiness"/);
    assert.match(html, /Design preview made for Roof &amp; Home &lt;script&gt;alert\(1\)&lt;\/script&gt;\. This is not the official website yet\./);
    assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
    assert.ok(html.indexOf('class="preview-banner"') < html.indexOf('<header class="topbar">'));
    assert.ok(html.indexOf('</aside>') < html.indexOf('<header class="topbar">'));
  }
  assert.ok(whiteContrast('#17242a') >= 4.5);
});

test('preview builds allow crawling with noindex headers and live builds preserve search files across mode changes', async () => {
  const fixture = await mkdtemp(path.join(tmpdir(), 'homeservice-preview-'));
  try {
    for (const directory of ['scripts', 'schema', 'src']) await cp(path.join(root, directory), path.join(fixture, directory), { recursive: true });
    await mkdir(path.join(fixture, 'clients'));
    const client = copy();
    client.siteUrl = 'https://acme-roofing.pages.dev/';
    const filename = path.join(fixture, 'clients/acme-roofing.json');
    const output = path.join(fixture, 'dist/acme-roofing');
    const liveRobots = 'User-agent: *\nAllow: /\nSitemap: https://acme-roofing.pages.dev/sitemap.xml\n';
    const liveSitemap = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://acme-roofing.pages.dev/</loc></url></urlset>\n';
    let liveHTML;
    for (const preview of [false, undefined, true, false, true, undefined]) {
      if (preview === undefined) delete client.preview;
      else client.preview = preview;
      await writeFile(filename, JSON.stringify(client));
      const result = spawnSync(process.execPath, ['scripts/build.mjs', 'acme-roofing'], { cwd: fixture, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      const html = await readFile(path.join(output, 'index.html'), 'utf8');
      const robots = await readFile(path.join(output, 'robots.txt'), 'utf8');
      const files = await readdir(output);
      if (preview) {
        assert.equal(robots, 'User-agent: *\nAllow: /\n');
        assert.doesNotMatch(robots, /sitemap/i);
        assert.equal(await readFile(path.join(output, '_headers'), 'utf8'), '/*\n  X-Robots-Tag: noindex, nofollow\n');
        assert.ok(!files.includes('sitemap.xml'));
        assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
        assert.doesNotMatch(html, /application\/ld\+json/);
        assert.ok(html.includes(`Design preview made for ${client.businessName}. This is not the official website yet.`));
        assert.ok(result.stdout.includes('Note: acme-roofing.json: preview mode is on; indexing is disabled and crawling is allowed. Set "preview": false before going live.'));
      } else {
        assert.ok(!files.includes('_headers'));
        assert.equal(robots, liveRobots);
        assert.equal(await readFile(path.join(output, 'sitemap.xml'), 'utf8'), liveSitemap);
        assert.match(html, /<script type="application\/ld\+json">/);
        assert.doesNotMatch(html, /noindex|preview-banner/);
        assert.doesNotMatch(result.stdout, /preview mode is on/);
        if (liveHTML) assert.equal(html, liveHTML);
        liveHTML = html;
      }
      let bytes = 0;
      for (const file of files) bytes += (await readFile(path.join(output, file))).length;
      assert.ok(bytes < 150_000);
    }
  } finally { await rm(fixture, { recursive: true, force: true }); }
});

test('hours and automatic foreground colors remain usable', () => {
  assert.deepEqual(openingHours('Mon-Fri 8am-5pm; Sat 9:30am-1pm'), ['Mo-Fr 08:00-17:00', 'Sa 09:30-13:00']);
  assert.deepEqual(openingHours('24/7'), ['Mo-Su 00:00-23:59']);
  assert.throws(() => openingHours('Mon 25am-6pm'), /hours/);
  assert.equal(ink('#ffffff'), '#000000');
  assert.equal(ink('#000000'), '#ffffff');
  assert.equal(whiteContrast('#ffffff'), 1);
});

test('forms preserve POST, block the honeypot, and encode mailto fields', async () => {
  const source = await readFile(path.join(root, 'src/script.js'), 'utf8');
  for (const mode of ['post', 'mail', 'spam']) {
    let submit;
    let prevented = false;
    const status = { textContent: '' };
    const form = {
      elements: { _gotcha: { value: mode === 'spam' ? 'bot' : '' } },
      dataset: { mailto: mode === 'post' ? '' : 'mailto:owner@example.com' },
      addEventListener: (event, callback) => { submit = callback; }
    };
    const window = { location: { href: '' } };
    const values = { name: 'A & B', phone: '+12145550142', message: 'Roof? #1\nPlease call.' };
    runInNewContext(source, {
      document: { querySelector: selector => selector === 'form' ? form : status, querySelectorAll: () => [] },
      window,
      FormData: class { get(key) { return values[key]; } }
    });
    submit({ preventDefault: () => { prevented = true; } });
    assert.equal(prevented, mode !== 'post');
    if (mode === 'mail') {
      const target = new URL(window.location.href);
      assert.equal(target.searchParams.get('body'), `Name: ${values.name}\nPhone: ${values.phone}\n\n${values.message}`);
      assert.match(status.textContent, /send it there/);
    } else assert.equal(window.location.href, '');
  }
});

test('videoSource accepts supported HTTPS links and safe local video paths', () => {
  const id = 'AbcD_12-xyz';
  for (const prefix of ['', 'www.', 'm.']) {
    for (const url of [
      `https://${prefix}youtube.com/watch?v=${id}`,
      `https://${prefix}youtube.com/watch?feature=shared&v=${id}&t=10`,
      `https://${prefix}youtube.com/shorts/${id}?si=share`,
      `https://${prefix}youtu.be/${id}?t=10`
    ]) assert.deepEqual(videoSource(url), { type: 'youtube', id });
  }
  assert.deepEqual(videoSource('assets/promo.mp4'), { type: 'file', path: 'assets/promo.mp4', mime: 'video/mp4' });
  assert.deepEqual(videoSource('assets/client/crew.v2.webm'), { type: 'file', path: 'assets/client/crew.v2.webm', mime: 'video/webm' });
});

test('videoSource rejects unsafe hosts, protocols, IDs, and local paths', () => {
  for (const url of [
    '', null, 42, 'http://youtube.com/watch?v=AbcD_12-xyz', 'javascript:alert(1)',
    '//youtube.com/watch?v=AbcD_12-xyz', 'https://vimeo.com/AbcD_12-xyz',
    'https://youtube.com.evil.example/watch?v=AbcD_12-xyz',
    'https://evil.example/?v=AbcD_12-xyz', 'https://www.m.youtube.com/watch?v=AbcD_12-xyz',
    'https://owner@youtube.com/watch?v=AbcD_12-xyz', 'https://youtube.com:444/watch?v=AbcD_12-xyz',
    'https://youtube.com/watch', 'https://youtube.com/watch?v=short',
    'https://youtube.com/watch?v=AbcD_12-xyz0', 'https://youtube.com/watch?v=AbcD_12-xy!',
    'https://youtube.com/watch?v=AbcD_12-xyz&v=AbcD_12-xyz',
    'https://youtu.be/AbcD_12-xyz/extra', 'https://youtube.com/embed/AbcD_12-xyz',
    'https://youtube.com/shorts/short', ' https://youtu.be/AbcD_12-xyz',
    'https://youtu.be/AbcD_12-xyz\n', 'assets/promo.mov', '/assets/promo.mp4',
    '../assets/promo.mp4', 'assets/../promo.mp4', 'assets/nested/../../promo.mp4',
    'assets/%2e%2e/promo.mp4', 'assets\\promo.mp4', 'assets/promo.mp4?download=1'
  ]) assert.throws(() => videoSource(url), /^Error: video\.url:/, String(url));
});

test('validate reports video fields and requires a boolean sample flag', () => {
  const client = copy();
  client.video = { url: 'assets/promo.mp4', title: 'Meet our team' };
  assert.doesNotThrow(() => validate(client, 'acme-roofing.json'));
  for (const video of [
    { title: 'Meet our team' }, { url: 'assets/promo.mp4' },
    { url: 'assets/promo.mp4', title: ' ' },
    { url: 'assets/promo.mp4', title: 'Team', orientation: 'square' },
    { url: 'javascript:alert(1)', title: 'Team' }
  ]) assert.throws(() => validate({ ...copy(), video }, 'acme-roofing.json'), /video\./);
  assert.throws(() => validate({ ...copy(), reviewsAreSamples: 'true' }, 'acme-roofing.json'), /reviewsAreSamples: expected boolean/);
});

test('YouTube renders a facade below the hero, with no iframe on load', () => {
  const client = copy();
  client.video = { url: 'https://youtu.be/AbcD_12-xyz', title: 'Meet <our> "team"' };
  const { html } = render(client);
  assert.match(html, /<section class="section wrap promo-video"/);
  assert.match(html, /video-frame video-vertical/);
  assert.match(html, /<h2 id="video-title">Meet &lt;our&gt; &quot;team&quot;<\/h2>/);
  assert.match(html, /data-youtube-id="AbcD_12-xyz"/);
  assert.match(html, /https:\/\/i\.ytimg\.com\/vi\/AbcD_12-xyz\/hqdefault\.jpg/);
  assert.match(html, /loading="lazy" alt=""/);
  assert.match(html, /<noscript><p><a href="https:\/\/www\.youtube\.com\/watch\?v=AbcD_12-xyz"/);
  assert.doesNotMatch(html, /<iframe\b|youtube-nocookie\.com/);
  const section = html.match(/<section class="section wrap promo-video"[\s\S]*?<\/section>/)[0];
  assert.ok(section.includes(client.businessName));
  assert.ok(section.includes(`href="tel:${client.phone}"`));
  assert.ok(html.indexOf('promo-video') > html.indexOf('class="hero"'));
  assert.ok(html.indexOf('promo-video') < html.indexOf('aria-labelledby="services-title"'));
});

test('local video renders controls and a media path; missing video renders nothing', () => {
  for (const extension of ['mp4', 'webm']) {
    const client = copy();
    client.video = { url: `assets/client/clip.${extension}`, title: 'Our work', orientation: 'horizontal' };
    const { html } = render(client);
    assert.match(html, /video-frame video-horizontal/);
    assert.match(html, /<video controls playsinline preload="metadata" aria-label="Our work">/);
    assert.ok(html.includes(`src="media/promo.${extension}#t=0.1" type="video/${extension}"`));
    assert.ok(html.includes(`href="media/promo.${extension}">Download video</a>`));
    assert.doesNotMatch(html, /data-youtube-id|<iframe\b|poster=/);
    client.video.poster = '';
    assert.equal(render(client).html, html);
  }
  assert.doesNotMatch(render(copy()).html, /promo-video|<video\b|data-youtube-id/);
});

test('local posters use image validation and render without a media fragment', () => {
  for (const videoExtension of ['mp4', 'webm']) {
    for (const extension of ['jpg', 'jpeg', 'png', 'webp', 'avif']) {
      const client = copy();
      client.video = { url: `assets/promo.${videoExtension}`, title: 'Our work', poster: `assets/client/first-frame.${extension}` };
      assert.doesNotThrow(() => validate(client, 'acme-roofing.json'));
      const { html } = render(client);
      assert.ok(html.includes(`<video controls playsinline preload="metadata" aria-label="Our work" poster="media/poster.${extension}">`));
      assert.ok(html.includes(`src="media/promo.${videoExtension}" type="video/${videoExtension}"`));
      assert.ok(html.includes(`href="media/promo.${videoExtension}">Download video</a>`));
      assert.doesNotMatch(html, /#t=0\.1/);
    }
  }
  for (const poster of ['outside.jpg', '../poster.jpg', '/assets/poster.jpg', 'assets/../poster.jpg', 'assets/poster.svg', 'assets/poster.gif', 'assets/poster.mp4', 'https://example.com/poster.jpg']) {
    const client = copy();
    client.video = { url: 'assets/promo.mp4', title: 'Our work', poster };
    assert.throws(() => validate(client, 'acme-roofing.json'), /video\.poster: use an image path inside assets\//, poster);
  }
});

test('YouTube ignores poster configuration and preserves its facade', () => {
  const client = copy();
  client.video = { url: 'https://youtu.be/AbcD_12-xyz', title: 'Our work' };
  const original = render(client).html;
  for (const poster of ['assets/poster.jpg', '../unused.svg', null]) {
    client.video.poster = poster;
    assert.doesNotThrow(() => validate(client, 'acme-roofing.json'));
    assert.equal(client.video.poster, poster);
    const { html } = render(client);
    assert.equal(html, original);
    assert.match(html, /data-youtube-id="AbcD_12-xyz"/);
    assert.doesNotMatch(html, /poster=|<video\b|<iframe\b/);
  }
});

test('build copies posters, warns above 300 KB, and checks local poster path safety', async () => {
  const fixture = await mkdtemp(path.join(tmpdir(), 'homeservice-poster-'));
  try {
    for (const directory of ['scripts', 'schema', 'src']) await cp(path.join(root, directory), path.join(fixture, directory), { recursive: true });
    await mkdir(path.join(fixture, 'clients'));
    await mkdir(path.join(fixture, 'assets'));
    const client = copy();
    client.video = { url: 'assets/promo.mp4', title: 'Our work', poster: 'assets/first-frame.jpg' };
    const filename = path.join(fixture, 'clients/acme-roofing.json');
    await writeFile(filename, JSON.stringify(client));
    await writeFile(path.join(fixture, 'assets/promo.mp4'), 'test media bytes');
    const poster = Buffer.alloc(300_001);
    await writeFile(path.join(fixture, 'assets/first-frame.jpg'), poster);
    const run = () => spawnSync(process.execPath, ['scripts/build.mjs', 'acme-roofing'], { cwd: fixture, encoding: 'utf8' });
    let result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /assets\/first-frame\.jpg is over 300 KB/);
    const output = path.join(fixture, 'dist/acme-roofing');
    assert.deepEqual(await readFile(path.join(output, 'media/poster.jpg')), poster);
    assert.match(await readFile(path.join(output, 'index.html'), 'utf8'), /poster="media\/poster\.jpg"/);

    await writeFile(path.join(fixture, 'outside.jpg'), 'outside assets');
    await symlink(path.join(fixture, 'outside.jpg'), path.join(fixture, 'assets/escape.jpg'));
    client.video.poster = 'assets/escape.jpg';
    await writeFile(filename, JSON.stringify(client));
    result = run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /assets\/escape\.jpg: asset must remain inside assets\//);
    assert.deepEqual(await readFile(path.join(output, 'media/poster.jpg')), poster);

    client.video.url = 'https://youtu.be/AbcD_12-xyz';
    for (const ignoredPoster of ['assets/escape.jpg', 'assets/missing.jpg', '../unused.svg']) {
      client.video.poster = ignoredPoster;
      await writeFile(filename, JSON.stringify(client));
      result = run();
      assert.equal(result.status, 0, result.stderr);
      assert.doesNotMatch(result.stderr, /300 KB/);
      assert.match(await readFile(path.join(output, 'index.html'), 'utf8'), /data-youtube-id="AbcD_12-xyz"/);
      assert.doesNotMatch(await readFile(path.join(output, 'index.html'), 'utf8'), /poster=/);
      assert.ok(!(await readdir(output)).includes('media'));
    }
  } finally { await rm(fixture, { recursive: true, force: true }); }
});

test('sample labels cover every reviewer and suppress only sample aggregate ratings', () => {
  for (const samples of [true, false, undefined]) {
    const client = copy();
    client.preview = false;
    if (samples === undefined) delete client.reviewsAreSamples;
    else client.reviewsAreSamples = samples;
    const { html } = render(client);
    const data = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);
    const captions = [...html.matchAll(/<figcaption>(.*?)<\/figcaption>/g)];
    assert.equal(captions.length, client.reviews.length);
    for (const [, caption] of captions) assert.equal(caption.includes('<span class="sample-tag">Sample</span>'), samples === true);
    assert.equal(html.includes('Sample reviews for this preview. Your real customer reviews will replace them.'), samples === true);
    assert.equal(html.includes('4.75 out of 5 from 4 sample reviews'), samples === true);
    assert.equal(html.includes('<span>Sample rating</span>'), samples === true);
    assert.equal(Object.hasOwn(data, 'aggregateRating'), samples !== true);
    if (!samples) {
      assert.match(html, /4.75 out of 5 from 4 reviews/);
      assert.match(html, /<span>Customer rating<\/span>/);
      assert.equal(data.aggregateRating.ratingValue, 4.75);
    }
  }
});

test('YouTube iframe is created only on click and failed thumbnails are removed', async () => {
  const script = await readFile(path.join(root, 'src/script.js'), 'utf8');
  for (const cachedFailure of [false, true]) {
    const handlers = {};
    const created = [];
    let removed = false;
    let replacement;
    let focused = false;
    const thumbnail = {
      complete: cachedFailure, naturalWidth: 0,
      addEventListener: (event, callback) => { handlers[event] = callback; },
      remove: () => { removed = true; }
    };
    const button = {
      dataset: { youtubeId: 'AbcD_12-xyz', videoTitle: 'Our team' },
      querySelector: () => thumbnail,
      addEventListener: (event, callback, options) => { handlers[event] = callback; assert.equal(options.once, true); },
      replaceWith: element => { replacement = element; }
    };
    runInNewContext(script, {
      document: {
        querySelector: () => null,
        querySelectorAll: () => [button],
        createElement: tag => { const element = { tag, focus: () => { focused = true; } }; created.push(element); return element; }
      }
    });
    assert.equal(created.length, 0);
    assert.equal(replacement, undefined);
    assert.equal(removed, cachedFailure);
    handlers.error();
    assert.equal(removed, true);
    handlers.click();
    assert.equal(created.length, 1);
    assert.equal(replacement.tag, 'iframe');
    assert.equal(replacement.src, 'https://www.youtube-nocookie.com/embed/AbcD_12-xyz?autoplay=1&playsinline=1&rel=0');
    assert.equal(replacement.title, 'Our team');
    assert.equal(replacement.allowFullscreen, true);
    assert.equal(focused, true);
  }
});

test('build copies local media, warns on large files, and rejects escaped symlinks', async () => {
  const fixture = await mkdtemp(path.join(tmpdir(), 'homeservice-video-'));
  try {
    for (const directory of ['scripts', 'schema', 'src']) await cp(path.join(root, directory), path.join(fixture, directory), { recursive: true });
    await mkdir(path.join(fixture, 'clients'));
    await mkdir(path.join(fixture, 'assets'));
    const client = copy();
    client.video = { url: 'assets/promo.mp4', title: 'Our team' };
    client.reviewsAreSamples = false;
    const filename = path.join(fixture, 'clients/acme-roofing.json');
    await writeFile(filename, JSON.stringify(client));
    const bytes = Buffer.alloc(15_000_001);
    await writeFile(path.join(fixture, 'assets/promo.mp4'), bytes);
    const run = () => spawnSync(process.execPath, ['scripts/build.mjs', 'acme-roofing'], { cwd: fixture, encoding: 'utf8' });
    let result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /over 15 MB/);
    assert.match(result.stdout, /reviews are shown as real customer reviews/);
    assert.deepEqual(await readFile(path.join(fixture, 'dist/acme-roofing/media/promo.mp4')), bytes);
    delete client.reviewsAreSamples;
    await writeFile(filename, JSON.stringify(client));
    result = run();
    assert.match(result.stdout, /reviews are shown as real customer reviews/);
    await writeFile(path.join(fixture, 'outside.mp4'), 'outside assets');
    await symlink(path.join(fixture, 'outside.mp4'), path.join(fixture, 'assets/escape.mp4'));
    client.video.url = 'assets/escape.mp4';
    await writeFile(filename, JSON.stringify(client));
    result = run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /asset must remain inside assets/);
    assert.deepEqual(await readFile(path.join(fixture, 'dist/acme-roofing/media/promo.mp4')), bytes);
  } finally { await rm(fixture, { recursive: true, force: true }); }
});

test('dev server serves MP4 and WebM using video MIME types', async () => {
  const fixture = await mkdtemp(path.join(tmpdir(), 'homeservice-dev-'));
  let child;
  try {
    for (const directory of ['scripts', 'schema', 'src']) await cp(path.join(root, directory), path.join(fixture, directory), { recursive: true });
    await mkdir(path.join(fixture, 'clients'));
    await mkdir(path.join(fixture, 'assets'));
    for (const extension of ['mp4', 'webm']) {
      const client = copy(); client.slug = `video-${extension}`;
      client.video = { url: `assets/promo.${extension}`, title: 'Our team' };
      await writeFile(path.join(fixture, `clients/${client.slug}.json`), JSON.stringify(client));
      await writeFile(path.join(fixture, `assets/promo.${extension}`), 'test media bytes');
    }
    const reservation = createServer();
    await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
    const port = reservation.address().port;
    await new Promise(resolve => reservation.close(resolve));
    child = spawn(process.execPath, ['scripts/dev.mjs'], { cwd: fixture, env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Dev server did not start')), 10_000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`Dev server exited: ${code}`)); });
      child.stdout.on('data', data => { if (data.toString().includes('Preview:')) { clearTimeout(timer); resolve(); } });
    });
    for (const extension of ['mp4', 'webm']) {
      const response = await fetch(`http://127.0.0.1:${port}/video-${extension}/media/promo.${extension}`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-type'), `video/${extension}`);
      assert.equal(await response.text(), 'test media bytes');
    }
  } finally {
    if (child && child.exitCode === null) await new Promise(resolve => { child.once('exit', resolve); child.kill(); });
    await rm(fixture, { recursive: true, force: true });
  }
});

test('CLI builds every client within budget and rejects invalid arguments', async () => {
  const result = spawnSync(process.execPath, ['scripts/build.mjs', '--all'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  for (const name of await readdir(path.join(root, 'clients'))) {
    const client = JSON.parse(await readFile(path.join(root, 'clients', name)));
    const directory = path.join(root, 'dist', client.slug);
    let bytes = 0;
    const files = ['index.html', 'styles.css', 'script.js', 'robots.txt'];
    files.push(client.preview ? '_headers' : 'sitemap.xml');
    for (const file of files) bytes += (await readFile(path.join(directory, file))).length;
    assert.ok(bytes < 150_000);
    assert.equal((await readdir(directory)).includes('sitemap.xml'), !client.preview);
    assert.equal((await readdir(directory)).includes('_headers'), Boolean(client.preview));
    const html = await readFile(path.join(directory, 'index.html'), 'utf8');
    assert.ok(html.includes(`href="tel:${client.phone}"`));
    assert.equal((html.match(/<details>/g) || []).length, client.faqs.length);
  }
  const invalid = spawnSync(process.execPath, ['scripts/build.mjs', '../escape'], { cwd: root, encoding: 'utf8' });
  assert.notEqual(invalid.status, 0);
});
