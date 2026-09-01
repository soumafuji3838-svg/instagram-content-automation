const { getContentType } = require("./content-types");
const { QUALITY_CRITERIA, cutoffDate, extractWebEvidence, normalizeSources, normalizeQuality } = require("./quality");

const contentSchema = {
  type: "object",
  properties: {
    title: { type: "string", description: "Internal title for the carousel" },
    hook: { type: "string", description: "Short cover headline in Japanese" },
    slides: {
      type: "array",
      items: {
        type: "object",
        properties: {
          eyebrow: { type: "string", description: "Short section label" },
          title: { type: "string", description: "Slide title in Japanese" },
          body: { type: "string", description: "Concise body copy in Japanese" }
        },
        required: ["eyebrow", "title", "body"],
        additionalProperties: false
      }
    },
    caption: { type: "string", description: "Instagram caption without hashtags or source list" },
    hashtags: { type: "array", items: { type: "string" } }
  },
  required: ["title", "hook", "slides", "caption", "hashtags"],
  additionalProperties: false
};

const sourceSchema = {
  type: "object",
  properties: {
    title: { type: "string" },
    publisher: { type: "string" },
    url: { type: "string" },
    publishedAt: { type: "string", description: "Publication date in YYYY-MM-DD, or empty when unavailable" },
    supportedClaim: { type: "string", description: "The claim in the post supported by this source" }
  },
  required: ["title", "publisher", "url", "publishedAt", "supportedClaim"],
  additionalProperties: false
};

const researchSchema = {
  type: "object",
  properties: { content: contentSchema, sources: { type: "array", items: sourceSchema } },
  required: ["content", "sources"],
  additionalProperties: false
};

const qualitySchema = {
  type: "object",
  properties: {
    checks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          criterion: { type: "string" },
          score: { type: "integer", description: "0 to 5" },
          reason: { type: "string" },
          suggestion: { type: "string" }
        },
        required: ["criterion", "score", "reason", "suggestion"],
        additionalProperties: false
      }
    }
  },
  required: ["checks"],
  additionalProperties: false
};

function demoContent({ topic, targetYear, account, contentType }) {
  const audience = targetYear || account.target;
  const type = getContentType(contentType);
  return {
    title: `${type.label}｜${topic}`,
    hook: `${topic}\n2分でポイント整理`,
    slides: [
      { eyebrow: "01｜概要", title: "まず全体像を確認", body: "対象の定義と、就活で押さえる範囲を最初に整理します。" },
      { eyebrow: "02｜構造", title: "誰に何を提供する？", body: "顧客・提供価値・収益が生まれる流れを分けて確認します。" },
      { eyebrow: "03｜比較", title: "違いは軸で比べる", body: "事業、顧客、強みなど同じ軸にそろえると違いが見えます。" },
      { eyebrow: "04｜変化", title: "直近の変化を調べる", body: "ニュースや公式発表から、最近変わった点と背景を確認します。" },
      { eyebrow: "05｜注意", title: "断定せず根拠を見る", body: "数字や評価は参照元と日付を確認し、事実と解釈を分けます。" },
      { eyebrow: "NEXT", title: account.cta, body: "参照元を開き、自分の志望理由に使える情報を1つメモしましょう。" }
    ],
    caption: `${audience}向けに「${topic}」を${type.label}として整理しました。\n\nデモ生成のため、実際に使う前に最新情報と参照元を確認してください。`,
    hashtags: [`#${String(audience).replace(/[・\s]/g, "")}`, "#就活", "#業界研究", "#企業研究"]
  };
}

function extractOutputText(response) {
  if (response?.status === "failed") throw new Error(`OpenAIの生成に失敗しました: ${response.error?.message || "時間をおいて再実行してください。"}`);
  if (response?.status === "incomplete") {
    const reason = response.incomplete_details?.reason || "unknown";
    if (reason === "max_output_tokens") throw new Error("OpenAIの生成が出力上限に達しました。.envのOPENAI_MAX_OUTPUT_TOKENSを増やして再実行してください。");
    throw new Error(`OpenAIの生成が完了しませんでした（理由: ${reason}）。再実行してください。`);
  }
  if (typeof response?.output_text === "string" && response.output_text.trim()) return response.output_text;
  const textParts = [];
  for (const item of response?.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && typeof content.text === "string") textParts.push(content.text);
      if (content.type === "refusal") throw new Error(`OpenAIが生成を拒否しました: ${content.refusal || "内容を変更してください。"}`);
    }
  }
  if (textParts.length) return textParts.join("");
  const itemTypes = (response?.output || []).map((item) => item.type).filter(Boolean).join(", ") || "なし";
  throw new Error(`OpenAIから原稿本文が返りませんでした（status: ${response?.status || "不明"} / output: ${itemTypes}）。もう一度生成してください。`);
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function buildOpenAIRequest(input, referenceDate = new Date()) {
  const type = getContentType(input.contentType);
  const today = new Date(referenceDate);
  const cutoff = cutoffDate(today);
  return {
    model: process.env.OPENAI_RESEARCH_MODEL || "gpt-5.6",
    reasoning: { effort: process.env.OPENAI_REASONING_EFFORT || "low" },
    max_output_tokens: positiveInteger(process.env.OPENAI_MAX_OUTPUT_TOKENS, 25000),
    max_tool_calls: positiveInteger(process.env.OPENAI_MAX_WEB_SEARCH_CALLS, 8),
    tools: [{ type: "web_search", search_context_size: "high", external_web_access: true }],
    tool_choice: "required",
    include: ["web_search_call.action.sources"],
    instructions: [
      "You are a research editor for a Japanese Instagram account supporting university students' job hunting.",
      "You must use web search before writing. Prefer primary sources such as company IR/newsrooms, government publications, and official industry bodies.",
      `Use sources published from ${cutoff.toISOString().slice(0, 10)} through ${today.toISOString().slice(0, 10)}. If a publication date cannot be confirmed, use an empty publishedAt and do not invent a date.`,
      "Provide at least 3 distinct sources. Every numerical, comparative, trend, or company claim must be traceable to a listed source.",
      "Separate facts from interpretation. Do not invent rankings, salaries, deadlines, market sizes, or corporate claims.",
      "Write natural Japanese for 28・29卒 students. Avoid abstract advice and include a concrete action on the final slide.",
      "Create exactly 6 body slides; the renderer adds the cover separately.",
      "Keep each slide title under 22 Japanese characters and each body under 80 Japanese characters.",
      "Make every headline understandable without reading the body. Avoid repeating the same fact across slides.",
      "Hashtags must begin with #."
    ].join("\n"),
    input: JSON.stringify({
      currentDate: today.toISOString().slice(0, 10),
      freshnessCutoff: cutoff.toISOString().slice(0, 10),
      contentType: type.label,
      requiredStructure: type.structure,
      topic: input.topic,
      targetYear: input.targetYear,
      accountName: input.account.name,
      persona: input.account.persona,
      tone: input.account.tone,
      callToAction: input.account.cta,
      notes: input.notes || ""
    }),
    text: { format: { type: "json_schema", name: "researched_instagram_carousel", strict: true, schema: researchSchema } }
  };
}

function buildQualityRequest({ content, sources, topic, contentType, targetYear }, referenceDate = new Date()) {
  return {
    model: process.env.OPENAI_MODEL || "gpt-5.6",
    reasoning: { effort: process.env.OPENAI_REASONING_EFFORT || "low" },
    max_output_tokens: 10000,
    instructions: [
      "You are a strict Japanese social media editor. Evaluate the draft, do not rewrite it.",
      "Return all seven criteria exactly as provided, each scored from 0 to 5.",
      "A score of 4 or 5 means it is ready for publication. Give specific reasons and actionable suggestions.",
      "Freshness and URL existence will also be checked programmatically, so focus on editorial judgment without assuming missing evidence."
    ].join("\n"),
    input: JSON.stringify({
      currentDate: new Date(referenceDate).toISOString().slice(0, 10),
      topic,
      contentType: getContentType(contentType).label,
      targetYear,
      criteria: QUALITY_CRITERIA,
      content,
      sources
    }),
    text: { format: { type: "json_schema", name: "instagram_quality_review", strict: true, schema: qualitySchema } }
  };
}

function validateContent(content) {
  if (!content || typeof content !== "object") throw new Error("原稿データが正しくありません。");
  for (const key of ["title", "hook", "caption"]) if (typeof content[key] !== "string" || !content[key].trim()) throw new Error(`${key}を入力してください。`);
  if (!Array.isArray(content.slides) || content.slides.length !== 6) throw new Error("本文スライドは6枚必要です。");
  content.slides.forEach((slide, index) => {
    for (const key of ["eyebrow", "title", "body"]) if (typeof slide?.[key] !== "string" || !slide[key].trim()) throw new Error(`スライド${index + 1}の${key}を入力してください。`);
  });
  if (!Array.isArray(content.hashtags) || !content.hashtags.length || content.hashtags.some((tag) => typeof tag !== "string" || !tag.trim())) throw new Error("ハッシュタグを1つ以上入力してください。");
  const hashtags = content.hashtags.map((tag) => tag.trim().replace(/^[#＃]+/, "").replace(/\s+/g, "")).filter(Boolean).map((tag) => `#${tag}`);
  if (!hashtags.length) throw new Error("ハッシュタグを1つ以上入力してください。");
  return {
    title: content.title.trim(),
    hook: content.hook.trim(),
    slides: content.slides.map((slide) => ({ eyebrow: slide.eyebrow.trim(), title: slide.title.trim(), body: slide.body.trim() })),
    caption: content.caption.trim(),
    hashtags: [...new Set(hashtags)]
  };
}

async function callOpenAI(request) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify(request)
  });
  const responseText = await response.text();
  let responseBody;
  try { responseBody = JSON.parse(responseText); }
  catch { throw new Error(`OpenAI API ${response.status}: JSONではない応答が返りました。`); }
  if (!response.ok) throw new Error(`OpenAI API ${response.status}: ${responseBody.error?.message || "リクエストに失敗しました。"}`);
  return responseBody;
}

async function evaluateContentQuality(input, referenceDate = new Date()) {
  if (!process.env.OPENAI_API_KEY) return normalizeQuality({ checks: [] }, input.sources || [], referenceDate);
  const response = await callOpenAI(buildQualityRequest(input, referenceDate));
  return normalizeQuality(JSON.parse(extractOutputText(response)), input.sources || [], referenceDate);
}

async function generateWithOpenAI(input, referenceDate = new Date()) {
  const response = await callOpenAI(buildOpenAIRequest(input, referenceDate));
  const raw = JSON.parse(extractOutputText(response));
  const content = validateContent(raw.content);
  const sources = normalizeSources(raw.sources, extractWebEvidence(response));
  const quality = await evaluateContentQuality({ content, sources, topic: input.topic, contentType: input.contentType, targetYear: input.targetYear }, referenceDate);
  return { content, sources, quality };
}

async function generateCarousel(input, referenceDate = new Date()) {
  if (!process.env.OPENAI_API_KEY) {
    const content = validateContent(demoContent(input));
    return { content, sources: [], quality: normalizeQuality({ checks: [] }, [], referenceDate), source: "demo" };
  }
  return { ...(await generateWithOpenAI(input, referenceDate)), source: "openai-web" };
}

module.exports = {
  generateCarousel,
  evaluateContentQuality,
  contentSchema,
  researchSchema,
  qualitySchema,
  demoContent,
  validateContent,
  extractOutputText,
  buildOpenAIRequest,
  buildQualityRequest
};
