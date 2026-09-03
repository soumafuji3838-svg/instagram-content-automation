const fs = require("node:fs/promises");
const path = require("node:path");
const { outputRoot } = require("./runtime-paths");

const POSTS_BLOB_PATH = "private/posts.json";
let clientOverride = null;

function storageMode() {
  if (process.env.STORAGE_MODE === "local") return "local";
  if (process.env.STORAGE_MODE === "blob" || process.env.VERCEL || process.env.BLOB_READ_WRITE_TOKEN) return "blob";
  return "local";
}

function blobClient() {
  return clientOverride || require("@vercel/blob");
}

function credentialsFor(prefix, label) {
  const token = process.env[`${prefix}_READ_WRITE_TOKEN`];
  if (token) return { token };

  const oidcToken = process.env.VERCEL_OIDC_TOKEN;
  const storeId = process.env[`${prefix}_STORE_ID`];
  if (oidcToken && storeId) return { oidcToken, storeId };

  throw new Error(`${label}が未設定です。${prefix}_STORE_IDを持つBlobストアをプロジェクトへ接続してください。`);
}

function publicBlobCredentials() {
  return credentialsFor("BLOB", "公開画像用Vercel Blob");
}

function privateBlobCredentials() {
  return credentialsFor("POSTS_BLOB", "投稿データ用Vercel Blob");
}

function setBlobClientForTests(client) {
  clientOverride = client;
}

async function readPostsBlob() {
  const result = await blobClient().get(POSTS_BLOB_PATH, {
    access: "private",
    useCache: false,
    ...privateBlobCredentials()
  });
  if (!result || result.statusCode !== 200 || !result.stream) return [];
  const text = await new Response(result.stream).text();
  return text.trim() ? JSON.parse(text) : [];
}

async function writePostsBlob(posts) {
  await blobClient().put(POSTS_BLOB_PATH, `${JSON.stringify(posts, null, 2)}\n`, {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
    ...privateBlobCredentials()
  });
}

function localAssetPath(asset) {
  const relative = String(asset).replace(/^\/output\//, "");
  const filePath = path.resolve(outputRoot(), relative);
  if (!filePath.startsWith(`${path.resolve(outputRoot())}${path.sep}`)) {
    throw new Error("画像パスが正しくありません。");
  }
  return filePath;
}

async function persistRenderedAssets(id, assets) {
  if (storageMode() !== "blob") return assets;
  const client = blobClient();
  const uploaded = [];
  for (const [index, asset] of assets.entries()) {
    const buffer = await fs.readFile(localAssetPath(asset));
    const result = await client.put(`public/posts/${id}/slide-${String(index + 1).padStart(2, "0")}.png`, buffer, {
      access: "public",
      addRandomSuffix: true,
      contentType: "image/png",
      cacheControlMaxAge: 31536000,
      ...publicBlobCredentials()
    });
    uploaded.push(result.url);
  }
  return uploaded;
}

function isBlobUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === "https:" && /\.blob\.vercel-storage\.com$/i.test(url.hostname);
  } catch {
    return false;
  }
}

async function deleteBlobAssets(assets) {
  if (storageMode() !== "blob") return;
  const urls = (assets || []).filter(isBlobUrl);
  if (urls.length) await blobClient().del(urls, publicBlobCredentials());
}

async function readAssetBuffer(asset, fetchImpl = fetch) {
  if (!/^https:\/\//i.test(String(asset))) return fs.readFile(localAssetPath(asset));
  const response = await fetchImpl(asset, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`画像取得に失敗しました（HTTP ${response.status}）。`);
  return Buffer.from(await response.arrayBuffer());
}

module.exports = {
  POSTS_BLOB_PATH,
  storageMode,
  setBlobClientForTests,
  publicBlobCredentials,
  privateBlobCredentials,
  readPostsBlob,
  writePostsBlob,
  persistRenderedAssets,
  deleteBlobAssets,
  readAssetBuffer,
  localAssetPath,
  isBlobUrl
};
