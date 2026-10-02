// Build pipeline: takes the raw scraped site and produces the static page bundles
// served from /public, with mistryandshah.com / skynettechnologies.com asset URLs
// localized so the clone works fully offline (no backend, no hotlinking).
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const SOURCE_ROOT = path.resolve(
  PROJECT_ROOT,
  "..",
  "..",
  "AI Agents",
  "Web-style-scraper",
  "scraped-full-website_mistryandshah.com_1790958050461"
);
const PUBLIC_ROOT = path.join(PROJECT_ROOT, "public");

const PAGES = [
  ["001-home", "/"],
  ["002-aboutus", "/aboutus"],
  ["003-services-2", "/services-2"],
  ["004-direct-tax", "/direct-tax"],
  ["005-indirect-tax-gst", "/indirect-tax-gst"],
  ["006-indirect-tax-customs", "/indirect-tax-customs"],
  ["007-corporate-allied-laws-services", "/corporate-allied-laws-services"],
  ["008-banking-and-finance-service", "/banking-and-finance-service"],
  ["009-audit-and-assurance-services", "/audit-and-assurance-services"],
  ["010-industrial-subsidies", "/industrial-subsidies"],
  ["011-cross-border-transaction", "/cross-border-transaction"],
  ["012-indirect-tax-customs-2erp-advisory", "/indirect-tax-customs-2erp-advisory"],
  ["013-business-restructuring", "/business-restructuring"],
  ["014-process-implementation", "/process-implementation"],
  ["015-management-consulting-advisory-services", "/management-consulting-advisory-services"],
  ["016-cfo-advisory-services", "/cfo-advisory-services"],
  ["017-foreign-accounting", "/foreign-accounting"],
  ["018-ind-as-ifrs-service", "/ind-as-ifrs-service"],
  ["019-gift-ifsc-service", "/gift-ifsc-service"],
  ["020-team", "/team"],
  ["021-career", "/career"],
  ["022-events", "/events"],
  ["023-blogs", "/blogs"],
  ["024-contactus", "/contactus"],
  ["025-ca-ketan-mistry", "/index.php/ca-ketan-mistry"],
  ["026-ca-kinnar-shah", "/index.php/ca-kinnar-shah"],
  ["027-ca-krunal-shah", "/index.php/ca-krunal-shah"],
  ["028-ca-sonal-jain", "/index.php/ca-sonal-jain"],
  ["029-ca-kunal-soni", "/index.php/ca-kunal-soni"],
  ["030-ca-amrin-alwani", "/ca-amrin-alwani"],
];

const ASSET_EXT_RE =
  /\.(png|jpe?g|gif|webp|svg|ico|woff2?|ttf|eot|otf|mp4|pdf|avif)(\?[^"'()\s]*)?$/i;

const MAIN_DOMAIN_RE = /(?:https?:)?\/\/(?:www\.)?mistryandshah\.com/g;
const SKYNET_ASSET_RE =
  /(?:https?:)?\/\/(?:www\.)?skynettechnologies\.com(\/[^"'()\s]+?\.(?:svg|png|jpe?g|gif|webp|ico|woff2?|ttf|eot|otf))/g;

const assetPaths = new Set(); // root-relative paths to download from mistryandshah.com
const skynetAssetPaths = new Set(); // root-relative paths to download from skynettechnologies.com

function extractInnerBody(html) {
  const firstBody = html.indexOf("<body");
  const secondBody = html.indexOf("<body", firstBody + 1);
  if (secondBody === -1) throw new Error("Could not find inner <body> tag");
  const openEnd = html.indexOf(">", secondBody) + 1;
  const closeBody = html.indexOf("</body>", openEnd);
  if (closeBody === -1) throw new Error("Could not find inner </body> tag");
  // The real <body> tag's own attributes matter, not just its content: its
  // class list carries Elementor's "elementor-kit-N" class, which is what
  // every --e-global-color-* custom property (used for things like the active/
  // hover nav color) is actually scoped to. Dropping it silently makes every
  // var(--e-global-color-*) reference resolve to nothing site-wide.
  const bodyTag = html.slice(secondBody, openEnd);
  const classMatch = bodyTag.match(/class="([^"]*)"/);
  const bodyClass = classMatch ? classMatch[1] : "";
  return { bodyClass, content: html.slice(openEnd, closeBody) };
}

function rewriteUrls(text) {
  let out = text.replace(MAIN_DOMAIN_RE, (match, offset, str) => {
    // Peek ahead to see what path follows; record asset paths for download.
    const rest = str.slice(offset + match.length);
    const pathMatch = rest.match(/^\/[^"'()\s]*/);
    if (pathMatch && ASSET_EXT_RE.test(pathMatch[0])) {
      assetPaths.add(pathMatch[0]);
    }
    return "";
  });

  out = out.replace(SKYNET_ASSET_RE, (match, assetPath) => {
    skynetAssetPaths.add(assetPath);
    return "/skynet-assets" + assetPath;
  });

  return out;
}

// The scraper concatenated every <script> tag's content into one file by DOM
// order, regardless of its `type` attribute. Non-JS blocks (application/ld+json
// structured data, text/template snippets, etc.) end up as raw text in the
// bundle; the first one breaks JS parsing and silently kills the ENTIRE script
// (so no jQuery/Elementor init ever runs: lazy-loaded backgrounds stay hidden,
// menus/animations stay dead). Split on the scraper's own "/* Inline Script N */"
// markers and drop any chunk that isn't valid standalone JS.
// A couple of pages' scripts contain a real static ESM `import{...}from"...";`
// statement (from the third-party accessibility-widget bundle), which is a hard
// SyntaxError in a classic (non-module) script and would otherwise force us to
// drop the whole 2MB chunk it lives in — taking jQuery and everything else
// bundled alongside it down with it. Neutralize just the import declaration by
// stubbing its bound name(s) as a no-op; the widget's own try/catch around its
// dynamic import() calls absorbs the resulting no-op gracefully.
function neutralizeEsmImports(js) {
  js = js.replace(/import\s*\{([^}]*)\}\s*from\s*["'][^"']*["'];?/g, (_, bindings) => {
    const names = bindings
      .split(",")
      .map((b) => (b.split(/\s+as\s+/).pop() || "").trim())
      .filter(Boolean);
    return names.map((n) => `var ${n}=function(){return Promise.resolve();};`).join("");
  });
  js = js.replace(/import\s+([\w$]+)\s+from\s*["'][^"']*["'];?/g, (_, name) => {
    return `var ${name}=function(){return Promise.resolve();};`;
  });
  return js;
}

// Large chunks (>20KB) are bundled third-party libraries (jQuery, etc.) that
// LiteSpeed Cache inlined as one combined <script> tag; the scraper's own
// numbering doesn't preserve their true DOM position, so small page-specific
// snippets that call jQuery(...) can end up numbered *before* the chunk that
// actually defines jQuery. Libraries must always execute first.
const LIBRARY_CHUNK_THRESHOLD = 20000;

function sanitizeScript(js, slug) {
  js = neutralizeEsmImports(js);
  // Inside the library bucket, the scraper concatenates N separate external
  // <script src> files' raw content back-to-back under "/* External: url */"
  // markers with no statement terminator between them. If one file's last
  // statement doesn't end in a semicolon and the next starts with `(` or `!`,
  // JS parses them as one call-chain expression ("(intermediate value)(...)
  // is not a function"). A semicolon before every marker is always a safe
  // no-op when it lands between two already-complete statements, and fixes
  // the chain when it doesn't.
  // Wrap each one in try/catch: this both fixes the ASI-chaining problem
  // (the closing/opening braces are a hard statement boundary) and fault-
  // isolates vendor scripts from each other, matching how independent
  // <script src> tags behave in a real browser — one throwing (e.g. a
  // third-party widget's bootstrap code probing for a DOM node our
  // extracted markup doesn't have) no longer kills every statement after
  // it in the whole concatenated file.
  js = js.replace(
    /(\/\* External:[^\n]*\*\/\n\/\* Size:[^\n]*\*\/\n)([\s\S]*?)(?=\/\* External:|$)/g,
    (_, markerLine, content) => `${markerLine}try{\n${content}\n}catch(e){console.error("external script failed:",e);}\n`
  );
  const parts = js.split(/(\/\* Inline Script \d+ \*\/)/);
  const header = parts[0];
  const chunks = [];
  let dropped = 0;
  for (let i = 1; i < parts.length; i += 2) {
    const marker = parts[i];
    const chunk = parts[i + 1] ?? "";
    try {
      new vm.Script(chunk, { filename: "chunk.js" });
      chunks.push({ marker, chunk });
    } catch {
      dropped++;
      chunks.push({ marker, chunk: "\n/* skipped: not valid JavaScript (likely JSON-LD or a template block) */\n" });
    }
  }
  // wp_localize_script() config objects (var elementorFrontendConfig = {...})
  // must exist before the library bundle that reads them runs, even though
  // they're small and would otherwise sort after the library chunk.
  const CONFIG_RE = /^\s*var\s+[\w$]+\s*=\s*(\{[\s\S]*\}|\[[\s\S]*\]);?\s*$/;
  const configs = chunks.filter((c) => c.chunk.length <= LIBRARY_CHUNK_THRESHOLD && CONFIG_RE.test(c.chunk.trim()));
  const large = chunks.filter((c) => c.chunk.length > LIBRARY_CHUNK_THRESHOLD);
  const small = chunks.filter((c) => c.chunk.length <= LIBRARY_CHUNK_THRESHOLD && !CONFIG_RE.test(c.chunk.trim()));
  const ordered = [...configs, ...large, ...small];
  if (dropped) console.log(`  ${slug}: dropped ${dropped} non-JS inline script chunk(s)`);
  return header + ordered.map((c) => c.marker + c.chunk).join("");
}

// Same concatenation problem as the JS bundle, but for CSS: the scraper glues
// every external stylesheet together under "/* External: url */" markers with
// no isolation. A single stray brace in any one of them (we found a literal
// extra "}" baked into the site's own Elementor "Custom CSS" field — a
// pre-existing authoring typo that's harmless when that field is its own
// <style> tag, but throws off the parser's brace-depth tracking once
// concatenated into one file) silently drops an unpredictable run of
// *subsequent* rules — which is why one page can be missing styles that are
// clearly present as text a few lines later. (@layer was tried here first to
// contain the damage, but cascade layers always lose to unlayered rules
// regardless of specificity, which broke other things — this instead removes
// stray closing braces directly, one external block at a time, so cascade
// behavior is completely unaffected.)
function balanceBraces(text) {
  let depth = 0;
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end === -1 ? text.length : end + 2;
      out += text.slice(i, stop);
      i = stop - 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < text.length && text[j] !== ch) {
        if (text[j] === "\\") j++;
        j++;
      }
      out += text.slice(i, j + 1);
      i = j;
      continue;
    }
    if (ch === "{") depth++;
    if (ch === "}") {
      if (depth === 0) continue; // stray extra closing brace: drop it
      depth--;
    }
    out += ch;
  }
  return out + "}".repeat(Math.max(0, depth));
}

function isolateExternalCss(css, slug) {
  let dropped = 0;
  const fixed = css.replace(
    /(\/\* External:[^\n]*\*\/\n\/\* Size:[^\n]*\*\/\n)([\s\S]*?)(?=\/\* External:|$)/g,
    (whole, markerLine, content) => {
      const balanced = balanceBraces(content);
      if (balanced !== content) dropped++;
      return markerLine + balanced;
    }
  );
  if (dropped) console.log(`  ${slug}: fixed brace imbalance in ${dropped} external CSS block(s)`);
  return fixed;
}

function fixRelativeFontPaths(css) {
  return css
    .replace(/\.\.\/webfonts\//g, "/webfonts/")
    .replace(/\.\.\/fonts\//g, "/fonts/");
}

async function downloadFile(url, destPath, attempt = 1) {
  if (fs.existsSync(destPath)) return { url, ok: true, cached: true };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return { url, ok: false, status: res.status };
    const buf = Buffer.from(await res.arrayBuffer());
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.writeFileSync(destPath, buf);
    return { url, ok: true };
  } catch (err) {
    if (attempt < 3) return downloadFile(url, destPath, attempt + 1);
    return { url, ok: false, error: String(err) };
  } finally {
    clearTimeout(timer);
  }
}

async function downloadWithConcurrency(items, concurrency, worker) {
  const results = [];
  let index = 0;
  async function run() {
    while (index < items.length) {
      const i = index++;
      results[i] = await worker(items[i]);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, run));
  return results;
}

async function main() {
  const pagesMeta = [];

  for (const [slug, routePath] of PAGES) {
    const srcDir = path.join(SOURCE_ROOT, slug);
    const rawHtml = fs.readFileSync(path.join(srcDir, "index.html"), "utf8");
    const pageMd = fs.readFileSync(path.join(srcDir, "PAGE.md"), "utf8");
    const titleMatch = pageMd.match(/\*\*Page Title:\*\*\s*(.+)/);
    let title = titleMatch ? titleMatch[1].trim() : slug;
    if (title === "Unknown" || !title) title = "Mistry & Shah LLP";

    let { bodyClass, content: bodyInner } = extractInnerBody(rawHtml);
    let css = fs.readFileSync(path.join(srcDir, "styles.css"), "utf8");
    let js = fs.readFileSync(path.join(srcDir, "script.js"), "utf8");

    bodyInner = rewriteUrls(bodyInner);
    css = rewriteUrls(isolateExternalCss(fixRelativeFontPaths(css), slug));
    js = rewriteUrls(sanitizeScript(js, slug));

    const outDir = path.join(PUBLIC_ROOT, "pages", slug);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, "styles.css"), css);
    fs.writeFileSync(path.join(outDir, "script.js"), js);

    const fullHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title.replace(/</g, "&lt;")}</title>
<link rel="stylesheet" href="/pages/${slug}/styles.css">
<style>
/* Elementor's decorative background shapes (accent circles, angled dividers,
   etc.) are deliberately positioned to bleed slightly past their section's
   edge for a design effect. The live site has the exact same behavior, which
   is harmless at desktop width but creates an unwanted horizontal scrollbar
   on narrower tablet/mobile viewports where there's no spare margin left to
   bleed into. Clipping it at the document root is the standard fix and is
   safe here: nothing on this site relies on position:sticky at the page
   level (only a small accessibility-widget modal does, and that's unaffected
   since it scrolls independently). */
html, body { overflow-x: hidden; max-width: 100%; }
</style>
</head>
<body class="${bodyClass.replace(/"/g, "&quot;")}">
${bodyInner}
<script src="/pages/${slug}/script.js"></script>
<script src="/nav-bridge.js"></script>
</body>
</html>
`;
    fs.writeFileSync(path.join(outDir, "index.html"), fullHtml);

    pagesMeta.push({ slug, path: routePath, title });
    console.log(`Processed ${slug} -> ${routePath}`);
  }

  fs.writeFileSync(
    path.join(PROJECT_ROOT, "src", "routes.json"),
    JSON.stringify(pagesMeta, null, 2)
  );

  console.log(`\nDownloading ${assetPaths.size} mistryandshah.com assets...`);
  const mainResults = await downloadWithConcurrency(
    [...assetPaths],
    8,
    (p) => downloadFile("https://www.mistryandshah.com" + p, path.join(PUBLIC_ROOT, p.slice(1)))
  );
  const mainFailed = mainResults.filter((r) => !r.ok);
  console.log(`  done. ${mainResults.length - mainFailed.length} ok, ${mainFailed.length} failed.`);
  if (mainFailed.length) console.log(mainFailed.map((r) => `  FAILED ${r.url} (${r.status || r.error})`).join("\n"));

  console.log(`\nDownloading ${skynetAssetPaths.size} skynettechnologies.com assets...`);
  const skynetResults = await downloadWithConcurrency(
    [...skynetAssetPaths],
    8,
    (p) =>
      downloadFile(
        "https://www.skynettechnologies.com" + p,
        path.join(PUBLIC_ROOT, "skynet-assets", p.slice(1))
      )
  );
  const skynetFailed = skynetResults.filter((r) => !r.ok);
  console.log(`  done. ${skynetResults.length - skynetFailed.length} ok, ${skynetFailed.length} failed.`);
  if (skynetFailed.length) console.log(skynetFailed.map((r) => `  FAILED ${r.url} (${r.status || r.error})`).join("\n"));

  // Font Awesome Pro webfonts aren't publicly downloadable; substitute the Free
  // tier (same filenames) from a public CDN as the closest visual match.
  console.log("\nDownloading Font Awesome Free webfont fallback...");
  const FA_BASE = "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/webfonts/";
  const faFiles = [
    "fa-solid-900.woff2", "fa-solid-900.ttf",
    "fa-regular-400.woff2", "fa-regular-400.ttf",
    "fa-brands-400.woff2", "fa-brands-400.ttf",
  ];
  for (const f of faFiles) {
    const r = await downloadFile(FA_BASE + f, path.join(PUBLIC_ROOT, "webfonts", f));
    console.log(`  ${r.ok ? "ok" : "FAILED"}: ${f}`);
  }

  console.log("\nAttempting eicons (Elementor) webfont from live site...");
  const EICONS_BASE =
    "https://www.mistryandshah.com/wp-content/plugins/elementor/assets/lib/eicons/fonts/";
  for (const f of ["eicons.woff2", "eicons.ttf", "eicons.woff", "eicons.eot", "eicons.svg"]) {
    const r = await downloadFile(EICONS_BASE + f, path.join(PUBLIC_ROOT, "fonts", f));
    console.log(`  ${r.ok ? "ok" : "skip"}: ${f}`);
  }

  console.log("\nAttempting elementskit webfont from live site (nav dropdown arrow icon)...");
  const EKIT_BASE =
    "https://www.mistryandshah.com/wp-content/plugins/elementskit-lite/modules/elementskit-icon-pack/assets/fonts/";
  for (const f of ["elementskit.woff"]) {
    const r = await downloadFile(EKIT_BASE + f, path.join(PUBLIC_ROOT, "fonts", f));
    console.log(`  ${r.ok ? "ok" : "skip"}: ${f}`);
  }

  console.log("\nAll done.");
}

main();
