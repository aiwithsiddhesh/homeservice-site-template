# Home Service Site Template

A call-first, one-page static website generator. Customize one JSON file per
client. No frameworks, npm dependencies, web fonts, tracking, or cookies by default.
Node 18+ is supported; use a currently supported Node LTS for new deployments.

All three examples are fictional demonstrations. Replace their phone numbers,
emails, reviews, experience claims, and demo license before publishing. Only
publish genuine reviews with permission. A displayed rating does not guarantee
Google review rich results.

## Quick start

```bash
npm install
npm run build -- acme-roofing
npm run build:all
npm run dev
```

Open http://127.0.0.1:3000/acme-roofing/ or the client chooser at
http://127.0.0.1:3000/. Stop the server with Ctrl+C.

Each build writes `dist/<slug>/index.html`, `styles.css`, `script.js`,
`robots.txt`, `sitemap.xml`, and any referenced images or local videos. Deploy the contents of
one client directory as the site's root. `dist/` is intentionally gitignored.
Builds replace that client's output; edit the source JSON, not generated files.

## Make a new client site in 30 minutes

- [ ] Minutes 0-5: duplicate a sample into `clients/<client-slug>.json`. Set
  `slug` to match the filename without `.json`.
- [ ] Minutes 5-12: edit the business name, trade, city, service areas, phone,
  email, hours, tagline, services, and FAQs. Check every factual claim.
- [ ] Minutes 12-18: replace all sample reviews with real approved reviews,
  set `reviewsAreSamples` to `false`,
  choose brand colors, and add a logo or project photo under `assets/`.
  Set `theme.logoImage` plus `theme.logoAlt`, or `theme.heroImage` plus
  `theme.heroImageAlt`. Empty image paths use the CSS-only design.
- [ ] Minutes 18-22: set `siteUrl` to the final HTTPS URL and `formAction` to
  the verified Formspree endpoint, or keep it empty for email-app fallback.
- [ ] Minutes 22-26: run `npm run build -- <client-slug>` and `npm run dev`.
  Check 360px and desktop widths, all call buttons, FAQs, keyboard focus,
  the form destination, and a real test submission.
- [ ] Minutes 26-30: deploy that client's output, attach its custom domain,
  confirm HTTPS, and run Lighthouse against the live site.

The timing assumes approved copy, real reviews, photos, and domain access are
already available. DNS propagation and account verification may take longer.

## JSON rules

`schema/client.schema.json` documents the input. The zero-dependency validator
enforces its used keywords, then checks filename matching, hours, URL safety,
and image alt text. It is deliberately not a general-purpose JSON Schema engine.

- Phone numbers use strict E.164 syntax: `+12145550142`, never
  `+1-214-555-0142`. This checks syntax, not assignment or call reachability.
- `phoneDisplay` is independent; check that it represents the same number.
- Colors must be six-digit hex. The build warns when primary versus white is
  below 4.5:1 and automatically uses black text. Accent text also selects black
  or white for contrast.
- Hours accept `Mon-Sat 7am-6pm`, `Mon-Fri 8am-5pm; Sat 9:30am-1pm`,
  individual days, overnight ranges, or `24/7`. Use Mon/Tue/Wed/Thu/Fri/Sat/Sun.
  Unlisted days are closed. The build converts this to structured opening hours.
- Use an empty `licenseNumber` when it does not apply. Do not invent a license.
- `siteUrl` is an optional extension to the requested schema: the final HTTPS
  site root, optionally including a subdirectory. No credentials, query, or
  fragment. Empty or omitted means an explicit example.com canonical placeholder
  and a build warning. Set it and rebuild before publishing.
- Image paths are local under `assets/`; external URLs and SVG files are not
  accepted. Files must exist. Optional `heroImageAlt`, `logoImage`, and `logoAlt`
  live inside `theme`. Alt text is mandatory for each supplied image.
- The hero is cropped to 4:3. Choose a suitable photo; the logo uses contain.
  Images are copied unchanged. Compress them yourself; prefer WebP or AVIF.
- Keep at least one service, review, FAQ, and service area. Icons are `wrench`,
  `home`, `leaf`, `droplet`, `snowflake`, or `bolt`.
- Generic interface labels are English. Business content comes from the JSON.
  The template assumes a US business that offers free estimates.

For each new client, change colors, project photos/logo, headline and benefit
copy, the service mix, and authentic local reviews to make the result distinct.

## Mockups, sample reviews and video

Keep `reviewsAreSamples` set to `true` for mockups. All three sample clients use
this setting: the page labels every review and the hero rating as samples, shows
a preview notice, and omits `aggregateRating` from JSON-LD. For paying clients,
replace every sample with a real approved customer review, then set the flag to
`false`. False or omitted preserves normal review display and prints a build note
that reviews are shown as real customer reviews.

Before deploying, set `siteUrl` to the live address, for example
`https://<slug>.pages.dev/`, replacing `<slug>` with the actual project name.
Rebuild when moving to a custom domain. This updates the canonical, sitemap,
and social metadata.

Add this optional object at the top level of a client JSON file, replacing the
example URL and title with the client's approved video:

```json
"video": {
  "url": "assets/acme/team.mp4",
  "title": "See our team at work",
  "orientation": "vertical",
  "poster": "assets/acme/team-poster.jpg"
}
```

Accepted YouTube formats are `https://youtube.com/watch?v=ID`,
`https://youtu.be/ID`, and `https://youtube.com/shorts/ID`. The `www.` and `m.`
host prefixes are also accepted. IDs must contain exactly 11 letters, digits,
underscores, or hyphens. HTTPS is required; other hosts and embed URLs are rejected.
Extra query parameters are accepted, but playback uses only the validated ID.

The YouTube player loads only after tapping Play video. Before that, the page
shows a button and a lazy-loaded thumbnail from YouTube's image server; that
thumbnail still makes a third-party image request. Playback uses
`youtube-nocookie.com`. Visitors without JavaScript get a link to watch on YouTube.
If the thumbnail cannot load, the play button remains available.

For local video, use a path such as `assets/acme/team.mp4` or
`assets/acme/team.webm`. Use letters, digits, underscores, hyphens, or dots in
names; do not use spaces, traversal segments, or paths outside `assets/`.
The file must exist and is copied unchanged to `media/promo.mp4` or
`media/promo.webm` in the client output. MP4 and WebM are the only accepted
extensions. Native controls appear, inline playback is enabled, and preload is
limited to metadata. Compress clips for mobile and aim below 15 MB; larger files
produce a build warning. Video bytes are separate from the 150 KB page-code
budget. MP4 with H.264 video and AAC audio is a practical compatibility choice;
verify playback on your target phones and include captions in the supplied clip
when speech conveys information.

For local files only, the optional `poster` image provides a preview before
playback, including on iPhone Safari. Export the first frame in CapCut as a
540x960 JPG under 300 KB for a vertical clip (use matching proportions for
horizontal footage). Save it inside `assets/` and set `video.poster` to its path.
JPG, JPEG, PNG, WebP, and AVIF are accepted, using the same filename rules as
`theme.heroImage`. The build copies it to `media/poster.<ext>` and warns above
300 KB. Local poster files must exist and cannot escape `assets/` through symlinks.
Omit the field or use an empty string to add `#t=0.1` to the video source as an
iOS first-frame fallback; the download link keeps its original URL. YouTube links
need no poster: the field is ignored entirely, and YouTube keeps its thumbnail.

Orientation defaults to `vertical` (9:16, at most 340px wide). Use `horizontal`
for 16:9 footage. The plain-text title becomes the heading and accessible player
label. Omit the whole `video` object to hide the section. No video is configured
in the sample clients.

## Forms with Formspree

1. Create a Formspree account and a form for the client's verified recipient.
2. Copy its complete `https://formspree.io/f/` endpoint into `formAction`.
3. Rebuild and deploy. Submit a real test, check the inbox and spam folder, and
   confirm the reply workflow with the owner.
4. The browser submits a normal POST, then follows Formspree's response page.
   The hidden `_gotcha` field is recognized by Formspree as a honeypot. Configure
   any additional spam controls in the Formspree dashboard.

With `formAction` empty, JavaScript opens a `mailto:` draft containing the name,
phone, and message. The visitor must press Send in their email app. No delivery
is claimed, and no form data is stored here. This fallback requires an email
handler; Formspree is the better option for reliable lead capture. With JavaScript
disabled, native mailto behavior varies, and direct email/call links remain.

## Cloudflare Pages

### Drag and drop

1. Build the client locally.
2. In Workers & Pages, create a Pages project using Direct Upload.
3. Upload `dist/<client-slug>` (the directory containing `index.html`) and deploy.
4. For later updates, rebuild and upload the refreshed directory.

Choose Direct Upload or Git integration when creating the project; switching
deployment modes may require a new project.

### Connect the repository

1. Push this repository to GitHub using the delivery commands.
2. Create a Pages project and connect the repository.
3. Set framework preset to None, build command to
   `npm run build -- acme-roofing`, and output directory to `dist/acme-roofing`.
   Change both client slugs for another client. Keep the repository root as base.
4. Choose a supported Node LTS in the build environment. Deploy.
5. Use a separate hosting project for each client, pointing to that client's
   output directory. Never publish all clients accidentally.

### Custom domain

Open the Pages project's Custom domains, choose Set up a domain, and follow the
wizard. An apex domain requires adding the domain to Cloudflare and configuring
its nameservers. For an externally managed subdomain, register it in the Pages
wizard first and add the instructed CNAME. Wait for domain activation and HTTPS.
Update `siteUrl` to the chosen primary domain, rebuild, and redeploy. Configure
redirects from alternate hostnames in the hosting dashboard.

## Netlify

### Drag and drop

Build locally, sign in to Netlify, and use its manual deploy dropzone to upload
`dist/<client-slug>`. The folder must contain `index.html` directly. Rebuild
locally before every manual upload.

### Connect the repository

Import the GitHub repository. Use the repository root as base directory,
`npm run build -- acme-roofing` as build command, and `dist/acme-roofing` as publish
directory. Select a supported Node LTS. Change both slugs per client and deploy.

### Custom domain

In Domain management, add a domain you already own. Follow Netlify's instructions
for Netlify DNS or external DNS, apply the displayed records at your DNS provider,
and verify HTTPS. Set the primary domain, update `siteUrl`, rebuild, and redeploy.

## Development and quality checks

```bash
npm test
npm run build:all
npm run dev
```

The local server binds to loopback only. It rebuilds and reloads after edits to
`clients/`, `src/`, or `assets/`, including new files. Restart it after changing
`scripts/` or `schema/`. A failed validation keeps the previous generated output.
Use `PORT=3001 npm run dev` on Bash if port 3000 is occupied.

The tests cover schema errors, E.164 syntax, injection escaping, hours, contrast,
video URL validation, click-to-load players, local media copying and MIME types,
sample-review labels and structured data, all-client builds, and the 150 KB budget.
No browser dependency is
installed in the project. HTML, CSS, JavaScript, robots, and sitemap bytes combined
must remain below 150,000 bytes before compression, excluding images and video.

For Lighthouse, open the deployed HTTPS site in a clean Chrome profile. Open
DevTools > Lighthouse, choose Mobile and Navigation, select Performance,
Accessibility, Best Practices, and SEO, then Analyze page load. Run three times
and inspect the median. Fix actual failed audits and retest after adding photos
or third-party scripts. For local audits, use
http://127.0.0.1:3000/acme-roofing/?no-reload to disable the development reload
script. The target is 95+ in each category, not a guaranteed measured result.

Also test at 360px and 1440px, with keyboard-only navigation and reduced motion.
Check a real telephone call and form delivery. Automated scores alone cannot
verify those workflows or full WCAG conformance.

## Troubleshooting

- **Build fails:** read the filename and JSON field in the error. Check commas,
  required fields, filename/slug matching, phone format, and hours syntax.
- **Missing photo:** verify its local path, case, allowed extension, and alt text.
  Keep it inside `assets/`; the build rejects symlinks that escape that directory.
- **Video rejected or missing:** use an accepted HTTPS YouTube URL with an
  11-character ID, or an existing `.mp4`/`.webm` file inside `assets/`. Check
  filename case. A valid YouTube ID does not guarantee a public, embeddable video.
- **404 or missing styles:** deploy the client output folder, not the repository
  or parent `dist/`. Preview subdirectories with their trailing slash.
- **Old content:** edit source JSON and rebuild. Dev validation failures leave
  the previous output visible; check the terminal and correct the input.
- **Email does not open:** configure a default email app or use Formspree. A
  mailto draft is not proof that a message was sent.
- **Formspree delivery fails:** verify the endpoint and recipient in Formspree,
  review its dashboard, and run another real submission.
- **Wrong canonical or sitemap:** set `siteUrl` to the final site root and rebuild.
- **Slow hero:** resize/compress the image. The image-byte budget is separate.

## Official references

- https://developers.cloudflare.com/pages/get-started/direct-upload/
- https://developers.cloudflare.com/pages/configuration/git-integration/
- https://developers.cloudflare.com/pages/configuration/custom-domains/
- https://docs.netlify.com/manage/projects/add-new-project/
- https://docs.netlify.com/build/configure-builds/overview/
- https://docs.netlify.com/manage/domains/configure-domains/bring-a-domain-to-netlify/
- https://help.formspree.io/articles/building-your-form/building-an-html-form/
- https://help.formspree.io/articles/building-your-form/honeypot-spam-filtering
