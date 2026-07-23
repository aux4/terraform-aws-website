"use strict";

/*
 * Package SEO Lambda@Edge (origin-request)
 * -----------------------------------------
 * Fires on CloudFront cache-miss for the /r/public/packages/* cache behavior.
 * On a hub package page it:
 *   1. parses the path into { scope, name, version },
 *   2. fetches the package spec (and, best-effort, the README) from the hub API,
 *   3. fetches the current SPA shell (index.html) from the S3 origin,
 *   4. injects a unique <title>, <meta name="description">, og/twitter tags,
 *      a <link rel="canonical">, and a SoftwareApplication JSON-LD block,
 *      (and, as a stretch, the rendered README into a hidden crawler-only div),
 *   5. returns a generated 200 response with a cache-control header so
 *      CloudFront caches the injected HTML per-path.
 *
 * CONTRACT (read before changing):
 *   - Runtime: Node (nodejs20.x). Handler entrypoint: `index.handler`.
 *   - Trigger: CloudFront origin-request. Event = event.Records[0].cf.request.
 *   - NO environment variables (Lambda@Edge forbids them). All config is baked
 *     into CONFIG below, with an optional ./config.json override baked into the
 *     zip (so the module can stay generic without templating this JS file).
 *   - FAIL OPEN: on ANY error (bad path, API/timeout/parse failure, shell fetch
 *     failure) the handler returns the ORIGINAL request unchanged, so CloudFront
 *     serves the plain SPA shell from the origin. A page must NEVER break because
 *     metadata lookup failed.
 *   - The title/description mirror the client (react-helmet) exactly
 *     (src/component/WebsiteMetadata.jsx + src/page/PackagePage.jsx) so the
 *     crawler-visible metadata and the hydrated DOM agree. The em-dash in the
 *     description is intentional: it matches the client string verbatim.
 *
 * No third-party dependencies. Uses only Node built-ins (https/http).
 */

const https = require("https");
const http = require("http");

let CONFIG = {
  // Base URL of the hub package API (prod). dev: https://dev.api.hub.aux4.io/v1
  apiBase: "https://api.hub.aux4.io/v1",
  // Canonical/origin used for <link rel=canonical> and og/twitter URLs.
  siteOrigin: "https://hub.aux4.io"
};

// Optional override baked into the zip (kept out of this file so the module can
// stay generic without templating JS full of ${} template literals).
try {
  // eslint-disable-next-line global-require
  Object.assign(CONFIG, require("./config.json"));
} catch (e) {
  /* no override; use the baked defaults */
}

const PATH_PREFIX = "/r/public/packages/";
const SEGMENT_RE = /^[A-Za-z0-9._@-]+$/;

const FETCH_TIMEOUT_MS = 3500;
const README_TIMEOUT_MS = 3500;
const MAX_SPEC_BYTES = 256 * 1024;
const MAX_SHELL_BYTES = 512 * 1024;
const MAX_README_BYTES = 80 * 1024;

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

exports.handler = async event => {
  const request = event.Records[0].cf.request;

  try {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return request;
    }

    const parsed = parsePath(request.uri);
    if (!parsed) {
      return request;
    }

    const { scope, name, version } = parsed;

    const specUrl =
      CONFIG.apiBase +
      "/packages/public/" +
      enc(scope) +
      "/" +
      enc(name) +
      "/" +
      enc(version) +
      "/spec";

    const readmeUrl =
      CONFIG.apiBase +
      "/packages/public/" +
      enc(scope) +
      "/" +
      enc(name) +
      "/" +
      enc(version) +
      "/spec/README.md";

    // Fetch spec, shell, and README concurrently. spec + shell are required
    // (their failure fails open); the README is a best-effort stretch.
    const [specResult, shellResult, readmeResult] = await Promise.allSettled([
      fetchText(specUrl, FETCH_TIMEOUT_MS, MAX_SPEC_BYTES),
      fetchText(shellUrlFor(request), FETCH_TIMEOUT_MS, MAX_SHELL_BYTES),
      fetchText(readmeUrl, README_TIMEOUT_MS, MAX_README_BYTES)
    ]);

    if (specResult.status !== "fulfilled" || shellResult.status !== "fulfilled") {
      return request;
    }

    const spec = JSON.parse(specResult.value);
    if (!spec || !spec.name) {
      return request;
    }

    const shellHtml = shellResult.value;

    // Stretch: render the README into a hidden crawler-only block. Any failure
    // here is swallowed so head-only injection still ships.
    let readmeHtml = null;
    if (readmeResult.status === "fulfilled") {
      try {
        readmeHtml = renderMarkdown(readmeResult.value);
      } catch (e) {
        readmeHtml = null;
      }
    }

    const meta = buildMeta(scope, name, version, spec);
    const html = injectMetadata(shellHtml, meta, readmeHtml);

    return {
      status: "200",
      statusDescription: "OK",
      headers: responseHeaders(),
      body: html
    };
  } catch (e) {
    // FAIL OPEN — serve the plain shell from the origin.
    if (process.env.AUX4_EDGE_DEBUG) {
      // eslint-disable-next-line no-console
      console.error("package-seo fail-open:", e && e.stack ? e.stack : e);
    }
    return request;
  }
};

// ---------------------------------------------------------------------------
// Path parsing
// ---------------------------------------------------------------------------

/**
 * Parse a CloudFront request URI into a package descriptor, or null when the
 * URI is not a package page. Tolerant of trailing SPA tab segments:
 *   /r/public/packages/<scope>/<name>
 *   /r/public/packages/<scope>/<name>/<tab>
 *   /r/public/packages/<scope>/<name>/v/<version>
 *   /r/public/packages/<scope>/<name>/v/<version>/<tab>
 */
function parsePath(uri) {
  if (typeof uri !== "string" || uri.indexOf(PATH_PREFIX) !== 0) {
    return null;
  }

  const rest = uri.slice(PATH_PREFIX.length).replace(/\/+$/, "");
  const rawParts = rest.split("/").filter(Boolean);
  if (rawParts.length < 2) {
    return null;
  }

  let scope;
  let name;
  try {
    scope = decodeURIComponent(rawParts[0]);
    name = decodeURIComponent(rawParts[1]);
  } catch (e) {
    return null;
  }

  if (!SEGMENT_RE.test(scope) || !SEGMENT_RE.test(name)) {
    return null;
  }

  let version = "latest";
  if (rawParts[2] === "v" && rawParts[3]) {
    let candidate;
    try {
      candidate = decodeURIComponent(rawParts[3]);
    } catch (e) {
      return null;
    }
    if (SEGMENT_RE.test(candidate)) {
      version = candidate;
    }
  }

  return { scope, name, version };
}

function enc(segment) {
  return encodeURIComponent(segment);
}

/**
 * URL of the SPA shell to inject into. Prefer the CloudFront origin (S3) so the
 * shell — including Vite's content-hashed asset references — is always current
 * and never drifts from what was deployed. Falls back to the public site.
 */
function shellUrlFor(request) {
  const origin = request.origin && request.origin.custom;
  if (origin && origin.domainName) {
    const proto = (origin.protocol || "http") + "://";
    const port =
      origin.port && origin.port !== 80 && origin.port !== 443
        ? ":" + origin.port
        : "";
    const basePath = (origin.path || "").replace(/\/+$/, "");
    return proto + origin.domainName + port + basePath + "/index.html";
  }
  return CONFIG.siteOrigin + "/index.html";
}

// ---------------------------------------------------------------------------
// Metadata assembly (mirror of the client react-helmet logic)
// ---------------------------------------------------------------------------

function buildMeta(scope, name, version, spec) {
  const s = spec.scope || scope;
  const n = spec.name || name;

  // Mirrors PackagePage.jsx:107 — versioned URLs show spec.version, latest hides it.
  const shownVersion = version === "latest" ? "" : spec.version || version;
  const baseTitle = s + "/" + n + (shownVersion ? " · " + shownVersion : "");
  // Mirrors WebsiteMetadata.jsx addTitleSuffix — "<title> · aux4 hub".
  const title = baseTitle + " · aux4 hub";

  // Mirrors PackagePage.jsx:110-112 verbatim (em-dash included on purpose).
  const description = spec.description
    ? spec.description +
      " — Install with: aux4 aux4 pkger install " +
      s +
      "/" +
      n
    : s +
      "/" +
      n +
      " — aux4 CLI package. Install with: aux4 aux4 pkger install " +
      s +
      "/" +
      n;

  // Mirrors PackagePage.jsx:109 — canonical is the version-less base URL.
  const canonical = CONFIG.siteOrigin + "/r/public/packages/" + s + "/" + n;

  const jsonLd = buildJsonLd(s, n, spec, canonical);

  return { title, description, canonical, jsonLd };
}

function buildJsonLd(scope, name, spec, canonical) {
  const ld = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: scope + "/" + name,
    description: spec.description || scope + "/" + name + " — aux4 CLI package",
    url: canonical,
    applicationCategory: "DeveloperApplication",
    operatingSystem: platformsToOs(spec.platforms),
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD"
    },
    publisher: {
      "@type": "Organization",
      name: "aux4",
      url: "https://aux4.io"
    }
  };

  if (spec.version) {
    ld.softwareVersion = spec.version;
  }
  if (spec.license) {
    ld.license = spec.license;
  }
  if (spec.website) {
    ld.installUrl = spec.website;
  }
  if (Array.isArray(spec.tags) && spec.tags.length) {
    ld.keywords = spec.tags.join(", ");
  }

  return ld;
}

function platformsToOs(platforms) {
  const fallback = "macOS, Linux, Windows";
  if (!Array.isArray(platforms) || !platforms.length) {
    return fallback;
  }

  const set = new Set();
  platforms.forEach(p => {
    const os = String(p).split("/")[0].toLowerCase();
    if (os.indexOf("darwin") !== -1 || os.indexOf("mac") !== -1) {
      set.add("macOS");
    } else if (os.indexOf("linux") !== -1) {
      set.add("Linux");
    } else if (os.indexOf("win") !== -1) {
      set.add("Windows");
    }
  });

  return set.size ? Array.from(set).join(", ") : fallback;
}

// ---------------------------------------------------------------------------
// HTML injection (pure — unit-tested in test/inject.test.js)
// ---------------------------------------------------------------------------

/**
 * Inject per-package metadata into the SPA shell. Pure function: given the shell
 * HTML and a meta descriptor, returns the rewritten HTML. Existing SEO tags are
 * rewritten in place (no duplicates); missing tags are inserted before </head>.
 */
function injectMetadata(shellHtml, meta, readmeHtml) {
  let html = shellHtml;

  html = setTitle(html, meta.title);
  html = setMeta(html, "name", "description", meta.description);
  html = setMeta(html, "name", "twitter:title", meta.title);
  html = setMeta(html, "name", "twitter:description", meta.description);
  html = setMeta(html, "name", "twitter:url", meta.canonical);
  html = setMeta(html, "property", "og:title", meta.title);
  html = setMeta(html, "property", "og:description", meta.description);
  html = setMeta(html, "property", "og:url", meta.canonical);
  html = upsertCanonical(html, meta.canonical);
  html = setJsonLd(html, meta.jsonLd);

  if (readmeHtml) {
    html = insertBeforeBodyEnd(
      html,
      '<div id="package-readme" hidden aria-hidden="true">' + readmeHtml + "</div>"
    );
  }

  return html;
}

function setTitle(html, title) {
  const literal = "<title>" + textEscape(title) + "</title>";
  const out = replaceFirst(html, /<title>[\s\S]*?<\/title>/i, literal);
  return out !== null ? out : insertBeforeHead(html, literal);
}

/**
 * Replace the `content="..."` of the first <meta> tag matching attr="val"
 * (attr is "name" or "property"). Inserts a fresh tag before </head> if absent.
 */
function setMeta(html, attr, val, content) {
  const esc = attrEscape(content);
  const re = new RegExp(
    "<meta\\b[^>]*\\b" + attr + '="' + escapeRe(val) + '"[^>]*>',
    "i"
  );
  const m = re.exec(html);
  if (!m) {
    return insertBeforeHead(
      html,
      "<meta " + attr + '="' + val + '" content="' + esc + '" />'
    );
  }

  const tag = m[0];
  let newTag;
  if (/content\s*=\s*"/i.test(tag)) {
    newTag = tag.replace(/content\s*=\s*"[^"]*"/i, function () {
      return 'content="' + esc + '"';
    });
  } else {
    newTag = tag.replace(/\s*\/?>\s*$/, function () {
      return ' content="' + esc + '" />';
    });
  }

  return html.slice(0, m.index) + newTag + html.slice(m.index + tag.length);
}

function upsertCanonical(html, href) {
  const literal = '<link rel="canonical" href="' + attrEscape(href) + '" />';
  const re = /<link\b[^>]*\brel="canonical"[^>]*>/i;
  const out = replaceFirst(html, re, literal);
  return out !== null ? out : insertBeforeHead(html, literal);
}

function setJsonLd(html, obj) {
  // Escape "<" so a package field can never break out of the <script> element.
  const json = JSON.stringify(obj, null, 2).replace(/</g, "\\u003c");
  const literal =
    '<script type="application/ld+json">\n' + json + "\n    </script>";
  const re = /<script type="application\/ld\+json">[\s\S]*?<\/script>/i;
  const out = replaceFirst(html, re, literal);
  return out !== null ? out : insertBeforeHead(html, literal);
}

function insertBeforeHead(html, snippet) {
  const out = replaceFirst(html, /<\/head>/i, snippet + "\n</head>");
  return out !== null ? out : html;
}

function insertBeforeBodyEnd(html, snippet) {
  const out = replaceFirst(html, /<\/body>/i, snippet + "\n</body>");
  return out !== null ? out : html;
}

// Replace the first regex match with a LITERAL string (no $-substitution).
function replaceFirst(str, re, literal) {
  const m = re.exec(str);
  if (!m) {
    return null;
  }
  return str.slice(0, m.index) + literal + str.slice(m.index + m[0].length);
}

function attrEscape(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function textEscape(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------------------------------------------------------------------------
// Response headers
// ---------------------------------------------------------------------------

function responseHeaders() {
  return {
    "content-type": [
      { key: "Content-Type", value: "text/html; charset=utf-8" }
    ],
    "cache-control": [
      { key: "Cache-Control", value: "public, max-age=3600" }
    ],
    // Marker so HUB-010 can verify (via curl -I) that injection fired.
    "x-package-seo": [{ key: "X-Package-Seo", value: "injected" }]
  };
}

// ---------------------------------------------------------------------------
// Minimal, dependency-free markdown renderer (stretch; crawler-only body)
// ---------------------------------------------------------------------------

/**
 * Render a safe subset of Markdown to HTML. Everything is HTML-escaped first, so
 * raw HTML/scripts in a README can never be emitted. Handles headings, fenced
 * and inline code, bold/italic, links, and unordered/ordered lists. Not a full
 * CommonMark implementation — just enough for crawler-visible full-text content.
 */
function renderMarkdown(md) {
  if (typeof md !== "string" || !md.trim()) {
    return "";
  }

  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let inCode = false;
  let codeBuf = [];
  let listType = null; // "ul" | "ol" | null
  let paraBuf = [];

  function flushPara() {
    if (paraBuf.length) {
      out.push("<p>" + inline(paraBuf.join(" ")) + "</p>");
      paraBuf = [];
    }
  }

  function closeList() {
    if (listType) {
      out.push("</" + listType + ">");
      listType = null;
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Fenced code blocks.
    const fence = line.match(/^\s*```/);
    if (fence) {
      if (inCode) {
        out.push("<pre><code>" + textEscape(codeBuf.join("\n")) + "</code></pre>");
        codeBuf = [];
        inCode = false;
      } else {
        flushPara();
        closeList();
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      codeBuf.push(line);
      continue;
    }

    // Blank line → paragraph / list boundary.
    if (!line.trim()) {
      flushPara();
      closeList();
      continue;
    }

    // Headings.
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flushPara();
      closeList();
      const level = h[1].length;
      out.push("<h" + level + ">" + inline(h[2].trim()) + "</h" + level + ">");
      continue;
    }

    // Unordered list.
    const ul = line.match(/^\s*[-*+]\s+(.*)$/);
    if (ul) {
      flushPara();
      if (listType !== "ul") {
        closeList();
        out.push("<ul>");
        listType = "ul";
      }
      out.push("<li>" + inline(ul[1].trim()) + "</li>");
      continue;
    }

    // Ordered list.
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ol) {
      flushPara();
      if (listType !== "ol") {
        closeList();
        out.push("<ol>");
        listType = "ol";
      }
      out.push("<li>" + inline(ol[1].trim()) + "</li>");
      continue;
    }

    // Otherwise, accumulate paragraph text.
    if (listType) {
      closeList();
    }
    paraBuf.push(line.trim());
  }

  if (inCode) {
    out.push("<pre><code>" + textEscape(codeBuf.join("\n")) + "</code></pre>");
  }
  flushPara();
  closeList();

  return out.join("\n");
}

// Inline formatting: escape first, then apply a safe subset.
function inline(text) {
  let s = textEscape(text);
  // Inline code (protect from further formatting via a placeholder pass).
  const codes = [];
  s = s.replace(/`([^`]+)`/g, function (_, c) {
    codes.push("<code>" + c + "</code>");
    return " " + (codes.length - 1) + " ";
  });
  // Links [text](url) — only http(s) URLs are emitted.
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (_, label, url) {
    if (/^https?:\/\//i.test(url)) {
      return '<a href="' + attrEscape(url) + '" rel="nofollow">' + label + "</a>";
    }
    return label;
  });
  // Bold then italic.
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  s = s.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  s = s.replace(/(^|[^\w])_([^_]+)_(?=[^\w]|$)/g, "$1<em>$2</em>");
  // Restore inline code placeholders.
  s = s.replace(/ (\d+) /g, function (_, i) {
    return codes[Number(i)];
  });
  return s;
}

// Exported for unit tests (no effect on the Lambda handler contract).
module.exports.injectMetadata = injectMetadata;
module.exports.buildMeta = buildMeta;
module.exports.buildJsonLd = buildJsonLd;
module.exports.parsePath = parsePath;
module.exports.platformsToOs = platformsToOs;
module.exports.renderMarkdown = renderMarkdown;
module.exports.shellUrlFor = shellUrlFor;

// ---------------------------------------------------------------------------
// HTTP fetch (built-ins only)
// ---------------------------------------------------------------------------

function fetchText(url, timeoutMs, maxBytes) {
  return new Promise((resolve, reject) => {
    const lib = url.indexOf("https:") === 0 ? https : http;
    const req = lib.get(
      url,
      { headers: { "user-agent": "aux4-hub-edge-seo", accept: "*/*" } },
      res => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          res.resume();
          reject(new Error("HTTP " + res.statusCode + " for " + url));
          return;
        }
        let data = "";
        let bytes = 0;
        res.setEncoding("utf8");
        res.on("data", chunk => {
          bytes += Buffer.byteLength(chunk);
          if (maxBytes && bytes > maxBytes) {
            req.destroy(new Error("response too large: " + url));
            return;
          }
          data += chunk;
        });
        res.on("end", () => resolve(data));
      }
    );
    req.setTimeout(timeoutMs, () => req.destroy(new Error("timeout: " + url)));
    req.on("error", reject);
  });
}
