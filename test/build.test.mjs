import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { validate, openingHours, ink, whiteContrast } from '../scripts/validate.mjs';
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
  client.businessName = '</script><img src=x onerror=alert(1)>"&';
  validate(client, 'acme-roofing.json');
  const { html } = render(client);
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('&lt;/script&gt;'));
  const json = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1];
  assert.equal(JSON.parse(json).name, client.businessName);
  assert.ok(!json.includes('<'));
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
      document: { querySelector: selector => selector === 'form' ? form : status },
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

test('CLI builds every client within budget and rejects invalid arguments', async () => {
  const result = spawnSync(process.execPath, ['scripts/build.mjs', '--all'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  for (const name of await readdir(path.join(root, 'clients'))) {
    const client = JSON.parse(await readFile(path.join(root, 'clients', name)));
    const directory = path.join(root, 'dist', client.slug);
    let bytes = 0;
    for (const file of ['index.html', 'styles.css', 'script.js', 'robots.txt', 'sitemap.xml']) bytes += (await readFile(path.join(directory, file))).length;
    assert.ok(bytes < 150_000);
    const html = await readFile(path.join(directory, 'index.html'), 'utf8');
    assert.ok(html.includes(`href="tel:${client.phone}"`));
    assert.equal((html.match(/<details>/g) || []).length, client.faqs.length);
  }
  const invalid = spawnSync(process.execPath, ['scripts/build.mjs', '../escape'], { cwd: root, encoding: 'utf8' });
  assert.notEqual(invalid.status, 0);
});
