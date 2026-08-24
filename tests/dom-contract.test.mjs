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

