const test = require("node:test");
const assert = require("node:assert/strict");
const { wrapJapanese, escapeXml } = require("../src/renderer");
const { demoContent, validateContent, extractOutputText, buildOpenAIRequest } = require("../src/generator");
const { contentTypes } = require("../src/content-types");
const { extractWebEvidence, normalizeSources, sourceChecks, normalizeQuality, QUALITY_CRITERIA } = require("../src/quality");
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

test("demo carousel has six body slides", () => {
  const content = demoContent({ topic: "面接準備", targetYear: "28卒", account: accounts[0] });
  assert.equal(content.slides.length, 6);
  assert.ok(content.hashtags.every((tag) => tag.startsWith("#")));
});

test("content validation rejects an invalid slide count", () => {
  const content = demoContent({ topic: "面接準備", targetYear: "28卒", account: accounts[0] });
  content.slides.pop();
  assert.throws(() => validateContent(content), /6枚/);
});

test("content validation normalizes hashtags without hash marks", () => {
  const content = demoContent({ topic: "面接準備", targetYear: "28卒", account: accounts[0] });
  content.hashtags = ["就活", "＃28卒", "# 面接 対策", "就活"];
  assert.deepEqual(validateContent(content).hashtags, ["#就活", "#28卒", "#面接対策"]);
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
