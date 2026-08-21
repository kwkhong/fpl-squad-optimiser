import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("manifest defines a standalone, path-safe installable app", async () => {
  const manifest = JSON.parse(await readFile("manifest.webmanifest", "utf8"));
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "./");
  assert.equal(manifest.scope, "./");
  assert.ok(manifest.icons.some((icon) => icon.sizes === "192x192"));
  assert.ok(manifest.icons.some((icon) => icon.sizes === "512x512" && icon.purpose.includes("maskable")));
});

test("page exposes iPhone metadata, icon and install controls", async () => {
  const html = await readFile("index.html", "utf8");
  assert.match(html, /rel="manifest" href="manifest\.webmanifest"/);
  assert.match(html, /rel="apple-touch-icon" href="icons\/apple-touch-icon\.png"/);
  assert.match(html, /name="apple-mobile-web-app-capable" content="yes"/);
  assert.match(html, /id="installButton"/);
  assert.match(html, /Add to Home Screen/);
  assert.match(html, /src="pwa\.js/);
});

test("service worker caches the shell but refreshes data from the network", async () => {
  const worker = await readFile("sw.js", "utf8");
  assert.match(worker, /APP_SHELL/);
  assert.match(worker, /networkFirst/);
  assert.match(worker, /\/data\//);
  assert.match(worker, /skipWaiting/);
});
