"use strict";

/*
 * Unit tests for the pure functions of the package-seo Lambda@Edge handler.
 * Run: node --test  (from lambda-edge/package-seo/) — no dependencies.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  injectMetadata,
  buildMeta,
  buildJsonLd,
  parsePath,
  platformsToOs,
  renderMarkdown
} = require("../index.js");

// A trimmed copy of the real hub SPA shell (matches hub.aux4.io/index.html).
const SHELL = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta
      name="description"
      content="aux4 hub — Find, install, and share CLI tools and packages."
      data-react-helmet="true"
    />
    <meta name="twitter:title" content="aux4 hub — CLI Package Registry" data-react-helmet="true" />
    <meta name="twitter:description" content="Find, install, and share CLI tools." data-react-helmet="true" />
    <meta property="og:title" content="aux4 hub — CLI Package Registry" data-react-helmet="true" />
    <meta property="og:url" content="https://hub.aux4.io" data-react-helmet="true" />
    <meta property="og:description" content="Find, install, and share CLI tools." data-react-helmet="true" />
    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "WebApplication",
      "name": "aux4 hub"
    }
    </script>
    <title>aux4 hub — CLI Package Registry</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/assets/index-abc123.js"></script>
  </body>
</html>`;

const SPEC = {
  description: "Kafka ksqlDB client for aux4",
  scope: "community",
  name: "ksqldb",
  version: "1.2.3",
  license: "MIT",
  website: "https://github.com/aux4-community/ksqldb",
  tags: ["kafka", "ksqldb", "streaming"],
  platforms: ["darwin/arm64", "linux/amd64", "windows/amd64"]
};

test("parsePath: base package path -> latest", () => {
  assert.deepEqual(parsePath("/r/public/packages/community/ksqldb"), {
    scope: "community",
    name: "ksqldb",
    version: "latest"
  });
});

test("parsePath: trailing tab segment is ignored", () => {
  assert.deepEqual(parsePath("/r/public/packages/community/ksqldb/overview"), {
    scope: "community",
    name: "ksqldb",
    version: "latest"
  });
});

test("parsePath: explicit version", () => {
  assert.deepEqual(
    parsePath("/r/public/packages/community/ksqldb/v/1.2.3/files"),
    { scope: "community", name: "ksqldb", version: "1.2.3" }
  );
});

test("parsePath: non-package path -> null", () => {
  assert.equal(parsePath("/r/public/search"), null);
  assert.equal(parsePath("/assets/index-abc123.js"), null);
  assert.equal(parsePath("/r/public/packages/community"), null);
});

test("buildMeta mirrors the client title/description/canonical", () => {
  const latest = buildMeta("community", "ksqldb", "latest", SPEC);
  assert.equal(latest.title, "community/ksqldb · aux4 hub");
  assert.equal(
    latest.description,
    "Kafka ksqlDB client for aux4 — Install with: aux4 aux4 pkger install community/ksqldb"
  );
  assert.equal(
    latest.canonical,
    "https://hub.aux4.io/r/public/packages/community/ksqldb"
  );

  const versioned = buildMeta("community", "ksqldb", "1.2.3", SPEC);
  assert.equal(versioned.title, "community/ksqldb · 1.2.3 · aux4 hub");
  // Canonical stays version-less even on a versioned URL.
  assert.equal(
    versioned.canonical,
    "https://hub.aux4.io/r/public/packages/community/ksqldb"
  );
});

test("buildMeta description falls back when spec has none", () => {
  const meta = buildMeta("community", "ksqldb", "latest", {
    scope: "community",
    name: "ksqldb"
  });
  assert.equal(
    meta.description,
    "community/ksqldb — aux4 CLI package. Install with: aux4 aux4 pkger install community/ksqldb"
  );
});

test("buildJsonLd emits SoftwareApplication with derived OS + keywords", () => {
  const ld = buildJsonLd(
    "community",
    "ksqldb",
    SPEC,
    "https://hub.aux4.io/r/public/packages/community/ksqldb"
  );
  assert.equal(ld["@type"], "SoftwareApplication");
  assert.equal(ld.name, "community/ksqldb");
  assert.equal(ld.operatingSystem, "macOS, Linux, Windows");
  assert.equal(ld.softwareVersion, "1.2.3");
  assert.equal(ld.license, "MIT");
  assert.equal(ld.keywords, "kafka, ksqldb, streaming");
  assert.equal(ld.offers.price, "0");
});

test("platformsToOs maps and dedups; falls back when empty", () => {
  assert.equal(platformsToOs(["darwin/arm64", "darwin/amd64"]), "macOS");
  assert.equal(platformsToOs(["linux/amd64", "windows/386"]), "Linux, Windows");
  assert.equal(platformsToOs([]), "macOS, Linux, Windows");
  assert.equal(platformsToOs(undefined), "macOS, Linux, Windows");
});

test("injectMetadata rewrites title, meta, og/twitter, canonical, JSON-LD", () => {
  const meta = buildMeta("community", "ksqldb", "latest", SPEC);
  const html = injectMetadata(SHELL, meta, null);

  // Unique title (the duplicate-title killer).
  assert.match(html, /<title>community\/ksqldb · aux4 hub<\/title>/);
  assert.doesNotMatch(html, /<title>aux4 hub — CLI Package Registry<\/title>/);

  // Exactly one <title> — no duplicate injected.
  assert.equal((html.match(/<title>/g) || []).length, 1);

  // Description rewritten in place (still exactly one description meta).
  assert.equal((html.match(/name="description"/g) || []).length, 1);
  assert.match(html, /content="Kafka ksqlDB client for aux4 — Install with: aux4 aux4 pkger install community\/ksqldb"/);

  // og/twitter titles updated.
  assert.match(html, /property="og:title"[^>]*content="community\/ksqldb · aux4 hub"/);
  assert.match(html, /name="twitter:title"[^>]*content="community\/ksqldb · aux4 hub"/);

  // og:url rewritten to canonical.
  assert.match(html, /property="og:url"[^>]*content="https:\/\/hub.aux4.io\/r\/public\/packages\/community\/ksqldb"/);

  // twitter:url inserted (was absent in the shell).
  assert.match(html, /name="twitter:url"[^>]*content="https:\/\/hub.aux4.io\/r\/public\/packages\/community\/ksqldb"/);

  // Canonical link inserted.
  assert.match(html, /<link rel="canonical" href="https:\/\/hub.aux4.io\/r\/public\/packages\/community\/ksqldb" \/>/);

  // JSON-LD swapped from WebApplication to SoftwareApplication (still one block).
  assert.equal((html.match(/application\/ld\+json/g) || []).length, 1);
  assert.match(html, /"@type": "SoftwareApplication"/);
  assert.doesNotMatch(html, /"WebApplication"/);

  // The Vite hashed asset reference from the (origin-fetched) shell is preserved.
  assert.match(html, /\/assets\/index-abc123\.js/);
});

test("injectMetadata escapes special chars in description", () => {
  const meta = buildMeta("acme", "tool", "latest", {
    scope: "acme",
    name: "tool",
    description: 'A "quoted" <script> & more'
  });
  const html = injectMetadata(SHELL, meta, null);
  assert.match(html, /&quot;quoted&quot;/);
  assert.match(html, /&lt;script&gt;/);
  // No raw closing script tag leaked from the description.
  assert.doesNotMatch(html, /A "quoted" <script>/);
});

test("injectMetadata appends README block when provided", () => {
  const meta = buildMeta("community", "ksqldb", "latest", SPEC);
  const readme = renderMarkdown("# Title\n\nSome **bold** text.\n\n- a\n- b\n");
  const html = injectMetadata(SHELL, meta, readme);
  assert.match(html, /<div id="package-readme" hidden aria-hidden="true">/);
  assert.match(html, /<h1>Title<\/h1>/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<li>a<\/li>/);
});

test("renderMarkdown escapes raw HTML and only allows safe links", () => {
  const html = renderMarkdown(
    "Hello <img src=x onerror=alert(1)>\n\n[ok](https://a.com) [bad](javascript:alert(1))"
  );
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
  assert.match(html, /<a href="https:\/\/a.com" rel="nofollow">ok<\/a>/);
  // javascript: link renders as plain text, not an anchor.
  assert.doesNotMatch(html, /href="javascript:/);
  assert.match(html, /bad/);
});
