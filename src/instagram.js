const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function graphBaseUrl() {
  return String(process.env.INSTAGRAM_GRAPH_API_BASE_URL || "https://graph.instagram.com").replace(/\/$/, "");
}

function graphUrl(path) {
  const version = process.env.META_GRAPH_API_VERSION || "v26.0";
  return new URL(`${graphBaseUrl()}/${version}/${String(path).replace(/^\/+/, "")}`);
}

function requireInstagramCredentials({ requireUserId = true } = {}) {
  if (!process.env.INSTAGRAM_ACCESS_TOKEN) {
    throw new Error("INSTAGRAM_ACCESS_TOKEN is required.");
  }
  if (requireUserId && !process.env.INSTAGRAM_USER_ID) {
    throw new Error("INSTAGRAM_USER_ID is required.");
  }
}

async function metaError(response, operation) {
  const token = process.env.INSTAGRAM_ACCESS_TOKEN || "";
  let detail = await response.text();
  if (token) detail = detail.split(token).join("[REDACTED]");
  throw new Error(`${operation} ${response.status}: ${detail.slice(0, 1000)}`);
}

function captionFor(post) {
  const sourceNotes = (post.sources || []).slice(0, 8).map((source, index) => `${source.id || `S${index + 1}`}. ${source.publisher || source.title}（${source.publishedAt || "日付不明"}）`);
  const photoCredit = post.coverPhoto?.status === "ready"
    ? `\n\n【写真】\nPhoto by ${post.coverPhoto.photographer} on Pexels\n${post.coverPhoto.sourceUrl}`
    : "";
  return `${post.content.caption}\n\n${post.content.hashtags.join(" ")}${sourceNotes.length ? `\n\n【参照】\n${sourceNotes.join("\n")}` : ""}${photoCredit}`.trim();
}

function publicAssetUrls(post) {
  const base = String(process.env.PUBLIC_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
  return post.assets.map((asset) => `${base}${asset}`);
}

async function graphPost(path, parameters, fetchImpl = fetch) {
  requireInstagramCredentials();
  const body = new URLSearchParams(parameters);
  const response = await fetchImpl(graphUrl(path), {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.INSTAGRAM_ACCESS_TOKEN}` },
    body
  });
  if (!response.ok) await metaError(response, "Instagram API");
  return response.json();
}

async function graphGet(path, parameters, fetchImpl = fetch) {
  requireInstagramCredentials({ requireUserId: false });
  const url = graphUrl(path);
  for (const [key, value] of Object.entries(parameters || {})) url.searchParams.set(key, value);
  const response = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${process.env.INSTAGRAM_ACCESS_TOKEN}` }
  });
  if (!response.ok) await metaError(response, "Instagram API");
  return response.json();
}

async function verifyInstagramConnection(fetchImpl = fetch) {
  requireInstagramCredentials();
  const profile = await graphGet("me", { fields: "user_id,username" }, fetchImpl);
  const userId = String(profile.user_id || profile.id || "");
  if (!userId) throw new Error("Instagram API response did not contain user_id.");
  if (userId !== String(process.env.INSTAGRAM_USER_ID)) {
    throw new Error("INSTAGRAM_USER_ID does not match the account represented by INSTAGRAM_ACCESS_TOKEN.");
  }
  return { connected: true, userId, username: profile.username || null };
}

async function waitForContainer(containerId, fetchImpl = fetch) {
  for (let attempt = 0; attempt < 15; attempt += 1) {
    const status = await graphGet(containerId, { fields: "status_code,status" }, fetchImpl);
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

  requireInstagramCredentials();
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

module.exports = {
  publishCarousel,
  captionFor,
  publicAssetUrls,
  graphBaseUrl,
  graphUrl,
  graphGet,
  graphPost,
  verifyInstagramConnection
};
