import assert from "node:assert/strict";
import test from "node:test";

async function render(path) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${path}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request(`http://localhost${path}`, { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the report library", async () => {
  const response = await render("/library");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /Report library/);
  assert.match(html, /Upload your own pair/);
  assert.match(html, /Annual report verification/);
  assert.match(html, /Model setup/);
});

test("server-renders the analyzer", async () => {
  const response = await render("/analyze");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Analyze annual reports/);
  assert.match(html, /Adjacent-year verification/);
  assert.match(html, /Drop the newer report/);
});
