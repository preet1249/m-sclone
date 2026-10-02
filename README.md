# Mistry & Shah LLP — Static Clone

A pixel-faithful, backend-free clone of https://www.mistryandshah.com, built with Vite + React.

## How it works

- `scripts/prepare-content.mjs` extracted the real page markup from the raw scrape
  (`scraped-full-website_mistryandshah.com_...`), stripped the `mistryandshah.com` /
  `skynettechnologies.com` domains from every URL so everything resolves locally, and
  downloaded every referenced image/font into `public/`.
- Each of the 30 real pages lives at `public/pages/<slug>/index.html` with its own
  `styles.css` and `script.js`, untouched from the original scrape except for the URL
  rewrite. They're rendered inside an `<iframe>` so the original CSS/JS behaves exactly
  as it did on the live site, with zero interference from React.
- `src/App.jsx` is a thin React Router shell: it maps the current URL to the right
  page bundle and swaps the iframe's `src`. `public/nav-bridge.js` is injected into each
  page and intercepts clicks on internal links, posting them back to the shell so the
  address bar and browser back/forward button stay in sync — all pages are "connected"
  without full page reloads.

## Known limitations

- The site's icon font was **Font Awesome Pro 6.2.0**; Pro's webfont files aren't
  publicly downloadable, so the Free 6.5.2 webfonts (same filenames) were substituted.
  Most icons match; a few Pro-only glyphs may render as a fallback glyph.
- One minor plugin icon font (`elementskit.woff`) couldn't be located at a public URL
  and was left unresolved — low/no visible impact on the pages scraped.
- Anything that depended on the live WordPress backend (contact form submission, AJAX
  endpoints, live chat) is visual-only, since this clone has no backend by design.

## Run it

```bash
npm install
npm run dev
```

Then open the printed local URL (typically http://localhost:5173).
