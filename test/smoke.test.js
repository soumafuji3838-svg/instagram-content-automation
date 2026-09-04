const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { wrapJapanese, escapeXml, quantitativeSvg, comparisonSvg } = require("../src/renderer");
const { demoContent, validateContent, extractOutputText, buildOpenAIRequest, buildRepairRequest, repairFeedback, qualityRank, isBetterQuality, applyAccountRules, resolveCta, comparisonRowsFor } = require("../src/generator");
const { contentTypes } = require("../src/content-types");
const { getDesign } = require("../src/designs");
const { evidenceKey, extractWebEvidence, normalizeSources, sourceChecks, normalizeQuality, structureChecks, publicationGate, QUALITY_CRITERIA, OVERALL_PASS_SCORE, minimumScoreFor } = require("../src/quality");
const { selectPhoto } = require("../src/photo");
const { normalizeDomain, domainHosts, iconLinks, logoLinks, logoFallbackUrls, prioritizedLogoCandidates, logoDomains } = require("../src/logo");
const { graphUrl, graphPost, publicAssetUrls, verifyInstagramConnection } = require("../src/instagram");
const { authorizeRequest } = require("../src/app");
const {
  POSTS_BLOB_PATH,
  setBlobClientForTests,
  publicBlobCredentials,
  privateBlobCredentials,
  readPostsBlob,
  writePostsBlob,
  persistRenderedAssets,
  isBlobUrl
} = require("../src/blob-storage");
const { outputRoot } = require("../src/runtime-paths");
const vercelConfig = require("../vercel.json");
const accounts = require("../config/accounts.json");

test("Japanese wrapping preserves the text", () => {
  const input = "夏インターンの探し方を整理する";
  assert.equal(wrapJapanese(input, 6).join(""), input);
  assert.ok(wrapJapanese(input, 6).length > 1);
});

test("editor save shows progress and prevents duplicate submission", async () => {
  const html = await fs.readFile(path.join(__dirname, "..", "public", "index.html"), "utf8");
  assert.match(html, /保存・再生成中…/);
  assert.match(html, /品質を再評価し、5枚の画像を再生成しています。/);
  assert.match(html, /controls\.forEach\(\(control\) => \{ control\.disabled = true; \}\)/);
  assert.match(html, /setAttribute\("aria-busy", "true"\)/);
});

test("Japanese wrapping does not start a line with closing punctuation", () => {
  const lines = wrapJapanese("情報を選ぶと、迷いが減る。", 7);
  assert.ok(lines.every((line) => !"、。！？）」』】".includes(line[0])));
});

test("XML is escaped", () => {
  assert.equal(escapeXml("A&B<1"), "A&amp;B&lt;1");
});

test("demo carousel has the five-page structured content", () => {
  const content = demoContent({ topic: "面接準備", targetYear: "28卒", account: accounts[0] });
  assert.equal(content.quantitative.metrics.length, 3);
  assert.equal(content.comparison.columns.length, 3);
  assert.equal(content.comparison.columns[0].entityType, "industry");
  assert.equal(content.comparison.rows.length, 4);
  assert.ok(content.quantitative.studentInsight);
  assert.ok(content.qualitative.studentInsight);
  assert.ok(content.cta.title);
  assert.ok(content.hashtags.every((tag) => tag.startsWith("#")));
});

test("account branding and CTAs are fixed by content type", () => {
  assert.equal(accounts.length, 1);
  assert.equal(accounts[0].name, "就活研究所");
  assert.equal(accounts[0].instagram, "career_research_center");
  assert.equal(resolveCta(accounts[0], "industry_report"), "保存して、業界研究の参考にしてね！");
  assert.equal(resolveCta(accounts[0], "company_report"), "保存して、企業研究の参考にしてね！");
  const draft = validateContent({
    ...demoContent({ topic: "半導体", targetYear: "28・29卒", account: accounts[0], contentType: "industry_report" }),
    caption: "投稿です。\n\n保存して、あとで見返そう",
    hashtags: ["#就活ねこ", "#半導体"]
  }, "industry_report");
  const branded = applyAccountRules(draft, accounts[0], "industry_report");
  assert.ok(branded.caption.endsWith("保存して、業界研究の参考にしてね！"));
  assert.ok(branded.hashtags.includes("#28卒"));
  assert.ok(branded.hashtags.includes("#29卒"));
  assert.ok(!branded.hashtags.includes("#就活ねこ"));
});

test("five-page photo design is defined in JSON", () => {
  const design = getDesign(accounts[0].designId);
  assert.equal(design.canvas.width, 1080);
  assert.equal(design.canvas.height, 1350);
  assert.equal(design.colors.navy, "#062A55");
  assert.equal(design.photoPolicy.provider, "Pexels");
  assert.deepEqual(Object.keys(design.pages), ["cover", "quantitative", "qualitative", "comparison", "cta"]);
});

test("content validation rejects an invalid metric count", () => {
  const content = demoContent({ topic: "面接準備", targetYear: "28卒", account: accounts[0] });
  content.quantitative.metrics.pop();
  assert.throws(() => validateContent(content, "industry_report"), /3件/);
});

test("content validation normalizes hashtags without hash marks", () => {
  const content = demoContent({ topic: "面接準備", targetYear: "28卒", account: accounts[0] });
  content.hashtags = ["就活", "＃28卒", "# 面接 対策", "就活"];
  assert.deepEqual(validateContent(content, "industry_report").hashtags, ["#就活", "#28卒", "#面接対策"]);
});

test("comparison rows switch between industry and company formats", () => {
  assert.deepEqual(comparisonRowsFor("industry_report"), ["直近業績", "主な事業領域", "直近3カ月の変化", "就活での確認点"]);
  assert.deepEqual(comparisonRowsFor("industry_comparison"), ["市場成長性", "主要企業", "直近3カ月の変化", "専門性"]);
  assert.deepEqual(comparisonRowsFor("company_report"), ["平均年収", "内定倍率", "直近3カ月の変化", "カルチャー"]);
});

test("photo choice is deterministic", () => {
  const photos = Array.from({ length: 12 }, (_, id) => ({ id }));
  assert.deepEqual(selectPhoto(photos, "semiconductor engineer"), selectPhoto(photos, "semiconductor engineer"));
  assert.ok(photos.includes(selectPhoto(photos, "semiconductor engineer")));
});

test("official company domains are normalized and collected for logos", () => {
  const content = demoContent({ topic: "企業研究", targetYear: "28卒", account: accounts[0], contentType: "company_report" });
  content.subject.domain = "https://www.example.co.jp/about";
  content.quantitative.metrics[0].companyDomain = "www.example.co.jp";
  content.comparison.columns[0].domain = "another.example.com";
  assert.equal(normalizeDomain(content.subject.domain), "example.co.jp");
  assert.deepEqual(logoDomains(content), ["example.co.jp", "another.example.com"]);
  assert.deepEqual(iconLinks('<link rel="icon" href="/favicon.png">', "https://example.co.jp/about"), ["https://example.co.jp/favicon.png"]);
});

test("official logo discovery includes metadata and structured data", () => {
  const html = [
    '<link rel="icon" href="/favicon.png">',
    '<meta property="og:logo" content="/brand/logo.svg">',
    '<script type="application/ld+json">{"logo":"https:\\/\\/cdn.example.co.jp\\/logo.png"}</script>'
  ].join("");
  assert.deepEqual(logoLinks(html, "https://example.co.jp/about"), [
    "https://example.co.jp/favicon.png",
    "https://example.co.jp/brand/logo.svg",
    "https://cdn.example.co.jp/logo.png"
  ]);
});

test("logo discovery always retains the final domain favicon fallback", () => {
  const primary = Array.from({ length: 12 }, (_, index) => `https://example.co.jp/icon-${index}.png`);
  const fallbacks = logoFallbackUrls("example.co.jp");
  const candidates = prioritizedLogoCandidates(primary, fallbacks);
  assert.equal(candidates.length, 16);
  assert.deepEqual(candidates.slice(-fallbacks.length), fallbacks);
  assert.ok(fallbacks.some((url) => url.includes("domain_url=")));
  assert.ok(fallbacks.some((url) => url.includes("t2.gstatic.com")));
});

test("logo discovery tries the official www host before the normalized apex host", () => {
  assert.deepEqual(domainHosts("https://www.example.co.jp/news"), ["www.example.co.jp", "example.co.jp"]);
  const fallbacks = logoFallbackUrls("example.co.jp");
  assert.equal(fallbacks[0], "https://www.example.co.jp/favicon.ico");
  assert.ok(fallbacks.some((url) => url.includes("domain=www.example.co.jp")));
});

test("company labels render as logos or generic icons instead of names", () => {
  const content = validateContent(demoContent({ topic: "企業研究", targetYear: "28卒", account: accounts[0], contentType: "company_report" }), "company_report");
  const design = getDesign(accounts[0].designId);
  const quantitative = quantitativeSvg({ content, account: accounts[0], design, logos: {} });
  const comparison = comparisonSvg({ content, account: accounts[0], design, logos: {} });
  assert.doesNotMatch(quantitative, />企業A</);
  assert.doesNotMatch(comparison, />企業A</);
  assert.match(quantitative, /<g fill="none"/);
});

test("OpenAI output text is collected from raw Responses API items", () => {
  const response = {
    status: "completed",
    output: [
      { type: "reasoning", content: [] },
      { type: "message", content: [{ type: "output_text", text: "{\"ok\":true}" }] }
    ]
  };
  assert.equal(extractOutputText(response), '{"ok":true}');
});

test("incomplete OpenAI responses explain output token exhaustion", () => {
  assert.throws(
    () => extractOutputText({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output: [] }),
    /OPENAI_MAX_OUTPUT_TOKENS/
  );
});

test("OpenAI request reserves output space and uses low reasoning", () => {
  const previousEffort = process.env.OPENAI_REASONING_EFFORT;
  const previousMax = process.env.OPENAI_MAX_OUTPUT_TOKENS;
  delete process.env.OPENAI_REASONING_EFFORT;
  delete process.env.OPENAI_MAX_OUTPUT_TOKENS;
  try {
    const request = buildOpenAIRequest({ topic: "総合商社", contentType: "industry_report", targetYear: "28卒", account: accounts[0], notes: "具体的に" });
    assert.equal(request.reasoning.effort, "low");
    assert.equal(request.max_output_tokens, 25000);
    assert.equal(request.tools[0].type, "web_search");
    assert.equal(request.tool_choice, "required");
    assert.ok(request.include.includes("web_search_call.action.sources"));
  } finally {
    if (previousEffort === undefined) delete process.env.OPENAI_REASONING_EFFORT;
    else process.env.OPENAI_REASONING_EFFORT = previousEffort;
    if (previousMax === undefined) delete process.env.OPENAI_MAX_OUTPUT_TOKENS;
    else process.env.OPENAI_MAX_OUTPUT_TOKENS = previousMax;
  }
});

test("repair request rewrites only supplied content without web search", () => {
  const content = demoContent({ topic: "総合商社", targetYear: "28卒", account: accounts[0], contentType: "industry_report" });
  const request = buildRepairRequest({ content, sources: [], topic: "総合商社", contentType: "industry_report", targetYear: "28卒", feedback: ["短い"] });
  assert.equal(request.tools, undefined);
  assert.equal(request.text.format.strict, true);
  assert.match(request.instructions, /Never invent or estimate/);
  assert.match(request.instructions, /replace a mismatched value with 確認できず/);
  assert.match(request.instructions, /Never generalize one company's fact/);
  assert.deepEqual(JSON.parse(request.input).failedChecks, ["短い"]);
  assert.deepEqual(JSON.parse(request.input).fixedComparisonRows, ["直近業績", "主な事業領域", "直近3カ月の変化", "就活での確認点"]);
});

test("repair feedback excludes freshness and URL failures that rewriting cannot fix", () => {
  const content = demoContent({ topic: "総合商社", targetYear: "28卒", account: accounts[0], contentType: "industry_report" });
  const quality = { checks: QUALITY_CRITERIA.map((criterion) => ({
    criterion,
    score: criterion === QUALITY_CRITERIA[2] || criterion === QUALITY_CRITERIA[3] ? 2 : 5,
    suggestion: criterion === QUALITY_CRITERIA[2] ? "参照元を追加" : "重複を削除"
  })) };
  const feedback = repairFeedback(content, [], quality);
  assert.ok(feedback.some((item) => item.includes("重複を削除")));
  assert.ok(!feedback.includes("参照が存在するか: 参照元を追加"));
});

test("repair feedback prioritizes editorial checks below three", () => {
  const content = demoContent({ topic: "総合商社", targetYear: "28卒", account: accounts[0], contentType: "industry_report" });
  const quality = {
    overallScore: 80,
    checks: QUALITY_CRITERIA.map((criterion, index) => ({ criterion, score: index === 4 ? 2 : 4, pass: index !== 4, suggestion: `${criterion}を磨く` }))
  };
  const feedback = repairFeedback(content, [], quality);
  assert.ok(feedback.some((item) => item.includes("見出しだけで意味が伝わるかを磨く")));
  assert.ok(!feedback.some((item) => item.includes("抽象論になっていないかを磨く")));
});

test("repair feedback polishes three-point checks when the total is below 75", () => {
  const content = demoContent({ topic: "総合商社", targetYear: "28卒", account: accounts[0], contentType: "industry_report" });
  const quality = {
    overallScore: 70,
    checks: QUALITY_CRITERIA.map((criterion, index) => ({ criterion, score: index === 0 ? 3 : 4, pass: true, suggestion: `${criterion}を磨く` }))
  };
  const feedback = repairFeedback(content, [], quality);
  assert.ok(feedback.some((item) => item.includes("抽象論になっていないかを磨く")));
  assert.ok(!feedback.some((item) => item.includes("参照が存在するかを磨く")));
});

test("a repair candidate is retained only when it improves the 75-point publication gate", () => {
  const quality = (overallScore, scores) => ({
    overallScore,
    checks: QUALITY_CRITERIA.map((criterion, index) => ({ criterion, score: scores[index], pass: scores[index] >= minimumScoreFor(criterion) }))
  });
  const original = quality(77, [3, 5, 5, 3, 3, 4, 4]);
  const worseRepair = quality(69, [4, 5, 0, 4, 3, 4, 4]);
  const betterRepair = quality(91, [4, 5, 5, 5, 4, 4, 5]);
  assert.deepEqual(qualityRank(original), [1, 0, 3, 77]);
  assert.equal(isBetterQuality(worseRepair, original), false);
  assert.equal(isBetterQuality(betterRepair, original), true);
});

test("research request requires exact URLs returned by web search", () => {
  const request = buildOpenAIRequest({ topic: "総合商社", contentType: "industry_report", targetYear: "28卒", account: accounts[0], notes: "" });
  assert.match(request.instructions, /Copy every source URL character-for-character/);
  assert.deepEqual(JSON.parse(request.input).comparisonRows, ["直近業績", "主な事業領域", "直近3カ月の変化", "就活での確認点"]);
});

test("all requested content types are available", () => {
  assert.deepEqual(contentTypes.map((type) => type.id), ["industry_report", "company_report", "industry_comparison", "company_comparison", "trend_report"]);
});

test("web evidence verifies recent source URLs", () => {
  const response = {
    output: [
      { type: "web_search_call", action: { sources: [{ type: "url", url: "https://example.com/report" }] } },
      { type: "message", content: [{ type: "output_text", text: "{}", annotations: [{ type: "url_citation", url: "https://example.com/report", title: "Report" }] }] }
    ]
  };
  const evidence = extractWebEvidence(response);
  const sources = normalizeSources([{ title: "Report", publisher: "Example", url: "https://example.com/report", publishedAt: "2026-08-01", supportedClaim: "Market changed" }], evidence);
  assert.equal(sources[0].verifiedBySearch, true);
  const checks = sourceChecks(sources.concat(
    { ...sources[0], url: "https://example.com/report-2" },
    { ...sources[0], url: "https://example.com/report-3" }
  ), new Date("2026-08-30T00:00:00Z"));
  assert.equal(checks.freshness.pass, true);
  assert.equal(checks.references.pass, true);
});

test("web evidence matching ignores tracking parameters and www", () => {
  assert.equal(evidenceKey("https://www.example.com/report/?utm_source=x"), "example.com/report");
  const sources = normalizeSources([
    { id: "S1", title: "Report", url: "https://example.com/report?ref=feed", publishedAt: "2026-08-01" }
  ], { citations: [], consultedUrls: ["https://www.example.com/report/?utm_source=search"] });
  assert.equal(sources[0].verifiedBySearch, true);
});

test("quality output always contains the seven requested criteria", () => {
  const raw = { checks: QUALITY_CRITERIA.map((criterion) => ({ criterion, score: 4, reason: "具体的", suggestion: "維持" })) };
  const quality = normalizeQuality(raw, [], new Date("2026-08-30T00:00:00Z"));
  assert.equal(quality.checks.length, 7);
  assert.equal(quality.checks[1].pass, false);
  assert.equal(quality.checks[2].pass, false);
});

test("publication gate requires 75 points, source scores of four, and editorial scores of three", () => {
  assert.equal(OVERALL_PASS_SCORE, 75);
  assert.equal(minimumScoreFor(QUALITY_CRITERIA[0]), 3);
  assert.equal(minimumScoreFor(QUALITY_CRITERIA[1]), 4);
  const readyQuality = { overallScore: 77, checks: QUALITY_CRITERIA.map((criterion, index) => ({ criterion, score: index === 1 || index === 2 ? 5 : 3 })) };
  assert.equal(publicationGate(readyQuality).ready, true);
  readyQuality.checks[0].score = 2;
  assert.equal(publicationGate(readyQuality).ready, false);
  readyQuality.checks[0].score = 3;
  readyQuality.checks[2].score = 3;
  assert.equal(publicationGate(readyQuality).ready, false);
  readyQuality.checks[2].score = 5;
  readyQuality.overallScore = 74;
  assert.equal(publicationGate(readyQuality).ready, false);
});

test("publication gate rejects a failed company logo", () => {
  const readyQuality = { overallScore: 100, checks: QUALITY_CRITERIA.map((criterion) => ({ criterion, score: 5, pass: true })) };
  assert.equal(publicationGate(readyQuality, null, [], { "example.co.jp": { status: "failed" } }).ready, false);
});

test("structure checks enforce editorial lengths and source traceability", () => {
  const content = demoContent({ topic: "半導体", targetYear: "28卒", account: accounts[0], contentType: "industry_report" });
  assert.ok(structureChecks(content, []).some((message) => message.includes("出典ID")));
  content.quantitative.summaryText = "短い要約";
  assert.ok(structureChecks(content, []).some((message) => message.includes("90〜110文字")));
});

test("Instagram Login uses graph.instagram.com and keeps the token out of request parameters", async () => {
  const previousToken = process.env.INSTAGRAM_ACCESS_TOKEN;
  const previousUserId = process.env.INSTAGRAM_USER_ID;
  const previousVersion = process.env.META_GRAPH_API_VERSION;
  process.env.INSTAGRAM_ACCESS_TOKEN = "test-secret-token";
  process.env.INSTAGRAM_USER_ID = "123456";
  process.env.META_GRAPH_API_VERSION = "v26.0";
  try {
    assert.equal(graphUrl("123456/media").origin, "https://graph.instagram.com");
    await graphPost("123456/media", { image_url: "https://example.com/image.png" }, async (url, options) => {
      assert.equal(url.toString(), "https://graph.instagram.com/v26.0/123456/media");
      assert.equal(options.headers.Authorization, "Bearer test-secret-token");
      assert.equal(options.body.get("access_token"), null);
      return new Response(JSON.stringify({ id: "container-1" }), { status: 200 });
    });
  } finally {
    if (previousToken === undefined) delete process.env.INSTAGRAM_ACCESS_TOKEN;
    else process.env.INSTAGRAM_ACCESS_TOKEN = previousToken;
    if (previousUserId === undefined) delete process.env.INSTAGRAM_USER_ID;
    else process.env.INSTAGRAM_USER_ID = previousUserId;
    if (previousVersion === undefined) delete process.env.META_GRAPH_API_VERSION;
    else process.env.META_GRAPH_API_VERSION = previousVersion;
  }
});

test("Instagram connection check validates the token account against INSTAGRAM_USER_ID", async () => {
  const previousToken = process.env.INSTAGRAM_ACCESS_TOKEN;
  const previousUserId = process.env.INSTAGRAM_USER_ID;
  process.env.INSTAGRAM_ACCESS_TOKEN = "test-secret-token";
  process.env.INSTAGRAM_USER_ID = "123456";
  try {
    const result = await verifyInstagramConnection(async (url, options) => {
      assert.equal(url.searchParams.get("fields"), "user_id,username");
      assert.equal(url.searchParams.get("access_token"), null);
      assert.equal(options.headers.Authorization, "Bearer test-secret-token");
      return new Response(JSON.stringify({ user_id: "123456", username: "career_research_center" }), { status: 200 });
    });
    assert.deepEqual(result, { connected: true, userId: "123456", username: "career_research_center" });
  } finally {
    if (previousToken === undefined) delete process.env.INSTAGRAM_ACCESS_TOKEN;
    else process.env.INSTAGRAM_ACCESS_TOKEN = previousToken;
    if (previousUserId === undefined) delete process.env.INSTAGRAM_USER_ID;
    else process.env.INSTAGRAM_USER_ID = previousUserId;
  }
});

test("public Instagram payload keeps Vercel Blob URLs unchanged", () => {
  const previousBase = process.env.PUBLIC_BASE_URL;
  process.env.PUBLIC_BASE_URL = "https://studio.example.com";
  try {
    assert.deepEqual(publicAssetUrls({ assets: [
      "https://store.public.blob.vercel-storage.com/slide.png",
      "/output/example/slide.png"
    ] }), [
      "https://store.public.blob.vercel-storage.com/slide.png",
      "https://studio.example.com/output/example/slide.png"
    ]);
    assert.equal(isBlobUrl("https://store.public.blob.vercel-storage.com/slide.png"), true);
  } finally {
    if (previousBase === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = previousBase;
  }
});

test("public and private Blob stores use separate credentials", () => {
  const previousPublicToken = process.env.BLOB_READ_WRITE_TOKEN;
  const previousPrivateToken = process.env.POSTS_BLOB_READ_WRITE_TOKEN;
  process.env.BLOB_READ_WRITE_TOKEN = "public-images-token";
  process.env.POSTS_BLOB_READ_WRITE_TOKEN = "private-posts-token";
  try {
    assert.deepEqual(publicBlobCredentials(), { token: "public-images-token" });
    assert.deepEqual(privateBlobCredentials(), { token: "private-posts-token" });
  } finally {
    if (previousPublicToken === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
    else process.env.BLOB_READ_WRITE_TOKEN = previousPublicToken;
    if (previousPrivateToken === undefined) delete process.env.POSTS_BLOB_READ_WRITE_TOKEN;
    else process.env.POSTS_BLOB_READ_WRITE_TOKEN = previousPrivateToken;
  }
});

test("rendered slides are uploaded only with public-store credentials", async () => {
  const previousMode = process.env.STORAGE_MODE;
  const previousToken = process.env.BLOB_READ_WRITE_TOKEN;
  process.env.STORAGE_MODE = "blob";
  process.env.BLOB_READ_WRITE_TOKEN = "public-images-token";
  const directory = `blob-test-${Date.now()}`;
  const asset = `/output/${directory}/slide.png`;
  const filePath = path.join(outputRoot(), directory, "slide.png");
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, "test-image");
  setBlobClientForTests({
    async put(pathname, body, options) {
      assert.match(pathname, /^public\/posts\/post-1\/slide-01\.png$/);
      assert.equal(Buffer.from(body).toString(), "test-image");
      assert.equal(options.access, "public");
      assert.equal(options.token, "public-images-token");
      return { url: "https://store.public.blob.vercel-storage.com/slide.png" };
    }
  });
  try {
    assert.deepEqual(await persistRenderedAssets("post-1", [asset]), [
      "https://store.public.blob.vercel-storage.com/slide.png"
    ]);
  } finally {
    setBlobClientForTests(null);
    await fs.rm(path.join(outputRoot(), directory), { recursive: true, force: true });
    if (previousMode === undefined) delete process.env.STORAGE_MODE;
    else process.env.STORAGE_MODE = previousMode;
    if (previousToken === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
    else process.env.BLOB_READ_WRITE_TOKEN = previousToken;
  }
});

test("Blob post state uses the private store and can be read after overwrite", async () => {
  const previousMode = process.env.STORAGE_MODE;
  const previousToken = process.env.POSTS_BLOB_READ_WRITE_TOKEN;
  process.env.STORAGE_MODE = "blob";
  process.env.POSTS_BLOB_READ_WRITE_TOKEN = "private-posts-token";
  let stored = null;
  setBlobClientForTests({
    async put(pathname, body, options) {
      assert.equal(pathname, POSTS_BLOB_PATH);
      assert.equal(options.access, "private");
      assert.equal(options.allowOverwrite, true);
      assert.equal(options.token, "private-posts-token");
      stored = String(body);
      return { url: "https://store.private.blob.vercel-storage.com/private/posts.json" };
    },
    async get(pathname, options) {
      assert.equal(pathname, POSTS_BLOB_PATH);
      assert.equal(options.access, "private");
      assert.equal(options.token, "private-posts-token");
      return stored ? { statusCode: 200, stream: new Blob([stored]).stream() } : null;
    }
  });
  try {
    assert.deepEqual(await readPostsBlob(), []);
    await writePostsBlob([{ id: "post-1" }]);
    assert.deepEqual(await readPostsBlob(), [{ id: "post-1" }]);
  } finally {
    setBlobClientForTests(null);
    if (previousMode === undefined) delete process.env.STORAGE_MODE;
    else process.env.STORAGE_MODE = previousMode;
    if (previousToken === undefined) delete process.env.POSTS_BLOB_READ_WRITE_TOKEN;
    else process.env.POSTS_BLOB_READ_WRITE_TOKEN = previousToken;
  }
});

test("Vercel requires admin credentials and accepts valid Basic authentication", () => {
  const previousVercel = process.env.VERCEL;
  const previousPassword = process.env.ADMIN_PASSWORD;
  const previousUsername = process.env.ADMIN_USERNAME;
  process.env.VERCEL = "1";
  process.env.ADMIN_USERNAME = "admin";
  process.env.ADMIN_PASSWORD = "test-password";
  try {
    const unauthorized = { status: null, body: "", writeHead(status) { this.status = status; }, end(body) { this.body = body; } };
    assert.equal(authorizeRequest({ headers: {} }, unauthorized), false);
    assert.equal(unauthorized.status, 401);
    const authorization = `Basic ${Buffer.from("admin:test-password").toString("base64")}`;
    assert.equal(authorizeRequest({ headers: { authorization } }, {}), true);
  } finally {
    if (previousVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = previousVercel;
    if (previousPassword === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = previousPassword;
    if (previousUsername === undefined) delete process.env.ADMIN_USERNAME;
    else process.env.ADMIN_USERNAME = previousUsername;
  }
});

test("Vercel routes all requests through the protected Node function", () => {
  assert.equal(vercelConfig.functions["api/index.js"].maxDuration, 300);
  assert.deepEqual(vercelConfig.routes, [{ src: "/(.*)", dest: "/api/index.js" }]);
});
