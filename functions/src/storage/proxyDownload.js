/**
 * proxyDownload.js
 * HTTP endpoint that proxies a Cloudinary file download.
 *
 * Why: Cloudinary may return 401 for raw files (zip, pdf, etc.) when
 * accessed directly from the browser, due to restricted delivery settings.
 * This function fetches the file server-side and streams it to the client
 * with the correct Content-Disposition header to force a browser download.
 *
 * Usage: GET /proxyDownload?url=<encoded-cloudinary-url>&name=<filename>
 *
 * File location: functions/src/storage/proxyDownload.js
 */

"use strict";

const functions = require("firebase-functions");
const https     = require("https");
const http      = require("http");
const { URL }   = require("url");

exports.proxyDownload = functions.https.onRequest((req, res) => {
  // CORS
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }

  const fileUrl  = req.query.url;
  const fileName = req.query.name || "download";

  if (!fileUrl) {
    res.status(400).json({ error: "Missing 'url' query parameter." });
    return;
  }

  // Only allow Cloudinary URLs for security
  if (!fileUrl.includes("res.cloudinary.com") && !fileUrl.includes("cloudinary.com")) {
    res.status(403).json({ error: "Only Cloudinary URLs are allowed." });
    return;
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(fileUrl);
  } catch {
    res.status(400).json({ error: "Invalid URL." });
    return;
  }

  const protocol = parsedUrl.protocol === "https:" ? https : http;

  protocol.get(fileUrl, (upstream) => {
    if (upstream.statusCode >= 300 && upstream.statusCode < 400 && upstream.headers.location) {
      // Follow redirect once
      protocol.get(upstream.headers.location, (redirected) => {
        streamResponse(redirected, res, fileName);
      }).on("error", (err) => {
        res.status(502).json({ error: `Redirect fetch failed: ${err.message}` });
      });
      return;
    }
    streamResponse(upstream, res, fileName);
  }).on("error", (err) => {
    res.status(502).json({ error: `Fetch failed: ${err.message}` });
  });
});

function streamResponse(upstream, res, fileName) {
  if (upstream.statusCode !== 200) {
    res.status(upstream.statusCode).json({
      error: `Cloudinary returned ${upstream.statusCode}`,
    });
    return;
  }

  const contentType   = upstream.headers["content-type"]   || "application/octet-stream";
  const contentLength = upstream.headers["content-length"];

  // Sanitize filename
  const safeName = fileName.replace(/[^a-zA-Z0-9._\-() ]/g, "_");

  res.set("Content-Type", contentType);
  res.set("Content-Disposition", `attachment; filename="${safeName}"`);
  if (contentLength) res.set("Content-Length", contentLength);

  upstream.pipe(res);
}
