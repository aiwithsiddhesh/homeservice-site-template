import { ink, openingHours, videoSource } from './validate.mjs';

export const escapeHTML = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const jsonScript = value => JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
const paths = {
  wrench: 'M14 6a5 5 0 0 0-6 6L3 17a3 3 0 0 0 4 4l5-5a5 5 0 0 0 6-6l-3 3-4-4 3-3Z',
  home: 'm3 11 9-8 9 8M5 10v11h14V10M9 21v-7h6v7',
  leaf: 'M20 3C9 2 3 7 4 14c1 7 12 8 15-2l1-9ZM4 21 15 10',
  droplet: 'M12 3C9 8 5 11 5 15a7 7 0 0 0 14 0c0-4-4-7-7-12Z',
  snowflake: 'M12 2v20M3 7l18 10M3 17 21 7M9 4l3 3 3-3M9 20l3-3 3 3M3 10l4-1V5M21 14l-4 1v4M3 14l4 1v4M21 10l-4-1V5',
  bolt: 'm13 2-9 12h7l-1 8 10-12h-7l1-8Z'
};
const icon = name => `<svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name]}"/></svg>`;

function promoVideo(client) {
  if (!client.video) return '';
  const e = escapeHTML;
  const video = client.video;
  const source = videoSource(video.url);
  const orientation = video.orientation || 'vertical';
  const media = source.type === 'file' ? `media/promo.${source.mime.split('/')[1]}` : '';
  const poster = source.type === 'file' && video.poster ? `media/poster.${video.poster.split('.').pop()}` : '';
  const player = source.type === 'youtube'
    ? `<button class="video-facade" type="button" data-youtube-id="${source.id}" data-video-title="${e(video.title)}" aria-label="Play video: ${e(video.title)}">
        <img src="https://i.ytimg.com/vi/${source.id}/hqdefault.jpg" width="480" height="360" loading="lazy" alt="">
        <span class="video-play"><svg viewBox="0 0 24 24" width="64" height="64" aria-hidden="true"><path fill="currentColor" d="m8 4 12 8-12 8Z"/></svg><span>Play video</span></span>
      </button>`
    : `<video controls playsinline preload="metadata" aria-label="${e(video.title)}"${poster ? ` poster="${e(poster)}"` : ''}><source src="${media}${poster ? '' : '#t=0.1'}" type="${source.mime}">Your browser does not support this video. <a href="${media}">Download video</a>.</video>`;
  return `<section class="section wrap promo-video" aria-labelledby="video-title">
      <div class="video-copy"><h2 id="video-title">${e(video.title)}</h2><p>Get to know ${e(client.businessName)} and the work we do for local homes.</p><a class="button" href="tel:${e(client.phone)}">Call ${e(client.phoneDisplay)}</a></div>
      <div class="video-media"><div class="video-frame video-${e(orientation)}">${player}</div>
        ${source.type === 'youtube' ? `<noscript><p><a href="https://www.youtube.com/watch?v=${source.id}">Watch ${e(video.title)} on YouTube</a></p></noscript>` : ''}
      </div>
    </section>`;
}

export function render(client, images = {}) {
  const c = client;
  const e = escapeHTML;
  const trade = c.trade[0].toUpperCase() + c.trade.slice(1);
  const heading = `${trade} in ${c.city}, ${c.state}`;
  const title = `${heading} | ${c.businessName}`;
  const description = `${c.businessName}: ${c.tagline}. Serving ${c.serviceAreas.join(', ')}. Call ${c.phoneDisplay} for a free estimate.`;
  const canonical = (c.siteUrl || `https://example.com/${c.slug}`).replace(/\/+$/, '') + '/';
  const average = (c.reviews.reduce((sum, review) => sum + review.stars, 0) / c.reviews.length).toFixed(2).replace(/0$/, '');
  const email = `mailto:${encodeURIComponent(c.email)}`;
  const call = `tel:${c.phone}`;
  const rating = `${average} out of 5 from ${c.reviews.length} ${c.reviewsAreSamples ? 'sample ' : ''}reviews`;
  const business = {
    '@context': 'https://schema.org', '@type': 'LocalBusiness', '@id': `${canonical}#business`,
    name: c.businessName, url: canonical, telephone: c.phone, email: c.email,
    address: { '@type': 'PostalAddress', addressLocality: c.city, addressRegion: c.state, addressCountry: 'US' },
    areaServed: c.serviceAreas.map(name => ({ '@type': 'City', name })),
    openingHours: openingHours(c.hours)
  };
  if (!c.reviewsAreSamples) business.aggregateRating = { '@type': 'AggregateRating', ratingValue: Number(average), reviewCount: c.reviews.length, bestRating: 5, worstRating: 1 };
  if (images.hero) business.image = new URL(images.hero, canonical).href;
  if (images.logo) business.logo = new URL(images.logo, canonical).href;
  const areas = c.serviceAreas.map(area => `<li>${e(area)}</li>`).join('');
  return {
    canonical,
    themeCSS: `:root{--primary:${c.theme.primary};--shade:${ink(c.theme.primary) === '#ffffff' ? '#000000' : '#ffffff'};--on-primary:${ink(c.theme.primary)};--accent:${c.theme.accent};--on-accent:${ink(c.theme.accent)}}\n`,
    html: `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>${e(title)}</title>
  <meta name="description" content="${e(description)}">
  <meta name="theme-color" content="${c.theme.primary}">
  <link rel="canonical" href="${e(canonical)}">
  <meta property="og:type" content="website">
  <meta property="og:locale" content="en_US">
  <meta property="og:site_name" content="${e(c.businessName)}">
  <meta property="og:title" content="${e(title)}">
  <meta property="og:description" content="${e(description)}">
  <meta property="og:url" content="${e(canonical)}">
  ${images.hero ? `<meta property="og:image" content="${e(business.image)}"><meta property="og:image:alt" content="${e(c.theme.heroImageAlt)}">` : ''}
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='%23${c.theme.primary.slice(1)}' d='M2 11 12 2l10 9v11H2Z'/%3E%3C/svg%3E">
  <link rel="stylesheet" href="styles.css">
  <script src="script.js" defer></script>
  <script type="application/ld+json">${jsonScript(business)}</script>
  <!-- Optional client-approved Google Analytics or Meta Pixel hook. -->
</head>
<body>
  <a class="skip-link" href="#main">Skip to content</a>
  <header class="topbar">
    <div class="wrap topbar-inner">
      <a class="brand" href="#main">${images.logo ? `<img class="logo" src="${images.logo}" width="44" height="44" alt="${e(c.theme.logoAlt)}">` : ''}<span>${e(c.businessName)}</span></a>
      <a class="button compact" href="${call}">Call ${e(c.phoneDisplay)}</a>
    </div>
  </header>
  <main id="main" tabindex="-1">
    <section class="hero" aria-labelledby="hero-title">
      <div class="wrap hero-grid">
        <div>
          <p class="eyebrow">${e(c.businessName)} · ${e(c.city)}, ${e(c.state)}</p>
          <h1 id="hero-title">${e(heading)}</h1>
          <p class="tagline">${e(c.tagline)}</p>
          <p class="hero-subtext">${e(c.heroSubtext)}</p>
          <div class="actions">
            <a class="button accent" href="${call}">Call ${e(c.phoneDisplay)} <span aria-hidden="true">↗</span></a>
            <a class="button outline" href="#quote">Get a free quote</a>
          </div>
          <ul class="trust" aria-label="Business details">
            <li>${e(c.yearsInBusiness)} years in business</li>
            ${c.licenseNumber ? `<li>License: ${e(c.licenseNumber)}</li>` : ''}
            <li>Free estimates</li>
          </ul>
        </div>
        <div class="hero-panel">
          ${images.hero ? `<img class="hero-image" src="${images.hero}" width="960" height="720" alt="${e(c.theme.heroImageAlt)}" fetchpriority="high" decoding="async">` : `<div class="hero-art" aria-hidden="true">${icon('home')}</div>`}
          <div class="hero-facts"><div><strong>${e(c.yearsInBusiness)}</strong><span>Years in business</span></div><div><strong>${average}<span class="small"> / 5</span></strong><span>${c.reviewsAreSamples ? 'Sample rating' : 'Customer rating'}</span></div></div>
        </div>
      </div>
    </section>
    ${promoVideo(c)}
    <section class="section wrap" aria-labelledby="services-title">
      <p class="eyebrow">01 / What we do</p><h2 id="services-title">Services for your home</h2>
      <div class="grid services">${c.services.map(service => `<article class="card"><div class="icon">${icon(service.icon)}</div><h3>${e(service.title)}</h3><p>${e(service.description)}</p></article>`).join('')}</div>
    </section>
    <section class="section reviews" aria-labelledby="reviews-title">
      <div class="wrap"><p class="eyebrow">02 / Customer experiences</p><h2 id="reviews-title">What our customers say</h2>
        ${c.reviewsAreSamples ? '<p class="sample-note">Sample reviews for this preview. Your real customer reviews will replace them.</p>' : ''}
        <p class="rating">${e(rating)}</p>
        <div class="grid">${c.reviews.map(review => `<figure class="card"><p class="stars"><span aria-hidden="true">${'★'.repeat(review.stars)}${'☆'.repeat(5 - review.stars)}</span><span class="sr-only">${review.stars} out of 5 stars</span></p><blockquote><p>“${e(review.text)}”</p></blockquote><figcaption>${e(review.name)}${c.reviewsAreSamples ? ' <span class="sample-tag">Sample</span>' : ''}</figcaption></figure>`).join('')}</div>
      </div>
    </section>
    <section class="section wrap areas" aria-labelledby="areas-title">
      <div><p class="eyebrow">03 / Close to home</p><h2 id="areas-title">Proudly serving your area</h2><p>${e(c.city)}, ${e(c.state)} &amp; surrounding communities</p></div>
      <ul class="area-list">${areas}</ul>
    </section>
    <section class="section faq-section" aria-labelledby="faq-title">
      <div class="wrap narrow"><p class="eyebrow">04 / Good to know</p><h2 id="faq-title">Your questions, answered</h2>
        ${c.faqs.map(faq => `<details><summary>${e(faq.q)}</summary><p>${e(faq.a)}</p></details>`).join('')}
      </div>
    </section>
    <section id="quote" class="section wrap quote-grid" aria-labelledby="quote-title">
      <div><p class="eyebrow">05 / Let's get started</p><h2 id="quote-title">Tell us what your home needs.</h2><p>For the quickest way to reach us, call directly.</p><a class="call-link" href="${call}">${e(c.phoneDisplay)} ↗</a><p>${e(c.hours)}</p></div>
      <form action="${e(c.formAction || email)}" method="post" ${c.formAction ? '' : 'enctype="text/plain"'} data-mailto="${c.formAction ? '' : e(email)}">
        <label for="name">Your name</label><input id="name" name="name" autocomplete="name" maxlength="100" required>
        <label for="phone">Phone number</label><input id="phone" name="phone" type="tel" autocomplete="tel" inputmode="tel" maxlength="30" pattern="[+0-9\\(\\) .\\-]{7,30}" required>
        <label for="message">How can we help?</label><textarea id="message" name="message" rows="4" maxlength="1500" required></textarea>
        <div class="honeypot" aria-hidden="true"><label for="website">Leave this empty</label><input id="website" name="_gotcha" tabindex="-1" autocomplete="off"></div>
        <button class="button" type="submit">${c.formAction ? 'Request a free quote' : 'Open email with my request'}</button>
        <p class="form-note">${c.formAction ? 'Your details are sent through Formspree so we can respond to your request.' : 'Opens your email app. Review your request and press Send there. Nothing is sent automatically.'}</p>
        <p id="form-status" role="status" aria-live="polite"></p>
        <noscript><p>You can also <a href="${e(email)}">email us directly</a> or call ${e(c.phoneDisplay)}.</p></noscript>
      </form>
    </section>
  </main>
  <footer>
    <div class="wrap footer-grid"><div><p class="footer-name">${e(c.businessName)}</p><a href="${call}">${e(c.phoneDisplay)}</a><a href="${e(email)}">${e(c.email)}</a></div><div><p class="eyebrow">Hours &amp; service areas</p><p>${e(c.hours)}</p><p>${e(c.serviceAreas.join(' · '))}</p></div></div>
    <div class="wrap copyright"><small>© ${new Date().getFullYear()} ${e(c.businessName)}. All rights reserved.</small></div>
  </footer>
  <div class="mobile-call"><a class="button accent" href="${call}">Call now <span>${e(c.phoneDisplay)}</span></a></div>
</body>
</html>\n`
  };
}
