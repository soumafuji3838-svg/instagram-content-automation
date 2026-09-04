const test = require("node:test");
const assert = require("node:assert/strict");

process.env.PORT = "0";
process.env.INSTAGRAM_DRY_RUN = "true";
// Keep integration tests deterministic even when the local .env contains live API keys.
// src/env.js only fills undefined variables, so an explicit empty value prevents loading them.
process.env.OPENAI_API_KEY = "";
process.env.PEXELS_API_KEY = "";

const { start } = require("../src/app");

test("create, edit, approve, dry-run, regenerate, and delete", async () => {
  const server = await start();
  const base = `http://127.0.0.1:${server.address().port}`;
  let created;
  try {
    created = await fetch(`${base}/api/posts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accountId: "career-research-center", contentType: "industry_report", targetYear: "28卒", topic: `統合テスト-${Date.now()}`, notes: "数字を使わない" })
    }).then(async (response) => ({ status: response.status, body: await response.json() }));
    assert.equal(created.status, 201);
    assert.equal(created.body.status, "review");
    assert.equal(created.body.assets.length, 5);
    assert.equal(created.body.notes, "数字を使わない");
    assert.equal(created.body.contentType, "industry_report");
    assert.equal(created.body.quality.checks.length, 7);

    const exported = await fetch(`${base}/api/posts/${created.body.id}/export`);
    const exportedBuffer = Buffer.from(await exported.arrayBuffer());
    assert.equal(exported.status, 200);
    assert.equal(exported.headers.get("content-type"), "application/zip");
    assert.match(exported.headers.get("content-disposition"), /instagram-post-/);
    assert.equal(exportedBuffer.subarray(0, 2).toString(), "PK");
    assert.ok(exportedBuffer.includes(Buffer.from("caption.txt")));
    assert.ok(exportedBuffer.includes(Buffer.from("references.txt")));
    assert.ok(exportedBuffer.includes(Buffer.from("quality.json")));
    assert.ok(exportedBuffer.includes(Buffer.from("content.json")));
    assert.ok(exportedBuffer.includes(Buffer.from("photo.json")));
    assert.ok(exportedBuffer.includes(Buffer.from("photo-credit.txt")));
    assert.ok(exportedBuffer.includes(Buffer.from("logos.json")));
    for (let index = 1; index <= 5; index += 1) {
      assert.ok(exportedBuffer.includes(Buffer.from(`images/slide-${String(index).padStart(2, "0")}.png`)));
    }

    const editedContent = structuredClone(created.body.content);
    editedContent.title = "編集後の表紙タイトル";
    const edited = await fetch(`${base}/api/posts/${created.body.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: editedContent })
    }).then((response) => response.json());
    assert.equal(edited.content.title, "編集後の表紙タイトル");
    assert.equal(edited.status, "review");

    const approved = await fetch(`${base}/api/posts/${created.body.id}/approve`, { method: "POST" }).then((response) => response.json());
    assert.equal(approved.status, "approved");

    const published = await fetch(`${base}/api/posts/${created.body.id}/publish`, { method: "POST" }).then((response) => response.json());
    assert.equal(published.status, "dry_run_complete");
    assert.equal(published.publishResult.dryRun, true);

    const regenerated = await fetch(`${base}/api/posts/${created.body.id}/regenerate`, { method: "POST" }).then((response) => response.json());
    assert.equal(regenerated.status, "review");
    assert.equal(regenerated.generationSource, "demo");

    const removed = await fetch(`${base}/api/posts/${created.body.id}`, { method: "DELETE" }).then((response) => response.json());
    assert.equal(removed.deleted, true);
    created = null;
  } finally {
    if (created?.body?.id) await fetch(`${base}/api/posts/${created.body.id}`, { method: "DELETE" }).catch(() => {});
    await new Promise((resolve) => server.close(resolve));
  }
});
