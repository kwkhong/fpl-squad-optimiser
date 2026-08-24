import assert from "node:assert/strict";
import test from "node:test";
import handler from "../api/fpl-team.js";

function responseRecorder() {
  return {
    headers: {}, statusCode: 200, body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    end() { return this; },
  };
}

test("team API rejects invalid identifiers without calling FPL", async () => {
  const res = responseRecorder();
  await handler({ method: "GET", query: { teamId: "x", event: "2" }, headers: {} }, res);
  assert.equal(res.statusCode, 400);
});

test("team API falls back to the previous published gameweek", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    calls.push(url);
    if (url.includes("/event/2/")) return { ok: false };
    return { ok: true, json: async () => ({ picks: Array.from({ length: 15 }, (_, element) => ({ element })) }) };
  });
  const res = responseRecorder();
  await handler({
    method: "GET",
    query: { teamId: "7610580", event: "2" },
    headers: { origin: "https://kwkhong.github.io" },
  }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.picks.length, 15);
  assert.equal(calls.length, 2);
  assert.match(calls[1], /event\/1\/picks/);
  assert.equal(res.headers["Access-Control-Allow-Origin"], "https://kwkhong.github.io");
});
