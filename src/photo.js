const crypto = require("node:crypto");

const PEXELS_API = "https://api.pexels.com/v1/search";

function selectPhoto(photos, query) {
  if (!photos.length) return null;
  const digest = crypto.createHash("sha256").update(query).digest();
  return photos[digest[0] % photos.length];
}

async function fetchCoverPhoto(query, excludeId = "") {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) return { buffer: null, metadata: { provider: "Pexels", status: "not_configured", query } };
  try {
    const url = new URL(PEXELS_API);
    url.searchParams.set("query", query);
    url.searchParams.set("orientation", "landscape");
    url.searchParams.set("size", "large");
    url.searchParams.set("locale", "ja-JP");
    url.searchParams.set("per_page", "12");
    const response = await fetch(url, {
      headers: { Authorization: apiKey },
      signal: AbortSignal.timeout(15_000)
    });
    if (!response.ok) throw new Error(`Pexels API ${response.status}`);
    const body = await response.json();
    const photo = selectPhoto((Array.isArray(body.photos) ? body.photos : []).filter((p) => String(p.id) !== String(excludeId)), query + excludeId);
    if (!photo?.src?.landscape) throw new Error("条件に合う写真が見つかりませんでした。");
    const imageResponse = await fetch(photo.src.landscape, { signal: AbortSignal.timeout(20_000) });
    if (!imageResponse.ok) throw new Error(`写真取得 ${imageResponse.status}`);
    const buffer = Buffer.from(await imageResponse.arrayBuffer());
    if (!buffer.length || buffer.length > 20_000_000) throw new Error("写真データのサイズが不正です。");
    return {
      buffer,
      metadata: {
        provider: "Pexels",
        status: "ready",
        id: String(photo.id),
        query,
        photographer: String(photo.photographer || "Unknown"),
        photographerUrl: String(photo.photographer_url || ""),
        sourceUrl: String(photo.url || ""),
        imageUrl: String(photo.src.landscape),
        alt: String(photo.alt || "")
      }
    };
  } catch (error) {
    return { buffer: null, metadata: { provider: "Pexels", status: "failed", query, error: error.message } };
  }
}

async function restoreCoverPhoto(metadata) {
  if (metadata?.provider === "Upload" && metadata.data) return { buffer: Buffer.from(metadata.data, "base64"), metadata };
  if (!metadata?.imageUrl) return null;
  try {
    const response = await fetch(metadata.imageUrl, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`写真再取得 ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length || buffer.length > 20_000_000) throw new Error("写真データのサイズが不正です。");
    return { buffer, metadata };
  } catch {
    return null;
  }
}

async function uploadedCoverPhoto(data) {
  if (typeof data !== "string" || data.length > 900000 || !/^[A-Za-z0-9+/=]+$/.test(data)) throw new Error("画像は650KB以下のJPEG・PNG・WebPでアップロードしてください。");
  const sharp = require("sharp");
  const input = Buffer.from(data, "base64");
  const info = await sharp(input, { limitInputPixels: 16000000 }).metadata();
  if (!["jpeg", "png", "webp"].includes(info.format)) throw new Error("JPEG・PNG・WebPのみ対応しています。");
  const buffer = await sharp(input, { limitInputPixels: 16000000 }).rotate().resize(1600, 1200, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
  return { buffer, metadata: { provider: "Upload", status: "ready", id: crypto.createHash("sha256").update(buffer).digest("hex"), data: buffer.toString("base64"), sourceUrl: "", rights: "利用者が使用許諾を確認" } };
}

module.exports = { fetchCoverPhoto, restoreCoverPhoto, selectPhoto, uploadedCoverPhoto };
