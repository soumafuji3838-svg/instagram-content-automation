const crypto = require("node:crypto");

const PEXELS_API = "https://api.pexels.com/v1/search";

async function reviewPhoto(buffer, context = "business research", mode = "photo") {
  if (!process.env.OPENAI_API_KEY) throw new Error("写真の自動審査にはOpenAI接続が必要です。");
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    signal: AbortSignal.timeout(30_000),
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-5.6",
      instructions: mode === "layout" ? `Inspect all five rendered carousel pages. Expected topic/type/data: ${context}. Reject overlapping text, clipping, missing company logos, missing values, wrong company/value pairing, unreadably small text, blank pages or unbalanced unexplained gaps. Return safe=true only when every page passes; explain defects in reason. Ignore image subject aesthetics here.` : `Review this stock image for a factual Japanese employer research account. Topic: ${context}. Accept only relevant neutral-to-positive industry scenes, offices, or naturally working professionals. Reject anger, distress, crying, exhaustion, displeasure, stress, unnatural expressions or poses, mockery, stereotypes, irrelevant people and misleading workplace implications. Judge visible presentation, not actual personality or working conditions. Set safe=false if uncertain. Do not identify people.`,
      input: [{ role: "user", content: (Array.isArray(buffer) ? buffer : [buffer]).map(bytes => ({ type: "input_image", image_url: `data:image/${mode === "layout" ? "png" : "jpeg"};base64,${bytes.toString("base64")}` })) }],
      text: { format: { type: "json_schema", name: "photo_review", strict: true, schema: { type: "object", properties: { safe: { type: "boolean" }, reason: { type: "string" } }, required: ["safe", "reason"], additionalProperties: false } } }
    })
  });
  if (!response.ok) throw new Error(`写真審査 ${response.status}`);
  const result = await response.json();
  const raw = result.output_text || (result.output || []).flatMap(item => item.content || []).filter(item => item.type === "output_text").map(item => item.text).join("");
  return JSON.parse(raw);
}

function selectPhoto(photos, query) {
  if (!photos.length) return null;
  const digest = crypto.createHash("sha256").update(query).digest();
  return photos[digest[0] % photos.length];
}

async function fetchCoverPhoto(query, excludeId = "") {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) return { buffer: null, metadata: { provider: "Pexels", status: "not_configured", query } };
  try {
    const queries = [query, `${query} office business`, `${query} professional working naturally`, "modern office architecture"];
    const seen = new Set([String(excludeId)]);
    for (const searchQuery of queries) {
    const url = new URL(PEXELS_API);
    url.searchParams.set("query", searchQuery);
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
    const candidates = (Array.isArray(body.photos) ? body.photos : []).filter((p) => String(p.id) !== String(excludeId));
    let photo, buffer, review;
    for (const candidate of candidates.filter(p => !seen.has(String(p.id))).slice(0, 2)) {
      seen.add(String(candidate.id));
      if (!candidate?.src?.landscape) continue;
      const imageResponse = await fetch(candidate.src.landscape, { signal: AbortSignal.timeout(20_000) });
      if (!imageResponse.ok) continue;
      const bytes = Buffer.from(await imageResponse.arrayBuffer());
      if (!bytes.length || bytes.length > 20_000_000) continue;
      const checked = await reviewPhoto(bytes, query);
      if (checked.safe !== true) continue;
      photo = candidate; buffer = bytes; review = checked; break;
    }
    if (!photo?.src?.landscape) continue;
    return {
      buffer,
      metadata: {
        provider: "Pexels",
        status: "ready",
        automatedReview: { ...review, policy: "neutral-relevant-v2" },
        id: String(photo.id),
        query,
        photographer: String(photo.photographer || "Unknown"),
        photographerUrl: String(photo.photographer_url || ""),
        sourceUrl: String(photo.url || ""),
        imageUrl: String(photo.src.landscape),
        alt: String(photo.alt || "")
      }
    };
    }
    throw new Error("8候補以内に品質基準を満たす写真が見つかりませんでした。");
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

module.exports = { fetchCoverPhoto, restoreCoverPhoto, selectPhoto, uploadedCoverPhoto, reviewPhoto };
