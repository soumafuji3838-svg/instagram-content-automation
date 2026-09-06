const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { loadEnv } = require("./env");
const { ensureStore, listPosts, createPost, getPost, updatePost, deletePost } = require("./store");
const { generateCarousel, validateContent, evaluateContentQuality, normalizeTextLengths, autoImproveQuality } = require("./generator");
const { lengthIssues } = require("./text-length");
const { contentTypes, getContentType } = require("./content-types");
const { renderCarousel } = require("./renderer");
const { publishCarousel } = require("./instagram");
const { streamPostExport } = require("./exporter");
const { fetchCoverPhoto, restoreCoverPhoto, uploadedCoverPhoto } = require("./photo");
const { checks: imageChecks, fingerprint, imageReviewReady } = require("./image-review");
const { planAutomaticPublication } = require("./auto-publish");
const { publicationGate } = require("./quality");
const { outputRoot } = require("./runtime-paths");
const { storageMode, persistRenderedAssets, deleteBlobAssets } = require("./blob-storage");

loadEnv();

const root = process.cwd();
const accounts = require("../config/accounts.json");
const mimeTypes = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".png": "image/png", ".json": "application/json; charset=utf-8" };

async function readLogoMetadata(id) {
  try { return JSON.parse(await fs.readFile(path.join(outputRoot(), id, "logos.json"), "utf8")); }
  catch { return {}; }
}

function timingSafeTextEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function authorizeRequest(req, res) {
  const password = process.env.ADMIN_PASSWORD || "";
  if (!password && !process.env.VERCEL) return true;
  if (!password) {
    res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
    res.end("ADMIN_PASSWORD is not configured.");
    return false;
  }

  const authorization = String(req.headers.authorization || "");
  const encoded = authorization.startsWith("Basic ") ? authorization.slice(6) : "";
  let username = "";
  let suppliedPassword = "";
  try {
    const decoded = Buffer.from(encoded, "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    username = separator >= 0 ? decoded.slice(0, separator) : "";
    suppliedPassword = separator >= 0 ? decoded.slice(separator + 1) : "";
  } catch { /* invalid authorization header */ }

  const expectedUsername = process.env.ADMIN_USERNAME || "admin";
  if (timingSafeTextEqual(username, expectedUsername) && timingSafeTextEqual(suppliedPassword, password)) return true;
  res.writeHead(401, {
    "WWW-Authenticate": 'Basic realm="Instagram Research Studio", charset="UTF-8"',
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end("Authentication required.");
  return false;
}

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error("Request body is too large.");
    chunks.push(chunk);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

async function serveFile(res, baseDirectory, requestPath) {
  const relative = requestPath.replace(/^\/+/, "");
  const filePath = path.resolve(baseDirectory, relative || "index.html");
  if (!filePath.startsWith(path.resolve(baseDirectory))) return false;
  try {
    const data = await fs.readFile(filePath);
    res.writeHead(200, { "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream" });
    res.end(data);
    return true;
  } catch {
    return false;
  }
}

async function handler(req, res) {
  if (!authorizeRequest(req, res)) return;
  const url = new URL(req.url, "http://localhost");
  try {
    if (req.method === "GET" && url.pathname === "/api/config") {
      return json(res, 200, {
        accounts,
        imageChecks,
        contentTypes,
        dryRun: process.env.INSTAGRAM_DRY_RUN !== "false",
        openAIConfigured: Boolean(process.env.OPENAI_API_KEY),
        pexelsConfigured: Boolean(process.env.PEXELS_API_KEY),
        instagramConfigured: Boolean(process.env.INSTAGRAM_USER_ID && process.env.INSTAGRAM_ACCESS_TOKEN),
        storageMode: storageMode(),
        passwordProtected: Boolean(process.env.ADMIN_PASSWORD)
      });
    }
    if (req.method === "GET" && url.pathname === "/api/posts") return json(res, 200, await listPosts());
    if (req.method === "GET" && url.pathname === "/api/auto-publish/plan") return json(res, 200, { enabled: false, plans: (await listPosts()).map(planAutomaticPublication) });

    const exportMatch = url.pathname.match(/^\/api\/posts\/([^/]+)\/export$/);
    if (req.method === "GET" && exportMatch) {
      const post = await getPost(exportMatch[1]);
      if (!post) return json(res, 404, { error: "投稿が見つかりません。" });
      return streamPostExport(post, res);
    }

    if (req.method === "POST" && url.pathname === "/api/posts") {
      const body = await readBody(req);
      const topic = String(body.topic || "").trim();
      if (!topic) return json(res, 400, { error: "テーマを入力してください。" });
      const account = accounts.find((item) => item.id === body.accountId) || accounts[0];
      const contentType = getContentType(body.contentType);
      const id = `${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
      const generated = await generateCarousel({ topic, contentType: contentType.id, targetYear: String(body.targetYear || account.target), notes: String(body.notes || ""), account });
      const coverPhoto = await fetchCoverPhoto(generated.content.imageQuery);
      const renderedAssets = await renderCarousel({ id, topic, contentType: contentType.id, content: generated.content, account, coverPhoto });
      const companyLogos = await readLogoMetadata(id);
      const assets = await persistRenderedAssets(id, renderedAssets);
      const now = new Date().toISOString();
      const post = await createPost({ id, topic, contentType: contentType.id, contentTypeLabel: contentType.label, notes: String(body.notes || ""), accountId: account.id, accountName: account.name, targetYear: body.targetYear || account.target, status: "review", generationSource: generated.source, content: generated.content, sources: generated.sources, coverPhoto: coverPhoto.metadata, companyLogos, quality: generated.quality, assets, createdAt: now, updatedAt: now });
      return json(res, 201, post);
    }

    const imageMatch = url.pathname.match(/^\/api\/posts\/([^/]+)\/(cover|image-review)$/);
    if (req.method === "POST" && imageMatch) {
      const existing = await getPost(imageMatch[1]);
      if (!existing) return json(res, 404, { error: "投稿が見つかりません。" });
      if (["published", "publishing", "publish_unknown"].includes(existing.status)) return json(res, 409, { error: "公開済み・公開処理中の投稿は変更できません。新しい投稿を作成してください。" });
      const body = await readBody(req);
      if (imageMatch[2] === "image-review") {
        if (existing.coverPhoto?.status !== "ready" || !imageChecks.every((_, i) => body.checks?.[i] === true)) return json(res, 409, { error: "表紙写真とすべての画像チェック項目を確認してください。" });
        return json(res, 200, await updatePost(existing.id, { imageReview: { checks: imageChecks.map(() => true), fingerprint: fingerprint(existing), reviewedAt: new Date().toISOString(), method: "human" }, status: "review", approvedAt: null }));
      }
      if (body.data && body.rightsConfirmed !== true) return json(res, 400, { error: "アップロード画像の利用権を確認してください。" });
      const query = String(body.query || existing.content.imageQuery).trim().slice(0, 200);
      const coverPhoto = body.data ? await uploadedCoverPhoto(body.data) : await fetchCoverPhoto(query, existing.coverPhoto?.id);
      if (!coverPhoto.buffer) return json(res, 422, { error: coverPhoto.metadata.error || "写真を取得できません。検索語を変更してください。" });
      const account = accounts.find((item) => item.id === existing.accountId) || accounts[0];
      const rendered = await renderCarousel({ id: existing.id, topic: existing.topic, contentType: existing.contentType, content: existing.content, account, coverPhoto });
      const assets = await persistRenderedAssets(existing.id, rendered);
      const post = await updatePost(existing.id, { coverPhoto: coverPhoto.metadata, assets, imageReview: null, status: "review", approvedAt: null, publishResult: null, publishedAt: null });
      await deleteBlobAssets(existing.assets).catch(() => {});
      return json(res, 200, post);
    }

    const postMatch = url.pathname.match(/^\/api\/posts\/([^/]+)$/);
    if (req.method === "PUT" && postMatch) {
      const existing = await getPost(postMatch[1]);
      if (!existing) return json(res, 404, { error: "投稿が見つかりません。" });
      const body = await readBody(req);
      let content = validateContent(body.content, existing.contentType);
      if (["published", "publishing", "publish_unknown"].includes(existing.status)) return json(res, 409, { error: "公開済み・公開処理中の投稿は編集できません。" });
      if (existing.generationSource !== "demo") content = validateContent(await normalizeTextLengths({ ...existing, content }), existing.contentType);
      const account = accounts.find((item) => item.id === existing.accountId) || accounts[0];
      const quality = await evaluateContentQuality({ content, sources: existing.sources || [], topic: existing.topic, contentType: existing.contentType, targetYear: existing.targetYear });
      const coverPhoto = await restoreCoverPhoto(existing.coverPhoto);
      const renderedAssets = await renderCarousel({ id: existing.id, topic: existing.topic, contentType: existing.contentType, content, account, coverPhoto });
      const companyLogos = await readLogoMetadata(existing.id);
      const assets = await persistRenderedAssets(existing.id, renderedAssets);
      const post = await updatePost(existing.id, { imageReview: null, content, companyLogos, quality, assets, status: "review", approvedAt: null, publishResult: null, publishedAt: null });
      await deleteBlobAssets(existing.assets).catch((error) => console.warn(`古いBlob画像の削除をスキップしました: ${error.message}`));
      return json(res, 200, post);
    }

    if (req.method === "DELETE" && postMatch) {
      const removed = await deletePost(postMatch[1]);
      if (!removed) return json(res, 404, { error: "投稿が見つかりません。" });
      if (storageMode() === "blob") {
        await deleteBlobAssets(removed.assets).catch((error) => console.warn(`Blob画像の削除をスキップしました: ${error.message}`));
      } else {
        const source = path.join(outputRoot(), removed.id);
        const trash = path.join(outputRoot(), ".trash", `${removed.id}-${Date.now()}`);
        await fs.mkdir(path.dirname(trash), { recursive: true });
        try { await fs.rename(source, trash); } catch (error) { if (error.code !== "ENOENT") throw error; }
      }
      return json(res, 200, { deleted: true, id: removed.id });
    }

    const regenerateMatch = url.pathname.match(/^\/api\/posts\/([^/]+)\/regenerate$/);
    if (req.method === "POST" && regenerateMatch) {
      const existing = await getPost(regenerateMatch[1]);
      if (!existing) return json(res, 404, { error: "投稿が見つかりません。" });
      if (["published", "publishing", "publish_unknown"].includes(existing.status)) return json(res, 409, { error: "公開済み・公開処理中の投稿は再生成できません。" });
      const account = accounts.find((item) => item.id === existing.accountId) || accounts[0];
      const generated = await generateCarousel({ topic: existing.topic, contentType: existing.contentType, targetYear: existing.targetYear, notes: existing.notes || "", account });
      const coverPhoto = await fetchCoverPhoto(generated.content.imageQuery);
      const renderedAssets = await renderCarousel({ id: existing.id, topic: existing.topic, contentType: existing.contentType, content: generated.content, account, coverPhoto });
      const companyLogos = await readLogoMetadata(existing.id);
      const assets = await persistRenderedAssets(existing.id, renderedAssets);
      const post = await updatePost(existing.id, { imageReview: null, content: generated.content, sources: generated.sources, coverPhoto: coverPhoto.metadata, companyLogos, quality: generated.quality, assets, generationSource: generated.source, status: "review", approvedAt: null, publishResult: null, publishedAt: null });
      await deleteBlobAssets(existing.assets).catch((error) => console.warn(`古いBlob画像の削除をスキップしました: ${error.message}`));
      return json(res, 200, post);
    }

    const approveMatch = url.pathname.match(/^\/api\/posts\/([^/]+)\/approve$/);
    if (req.method === "POST" && approveMatch) {
      const existing = await getPost(approveMatch[1]);
      if (!existing) return json(res, 404, { error: "投稿が見つかりません。" });
      if (!["review", "approved"].includes(existing.status)) return json(res, 409, { error: "確認待ちの投稿のみ承認できます。" });
      if (existing.generationSource !== "demo" && !publicationGate(existing.quality, existing.content, existing.sources || [], existing.companyLogos || {}).ready) {
        const account = accounts.find(item => item.id === existing.accountId) || accounts[0];
        const improved = await autoImproveQuality({ ...existing, account });
        const { content, sources, quality } = improved;
        const coverPhoto = await restoreCoverPhoto(existing.coverPhoto);
        if (existing.coverPhoto?.status === "ready" && !coverPhoto?.buffer) return json(res, 422, { error: "表紙の復元に失敗しました。元の原稿は変更していません。再実行してください。" });
        const rendered = await renderCarousel({ id: existing.id, topic: existing.topic, contentType: existing.contentType, content, account, coverPhoto });
        const assets = await persistRenderedAssets(existing.id, rendered);
        const companyLogos = await readLogoMetadata(existing.id);
        const finalGate = publicationGate(quality, content, sources, companyLogos);
        const report = { ...improved.repairReport, ready: finalGate.ready, failed: finalGate.failed, completedAt: new Date().toISOString() };
        const saved = await updatePost(existing.id, { content, sources, quality, assets, companyLogos, imageReview: null, status: "review", approvedAt: null, qualityRepair: report });
        await deleteBlobAssets(existing.assets).catch(() => {});
        return json(res, 200, { ...saved, notice: finalGate.ready ? `自動改善後の総合評価は${quality.overallScore}点で公開基準に合格しました。再調査・修正で内容が変わる場合があります。原稿と画像を確認し、画像チェックを記録して再度承認してください。` : `自動改善を実行しましたが、まだ合格していません（${quality.overallScore}点）。 ${finalGate.failed.join(" ")} ${report.attempts.filter(a => a.error).map(a => a.error).join(" ")} 投稿は行っていません。` });
      }
      if (!imageReviewReady(existing)) return json(res, 409, { error: "表紙の画像チェックが未完了です。写真を確認し、全項目を記録してください。" });
      const gate = publicationGate(existing.quality, existing.content, existing.sources || [], existing.companyLogos || {});
      if (existing.generationSource !== "demo" && !gate.ready) return json(res, 409, { error: `公開基準を満たしていません。 ${gate.failed.join(" ")}` });
      const post = await updatePost(approveMatch[1], { status: "approved", approvedAt: new Date().toISOString() });
      return post ? json(res, 200, post) : json(res, 404, { error: "投稿が見つかりません。" });
    }

    const unapproveMatch = url.pathname.match(/^\/api\/posts\/([^/]+)\/unapprove$/);
    if (req.method === "POST" && unapproveMatch) {
      const post = await updatePost(unapproveMatch[1], { status: "review", approvedAt: null });
      return post ? json(res, 200, post) : json(res, 404, { error: "投稿が見つかりません。" });
    }

    const publishMatch = url.pathname.match(/^\/api\/posts\/([^/]+)\/publish$/);
    if (req.method === "POST" && publishMatch) {
      const post = await getPost(publishMatch[1]);
      if (!post) return json(res, 404, { error: "投稿が見つかりません。" });
      if (post.status !== "approved") return json(res, 409, { error: "公開前に承認してください。" });
      if (!imageReviewReady(post)) return json(res, 409, { error: "画像チェックをやり直してください。" });
      const gate = publicationGate(post.quality, post.content, post.sources || [], post.companyLogos || {});
      if (post.generationSource === "demo" && process.env.INSTAGRAM_DRY_RUN === "false") return json(res, 409, { error: "デモ投稿は実公開できません。" });
      if (post.generationSource !== "demo" && !gate.ready) return json(res, 409, { error: gate.failed.join(" ") });
      const result = await publishCarousel(post);
      const saved = await updatePost(post.id, { status: result.dryRun ? "dry_run_complete" : "published", publishResult: result, publishedAt: new Date().toISOString() });
      return json(res, 200, saved);
    }

    if (req.method === "GET" && url.pathname.startsWith("/output/")) {
      if (await serveFile(res, outputRoot(), url.pathname.slice("/output/".length))) return;
    }
    if (req.method === "GET") {
      const staticPath = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
      if (await serveFile(res, path.join(root, "public"), staticPath)) return;
    }
    json(res, 404, { error: "Not found" });
  } catch (error) {
    console.error(error);
    json(res, 500, { error: error.message || "Internal server error" });
  }
}

async function start() {
  await ensureStore();
  await fs.mkdir(outputRoot(), { recursive: true });
  const port = Number(process.env.PORT || 3000);
  const server = http.createServer(handler);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, resolve);
  });
  const actualPort = server.address().port;
  console.log(`Instagram Carousel MVP: http://localhost:${actualPort}`);
  return server;
}

if (require.main === module) start();
module.exports = { start, handler, authorizeRequest, timingSafeTextEqual };
