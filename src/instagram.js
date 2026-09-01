const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function captionFor(post) {
  const sourceNotes = (post.sources || []).slice(0, 5).map((source, index) => `${index + 1}. ${source.publisher || source.title}（${source.publishedAt || "日付不明"}）`);
  return `${post.content.caption}\n\n${post.content.hashtags.join(" ")}${sourceNotes.length ? `\n\n【参照】\n${sourceNotes.join("\n")}` : ""}`.trim();
}

function publicAssetUrls(post) {
  const base = String(process.env.PUBLIC_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
  return post.assets.map((asset) => `${base}${asset}`);
}

async function graphPost(path, parameters) {
  const version = process.env.META_GRAPH_API_VERSION || "v26.0";
  const body = new URLSearchParams({ ...parameters, access_token: process.env.INSTAGRAM_ACCESS_TOKEN });
  const response = await fetch(`https://graph.facebook.com/${version}/${path}`, { method: "POST", body });
  if (!response.ok) throw new Error(`Meta API ${response.status}: ${await response.text()}`);
  return response.json();
}

async function waitForContainer(containerId) {
  const version = process.env.META_GRAPH_API_VERSION || "v26.0";
  for (let attempt = 0; attempt < 15; attempt += 1) {
    const url = new URL(`https://graph.facebook.com/${version}/${containerId}`);
    url.searchParams.set("fields", "status_code,status");
    url.searchParams.set("access_token", process.env.INSTAGRAM_ACCESS_TOKEN);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Meta status API ${response.status}: ${await response.text()}`);
    const status = await response.json();
    if (status.status_code === "FINISHED") return status;
    if (status.status_code === "ERROR" || status.status_code === "EXPIRED") {
      throw new Error(`Meta container ${containerId}: ${status.status || status.status_code}`);
    }
    await delay(2000);
  }
  throw new Error(`Meta container ${containerId} did not finish in time.`);
}

async function publishCarousel(post) {
  const imageUrls = publicAssetUrls(post);
  const dryRun = process.env.INSTAGRAM_DRY_RUN !== "false";
  const payload = { imageUrls, caption: captionFor(post), accountId: post.accountId };
  if (dryRun) return { dryRun: true, payload };

  if (!process.env.INSTAGRAM_USER_ID || !process.env.INSTAGRAM_ACCESS_TOKEN) {
    throw new Error("INSTAGRAM_USER_ID and INSTAGRAM_ACCESS_TOKEN are required for live publishing.");
  }
  if (!String(process.env.PUBLIC_BASE_URL || "").startsWith("https://")) {
    throw new Error("PUBLIC_BASE_URL must be a public HTTPS URL for live publishing.");
  }

  const children = [];
  for (const imageUrl of imageUrls) {
    const child = await graphPost(`${process.env.INSTAGRAM_USER_ID}/media`, {
      image_url: imageUrl,
      is_carousel_item: "true"
    });
    await waitForContainer(child.id);
    children.push(child.id);
  }

  const parent = await graphPost(`${process.env.INSTAGRAM_USER_ID}/media`, {
    media_type: "CAROUSEL",
    children: children.join(","),
    caption: captionFor(post)
  });
  await waitForContainer(parent.id);
  const published = await graphPost(`${process.env.INSTAGRAM_USER_ID}/media_publish`, {
    creation_id: parent.id
  });
  return { dryRun: false, mediaId: published.id, payload };
}

module.exports = { publishCarousel, captionFor, publicAssetUrls };
