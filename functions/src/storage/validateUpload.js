/**
 * validateUpload.js
 * Cloud Function — Storage trigger
 *
 * Fires on every file uploaded to Firebase Storage.
 * Validates true file type via magic bytes (file signature),
 * not the client-supplied Content-Type header.
 *
 * An attacker can upload an HTML/JS file with Content-Type: image/png
 * to achieve Stored XSS if the file is served from your domain.
 * Magic bytes validation catches polyglot files that bypass MIME checks.
 *
 * Deletes the file immediately if:
 *   - Magic bytes do not match an allowed image format
 *   - File has a dangerous extension regardless of MIME type
 *
 * File location: functions/src/storage/validateUpload.js
 */

"use strict";

const functions = require("firebase-functions");
const admin     = require("firebase-admin");

if (!admin.apps.length) admin.initializeApp();

// Magic byte signatures for allowed image types
const MAGIC_BYTES = {
  jpeg: { offset: 0, bytes: [0xFF, 0xD8, 0xFF] },
  png:  { offset: 0, bytes: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A] },
  gif:  { offset: 0, bytes: [0x47, 0x49, 0x46, 0x38] },
  webp: { offset: 0, bytes: [0x52, 0x49, 0x46, 0x46], suffix: { offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] } },
  pdf:  { offset: 0, bytes: [0x25, 0x50, 0x44, 0x46] },
};

// Extensions that must always be rejected regardless of MIME type
const BLOCKED_EXTENSIONS = new Set([
  ".html", ".htm", ".xhtml", ".js", ".mjs", ".cjs",
  ".php", ".php3", ".php4", ".php5", ".asp", ".aspx", ".jsp",
  ".sh", ".bash", ".zsh", ".exe", ".dll", ".so",
  ".svg",  // SVG can contain embedded JS
  ".xml",  // Can trigger XXE
  ".swf",
]);

function matchesMagic(buffer, magic) {
  for (let i = 0; i < magic.bytes.length; i++) {
    if (buffer[magic.offset + i] !== magic.bytes[i]) return false;
  }
  if (magic.suffix) {
    for (let i = 0; i < magic.suffix.bytes.length; i++) {
      if (buffer[magic.suffix.offset + i] !== magic.suffix.bytes[i]) return false;
    }
  }
  return true;
}

function detectFileType(buffer) {
  for (const [type, magic] of Object.entries(MAGIC_BYTES)) {
    if (matchesMagic(buffer, magic)) return type;
  }
  return null;
}

module.exports = functions.storage.object().onFinalize(async (object) => {
  const filePath    = object.name;
  const contentType = object.contentType; // NOT trusted
  const bucket      = admin.storage().bucket(object.bucket);
  const file        = bucket.file(filePath);

  console.log(`validateUpload: checking ${filePath} (declared: ${contentType})`);

  // Block dangerous extensions immediately
  const ext = ("." + filePath.split(".").pop()).toLowerCase();
  if (BLOCKED_EXTENSIONS.has(ext)) {
    console.warn(`validateUpload: BLOCKED extension ${ext} at ${filePath}`);
    await file.delete();
    return;
  }

  // Only run magic-byte validation on user-uploadable paths
  const isUserUpload = filePath.startsWith("avatars/") || filePath.startsWith("writeups/");
  if (!isUserUpload) {
    console.log(`validateUpload: skipping magic-byte check for ${filePath}`);
    return;
  }

  // Read first 12 bytes
  let buffer;
  try {
    const [data] = await file.download({ start: 0, end: 11 });
    buffer = data;
  } catch (err) {
    console.error(`validateUpload: read failed for ${filePath}`, err);
    await file.delete();
    return;
  }

  const detectedType = detectFileType(buffer);

  if (!detectedType || !["jpeg", "png", "gif", "webp"].includes(detectedType)) {
    console.warn(`validateUpload: REJECTED ${filePath} — detected type: ${detectedType}`);
    await file.delete();
    return;
  }

  // Clear metadata, force content-disposition attachment to prevent inline browser execution
  await file.setMetadata({
    metadata: {},
    contentDisposition: "attachment",
    contentType: `image/${detectedType === "jpeg" ? "jpeg" : detectedType}`,
  });

  console.log(`validateUpload: ${filePath} passed (${detectedType})`);
});