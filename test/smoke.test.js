const test = require("node:test");
const assert = require("node:assert/strict");
const { wrapJapanese, escapeXml, quantitativeSvg, comparisonSvg } = require("../src/renderer");
const { demoContent, validateContent, extractOutputText, buildOpenAIRequest, applyAccountRules, resolveCta, comparisonRowsFor } = require("../src/generator");
const { contentTypes } = require("../src/content-types");
const { getDesign } = require("../src/designs");
const { extractWebEvidence, normalizeSources, sourceChecks, normalizeQuality, structureChecks, publicationGate, QUALITY_CRITERIA } = require("../src/quality");
const { selectPhoto } = require("../src/photo");
const { normalizeDomain, iconLinks, logoDomains } = require("../src/logo");
const { graphUrl, graphPost, verifyInstagramConnection } = require("../src/instagram");
const accounts = require("../config/accounts.json");

test("Japanese wrapping preserves the text", () => {
  const input = "夏インターンの探し方を整理する";
  assert.equal(wrapJapanese(input, 6).join(""), input);
  assert.ok(wrapJapanese(input, 6).length > 1);
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
  assert.deepEqual(comparisonRowsFor("industry_report"), ["市場成長性", "主要企業", "直近3カ月の変化", "専門性"]);
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
  const checks = sourceChecks(sources.concat({ ...sources[0], url: "https://example.com/report-2" }), new Date("2026-08-30T00:00:00Z"));
  assert.equal(checks.freshness.pass, true);
  assert.equal(checks.references.pass, true);
});

test("quality output always contains the seven requested criteria", () => {
  const raw = { checks: QUALITY_CRITERIA.map((criterion) => ({ criterion, score: 4, reason: "具体的", suggestion: "維持" })) };
  const quality = normalizeQuality(raw, [], new Date("2026-08-30T00:00:00Z"));
  assert.equal(quality.checks.length, 7);
  assert.equal(quality.checks[1].pass, false);
  assert.equal(quality.checks[2].pass, false);
});

test("publication gate requires 85 points and every criterion at least four", () => {
  const readyQuality = { overallScore: 86, checks: QUALITY_CRITERIA.map((criterion) => ({ criterion, score: 4, pass: true })) };
  assert.equal(publicationGate(readyQuality).ready, true);
  readyQuality.checks[0].score = 3;
  readyQuality.checks[0].pass = false;
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
