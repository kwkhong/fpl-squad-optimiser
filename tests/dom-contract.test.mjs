import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("every DOM id referenced by app.js exists in index.html", async () => {
  const [javascript, html] = await Promise.all([
    readFile("app.js", "utf8"),
    readFile("index.html", "utf8"),
  ]);
  const ids = [...javascript.matchAll(/\$\("#([A-Za-z0-9_-]+)"\)/g)].map((match) => match[1]);
  const missing = [...new Set(ids)].filter((id) => !new RegExp(`id=["']${id}["']`).test(html));
  assert.deepEqual(missing, []);
});

test("browser entrypoint is an ES module and loads the prediction engine", async () => {
  const [javascript, html] = await Promise.all([
    readFile("app.js", "utf8"),
    readFile("index.html", "utf8"),
  ]);
  assert.match(html, /<script type="module" src="app\.js/);
  assert.match(javascript, /from "\.\/engine\.mjs(?:\?v=[^"]+)?"/);
});

test("public transfer import uses a CORS-safe relay and retries the previous gameweek", async () => {
  const javascript = await readFile("app.js", "utf8");
  assert.match(javascript, /PUBLIC_FPL_RELAY/);
  assert.match(javascript, /encodeURIComponent\(endpoint\)/);
  assert.match(javascript, /Math\.max\(1, state\.currentEvent - 1\)/);
  assert.match(javascript, /candidate\.picks\.length === 15/);
});
