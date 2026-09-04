const archiver = require("archiver");
const { captionFor } = require("./instagram");
const { readAssetBuffer } = require("./blob-storage");

function postInfo(post) {
  return [
    `Topic: ${post.topic}`,
    `Content type: ${post.contentTypeLabel || post.contentType || "legacy"}`,
    `Target: ${post.targetYear}`,
    `Account: ${post.accountName}`,
    `Generation source: ${post.generationSource}`,
    `Status: ${post.status}`,
    `Created at: ${post.createdAt}`,
    `Updated at: ${post.updatedAt}`
  ].join("\n") + "\n";
}

function referencesText(post) {
  if (!post.sources?.length) return "No references recorded.\n";
  return post.sources.map((source, index) => [
    `${source.id || `S${index + 1}`}. ${source.title}`,
    `Publisher: ${source.publisher || "Unknown"}`,
    `Published: ${source.publishedAt || "Unknown"}`,
    `URL: ${source.url}`,
    `Supports: ${source.supportedClaim || "Not recorded"}`,
    `Verified by web search: ${source.verifiedBySearch ? "Yes" : "No"}`
  ].join("\n")).join("\n\n") + "\n";
}

function photoCreditText(post) {
  const photo = post.coverPhoto;
  if (!photo || photo.status !== "ready") return "No cover photo recorded.\n";
  return [
    `Provider: ${photo.provider}`,
    `Photographer: ${photo.photographer}`,
    `Photographer URL: ${photo.photographerUrl}`,
    `Photo URL: ${photo.sourceUrl}`,
    `Search query: ${photo.query}`
  ].join("\n") + "\n";
}

async function streamPostExport(post, res) {
  const safeId = String(post.id).replace(/[^a-zA-Z0-9_-]/g, "-");
  const imageBuffers = await Promise.all(post.assets.map((asset) => readAssetBuffer(asset)));
  res.writeHead(200, {
    "Content-Type": "application/zip",
    "Content-Disposition": `attachment; filename="instagram-post-${safeId}.zip"`,
    "Cache-Control": "no-store"
  });

  const archive = archiver("zip", { zlib: { level: 9 } });
  archive.on("warning", (error) => {
    if (error.code !== "ENOENT") res.destroy(error);
  });
  archive.on("error", (error) => res.destroy(error));
  archive.pipe(res);

  for (const [index, buffer] of imageBuffers.entries()) {
    archive.append(buffer, { name: `images/slide-${String(index + 1).padStart(2, "0")}.png` });
  }

  archive.append(`${captionFor(post)}\n`, { name: "caption.txt" });
  archive.append(postInfo(post), { name: "post-info.txt" });
  archive.append(referencesText(post), { name: "references.txt" });
  archive.append(photoCreditText(post), { name: "photo-credit.txt" });
  archive.append(`${JSON.stringify(post.coverPhoto || null, null, 2)}\n`, { name: "photo.json" });
  archive.append(`${JSON.stringify(post.companyLogos || {}, null, 2)}\n`, { name: "logos.json" });
  archive.append(`${JSON.stringify(post.quality || null, null, 2)}\n`, { name: "quality.json" });
  archive.append(`${JSON.stringify(post.content || null, null, 2)}\n`, { name: "content.json" });
  archive.append(`${JSON.stringify({
    id: post.id,
    topic: post.topic,
    targetYear: post.targetYear,
    accountName: post.accountName,
    generationSource: post.generationSource,
    contentType: post.contentType,
    contentTypeLabel: post.contentTypeLabel,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
    content: post.content,
    sources: post.sources,
    coverPhoto: post.coverPhoto,
    companyLogos: post.companyLogos,
    quality: post.quality
  }, null, 2)}\n`, { name: "post.json" });

  await archive.finalize();
}

module.exports = { streamPostExport, postInfo, referencesText, photoCreditText };
