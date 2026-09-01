const fs = require("node:fs");
const path = require("node:path");
const archiver = require("archiver");
const { captionFor } = require("./instagram");

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
    `${index + 1}. ${source.title}`,
    `Publisher: ${source.publisher || "Unknown"}`,
    `Published: ${source.publishedAt || "Unknown"}`,
    `URL: ${source.url}`,
    `Supports: ${source.supportedClaim || "Not recorded"}`,
    `Verified by web search: ${source.verifiedBySearch ? "Yes" : "No"}`
  ].join("\n")).join("\n\n") + "\n";
}

async function streamPostExport(post, res) {
  const safeId = String(post.id).replace(/[^a-zA-Z0-9_-]/g, "-");
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

  const outputRoot = path.resolve(process.cwd(), "output");
  for (const [index, asset] of post.assets.entries()) {
    const relative = String(asset).replace(/^\/output\//, "");
    const filePath = path.resolve(outputRoot, relative);
    if (!filePath.startsWith(`${outputRoot}${path.sep}`)) throw new Error("画像パスが正しくありません。");
    archive.file(filePath, { name: `images/slide-${String(index + 1).padStart(2, "0")}.png` });
  }

  archive.append(`${captionFor(post)}\n`, { name: "caption.txt" });
  archive.append(postInfo(post), { name: "post-info.txt" });
  archive.append(referencesText(post), { name: "references.txt" });
  archive.append(`${JSON.stringify(post.quality || null, null, 2)}\n`, { name: "quality.json" });
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
    quality: post.quality
  }, null, 2)}\n`, { name: "post.json" });

  await archive.finalize();
}

module.exports = { streamPostExport, postInfo, referencesText };
