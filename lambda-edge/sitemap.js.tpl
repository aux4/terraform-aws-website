"use strict";

const https = require("https");

const SITE_URL = "${site_url}";
const API_URL = "${api_url}";

exports.handler = async (event) => {
  const request = event.Records[0].cf.request;

  if (request.uri !== "/sitemap.xml") {
    return request;
  }

  const packages = await fetchPackages();
  const sitemap = generateSitemap(packages);

  return {
    status: "200",
    statusDescription: "OK",
    headers: {
      "content-type": [{ key: "Content-Type", value: "application/xml" }],
      "cache-control": [{ key: "Cache-Control", value: "public, max-age=3600" }]
    },
    body: sitemap
  };
};

function fetchPackages() {
  return new Promise((resolve, reject) => {
    https.get(API_URL + "/packages/public", (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on("error", reject);
  });
}

function generateSitemap(packages) {
  const urls = [{ loc: SITE_URL, priority: "1.0" }];

  const scopes = new Set();

  for (const pkg of packages) {
    urls.push({
      loc: SITE_URL + "/r/public/packages/" + pkg.scope + "/" + pkg.name,
      lastmod: pkg.updatedAt,
      priority: "0.8"
    });
    scopes.add(pkg.scope);
  }

  for (const scope of scopes) {
    urls.push({
      loc: SITE_URL + "/scopes/public/" + scope,
      priority: "0.6"
    });
  }

  const entries = urls.map(function(entry) {
    let xml = "  <url>\n    <loc>" + entry.loc + "</loc>";
    if (entry.lastmod) xml += "\n    <lastmod>" + entry.lastmod + "</lastmod>";
    if (entry.priority) xml += "\n    <priority>" + entry.priority + "</priority>";
    xml += "\n  </url>";
    return xml;
  });

  return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + entries.join("\n") + "\n</urlset>";
}
