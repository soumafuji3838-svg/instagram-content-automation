const { getContentType } = require("./content-types");
const { lengthIssues, repairTextLengths } = require("./text-length");
const { improveQuality } = require("./quality-repair");
const { QUALITY_CRITERIA, OVERALL_PASS_SCORE, cutoffDate, extractWebEvidence, normalizeSources, normalizeQuality, structureChecks } = require("./quality");

const FORBIDDEN_BRAND_PATTERN = /就活ねこ|就活ガイド|（デモ）|\(デモ\)/;

function resolveCta(account, contentType) {
  return account.ctaByContentType?.[contentType]
    || account.cta
    || "保存して、業界研究の参考にしてね！";
}

function comparisonRowsFor(contentType) {
  if (contentType === "industry_report") {
    return ["直近業績", "主な事業領域", "直近3カ月の変化", "就活での確認点"];
  }
  return /company/.test(contentType)
    ? ["主要事業", "収益構造", "直近3カ月の変化", "就活での確認点"]
    : ["市場成長性", "主要企業", "直近3カ月の変化", "専門性"];
}

function applyAccountRules(content, account, contentType) {
  const cta = resolveCta(account, contentType);
  const captionWithoutOldCta = content.caption
    .split("\n")
    .filter((line) => !/^保存して[、,]/.test(line.trim()))
    .join("\n")
    .replace(/就活ねこ|就活ガイド|（デモ）|\(デモ\)/g, "")
    .trim();
  const baseHashtags = Array.isArray(account.hashtags) ? account.hashtags : [];
  const hashtags = [...baseHashtags, ...content.hashtags]
    .filter((tag) => !FORBIDDEN_BRAND_PATTERN.test(tag))
    .map((tag) => tag.trim().replace(/^[#＃]+/, "").replace(/\s+/g, ""))
    .filter(Boolean)
    .map((tag) => `#${tag}`);
  return {
    ...content,
    cta: { ...content.cta, title: cta },
    caption: `${captionWithoutOldCta}\n\n${cta}`.trim(),
    hashtags: [...new Set(hashtags)]
  };
}

const contentSchema = {
  type: "object",
  properties: {
    postType: { type: "string", enum: ["industry_report", "company_report", "industry_comparison", "company_comparison", "trend_report"] },
    title: { type: "string", description: "Cover H1 in Japanese" },
    subtitle: { type: "string", description: "Cover H2 in Japanese; one concrete question or takeaway" },
    imageQuery: { type: "string", description: "Pexels search query in English for the industry and realistic working professional; no company logos" },
    subject: {
      type: "object",
      properties: {
        name: { type: "string" },
        entityType: { type: "string", enum: ["company", "industry", "topic"] },
        domain: { type: "string", description: "Official company domain without protocol for a single-company report; otherwise empty" }
      },
      required: ["name", "entityType", "domain"],
      additionalProperties: false
    },
    quantitative: {
      type: "object",
      properties: {
        chartTitle: { type: "string" },
        chartUnit: { type: "string" },
        metrics: {
          type: "array",
          minItems: 3,
          maxItems: 5,
          items: {
            type: "object",
            properties: {
              label: { type: "string" },
              entityType: { type: "string", enum: ["company", "other"] },
              companyDomain: { type: "string", description: "Official company domain without protocol when this metric represents a company; otherwise empty" },
              value: { type: "number", description: "Relative bar length from 0 to 100; preserve actual number in displayValue" },
              displayValue: { type: "string" },
              sourceIds: { type: "array", items: { type: "string" } }
            },
            required: ["label", "entityType", "companyDomain", "value", "displayValue", "sourceIds"],
            additionalProperties: false
          }
        },
        summaryTitle: { type: "string", description: "Japanese heading, at most 10 characters" },
        summaryText: { type: "string", description: "Japanese explanation, 90 to 110 characters" },
        insightAxis: { type: "string", enum: ["働き方", "挑戦機会", "社員還元", "将来のキャリア"] },
        studentInsight: { type: "string", description: "A cautious job-seeker implication based only on cited facts, 45 to 70 Japanese characters" },
        sourceIds: { type: "array", items: { type: "string" } }
      },
      required: ["chartTitle", "chartUnit", "metrics", "summaryTitle", "summaryText", "insightAxis", "studentInsight", "sourceIds"],
      additionalProperties: false
    },
    qualitative: {
      type: "object",
      properties: {
        positiveLabel: { type: "string", description: "強み or メリット" },
        positiveTitle: { type: "string", description: "Japanese heading, at most 10 characters" },
        positiveText: { type: "string", description: "Japanese explanation, 45 to 60 characters" },
        negativeLabel: { type: "string", description: "弱み or リスク" },
        negativeTitle: { type: "string", description: "Japanese heading, at most 10 characters" },
        negativeText: { type: "string", description: "Japanese explanation, 45 to 60 characters" },
        outlookTitle: { type: "string", description: "Japanese heading, at most 10 characters" },
        outlookText: { type: "string", description: "Japanese explanation, 80 to 100 characters" },
        insightAxis: { type: "string", enum: ["働き方", "挑戦機会", "社員還元", "将来のキャリア"] },
        studentInsight: { type: "string", description: "A cautious job-seeker implication based only on cited facts, 45 to 70 Japanese characters" },
        sourceIds: { type: "array", items: { type: "string" } }
      },
      required: ["positiveLabel", "positiveTitle", "positiveText", "negativeLabel", "negativeTitle", "negativeText", "outlookTitle", "outlookText", "insightAxis", "studentInsight", "sourceIds"],
      additionalProperties: false
    },
    comparison: {
      type: "object",
      properties: {
        columns: {
          type: "array",
          minItems: 3,
          maxItems: 5,
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              entityType: { type: "string", enum: ["company", "industry"] },
              domain: { type: "string", description: "Official company domain without protocol for company; empty for industry" }
            },
            required: ["name", "entityType", "domain"],
            additionalProperties: false
          }
        },
        rows: {
          type: "array",
          minItems: 4,
          maxItems: 4,
          items: {
            type: "object",
            properties: {
              label: { type: "string" },
              values: { type: "array", minItems: 3, maxItems: 5, items: { type: "string" } },
              sourceIds: { type: "array", items: { type: "string" } }
            },
            required: ["label", "values", "sourceIds"],
            additionalProperties: false
          }
        }
      },
      required: ["columns", "rows"],
      additionalProperties: false
    },
    cta: {
      type: "object",
      properties: {
        title: { type: "string" },
        body: { type: "string" }
      },
      required: ["title", "body"],
      additionalProperties: false
    },
    caption: { type: "string", description: "Instagram caption without hashtags or source list" },
    hashtags: { type: "array", items: { type: "string" } }
  },
  required: ["postType", "title", "subtitle", "imageQuery", "subject", "quantitative", "qualitative", "comparison", "cta", "caption", "hashtags"],
  additionalProperties: false
};

const sourceSchema = {
  type: "object",
  properties: {
    id: { type: "string", description: "Stable source id such as S1" },
    title: { type: "string" },
    publisher: { type: "string" },
    url: { type: "string" },
    publishedAt: { type: "string", description: "Publication date in YYYY-MM-DD, or empty when unavailable" },
    supportedClaim: { type: "string", description: "The claim in the post supported by this source" },
    sourceType: { type: "string", enum: ["recent_fact", "japan_employment"] },
    japanEmploymentCompanies: { type: "array", items: { type: "string" }, description: "Company names for which this official source proves recruitment or employment in Japan" }
  },
  required: ["id", "title", "publisher", "url", "publishedAt", "supportedClaim", "sourceType", "japanEmploymentCompanies"],
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

function repairFeedback(content, sources, quality) {
  const editableChecks = (quality?.checks || [])
    .filter((check) => ![QUALITY_CRITERIA[1], QUALITY_CRITERIA[2]].includes(check.criterion));
  const failedChecks = editableChecks.filter((check) => check.score < 3 || check.pass === false);
  const targets = failedChecks.length
    ? failedChecks
    : quality?.overallScore < OVERALL_PASS_SCORE
      ? editableChecks.filter((check) => check.score < 4)
      : [];
  const editorial = targets
    .map((check) => `${check.criterion}: ${check.suggestion || check.reason || "改善してください。"}`);
  return [...new Set([...structureChecks(content, sources), ...editorial])];
}

function buildRepairRequest({ content, sources, topic, contentType, targetYear, feedback }) {
  return {
    model: process.env.OPENAI_MODEL || "gpt-5.6",
    reasoning: { effort: process.env.OPENAI_REASONING_EFFORT || "low" },
    max_output_tokens: 16000,
    instructions: [
      "You are a meticulous Japanese editor repairing an Instagram carousel that failed a publication gate.",
      "Return the complete corrected content object only. Do not perform new research.",
      "Preserve every supported factual claim, number, company, and sourceIds value unless removing an unsupported or duplicated claim.",
      "The comparison row labels are fixed. Rewrite each comparison value so it directly answers its row label using only already supplied cited facts. You may move an existing cited fact to the matching row or derive a cautious interpretation labeled 推測 from the supplied evidence. Never substitute an unrelated fact.",
      "Never invent unsupported facts, numbers, dates, news, policies, source IDs or URLs. Evidence-based qualitative inference is allowed only when visibly labeled 推測 and traceable to sourceIds.",
      "Keep facts separate from job-seeker interpretation. Phrase interpretation cautiously and turn it into a concrete recruiting-material or interview question.",
      "Meet every Japanese character limit exactly. Count each Unicode character, including punctuation, as one character.",
      "Prioritize every failed check over optional stylistic polishing. Silently verify each failed check again before returning the final object.",
      "Every summary heading must be understandable without its body: include a concrete subject plus its action, cause, or effect within 10 Japanese characters. Generic fragments such as 出資・経営で収益, 外部変動リスク, or 非資源へ投資 are forbidden. Use only wording directly supported by the supplied sources.",
      "Remove repeated ideas across pages and avoid exaggerated or unsupported certainty. Never generalize one company's fact to the whole industry or all three companies. If a fact is supported for only one company, name that company explicitly. A shared trend may be stated only when the supplied sources support it separately for every company concerned.",
      "For company logo fields, use only an official hostname supported by the supplied verified sources. Do not invent a domain.",
      "Keep three to five quantitative metrics, three to five comparison columns, four comparison rows, and the existing five-page structure.",
      "Keep the supplied CTA and base brand hashtags.",
      `The selected post type is ${getContentType(contentType).id} (${getContentType(contentType).label}). Preserve content.postType exactly and never describe it as another post type.`,
      "Keep every named employer limited to companies with a credible attributable source proving a Japanese legal entity, a Japan office with official careers information, or jobs based in Japan. Preserve the japan_employment source and company mapping."
    ].join("\n"),
    input: JSON.stringify({
      topic,
      contentType: getContentType(contentType).label,
      targetYear,
      fixedComparisonRows: comparisonRowsFor(contentType),
      failedChecks: feedback,
      content,
      sources
    }),
    text: { format: { type: "json_schema", name: "repaired_instagram_carousel", strict: true, schema: contentSchema } }
  };
}

function demoContent({ topic, targetYear, account, contentType }) {
  const audience = targetYear || account.target;
  const type = getContentType(contentType);
  const cta = resolveCta(account, type.id);
  return {
    postType: type.id,
    title: topic,
    subtitle: "数字と最新動向から、業界の現在地を読み解く",
    imageQuery: "Japanese business professional working in modern industry",
    subject: { name: topic, entityType: type.subjectEntityType, domain: "" },
    quantitative: {
      chartTitle: "主要3社の比較イメージ",
      chartUnit: "相対値",
      metrics: [
        { label: "企業A", entityType: "company", companyDomain: "", value: 100, displayValue: "100", sourceIds: [] },
        { label: "企業B", entityType: "company", companyDomain: "", value: 82, displayValue: "82", sourceIds: [] },
        { label: "企業C", entityType: "company", companyDomain: "", value: 68, displayValue: "68", sourceIds: [] }
      ],
      summaryTitle: "数字の読み方",
      summaryText: "デモでは相対値を表示しています。本番生成では、直近3カ月以内の企業IRや公的資料から、同じ基準で比較できる数値だけを抽出して表示します。",
      insightAxis: "挑戦機会",
      studentInsight: "投資が増える領域では、新規事業や部門横断プロジェクトへの配属機会を確認すると企業選びに役立ちます。",
      sourceIds: []
    },
    qualitative: {
      positiveLabel: /company/.test(type.id) ? "強み" : "メリット",
      positiveTitle: "成長機会",
      positiveText: "新しい需要や投資の流れを捉える企業には、中長期で事業を伸ばせる余地があります。",
      negativeLabel: /company/.test(type.id) ? "弱み" : "リスク",
      negativeTitle: "変動要因",
      negativeText: "市況や為替、規制変更の影響を受けるため、数字だけでなく前提条件の確認が必要です。",
      outlookTitle: "将来の見通し",
      outlookText: "今後は成長投資の規模だけでなく、既存事業との相乗効果や収益化までの期間を確認することが重要です。各社の中期経営計画と決算説明資料を並べて比較しましょう。",
      insightAxis: "将来のキャリア",
      studentInsight: "若手の配属先や異動制度を確認し、伸びる事業でどの専門性を築けるかまで考えてみましょう。",
      sourceIds: []
    },
    comparison: {
      columns: ["A", "B", "C"].map((suffix) => ({ name: `${type.comparisonEntityType === "company" ? "企業" : "業界"}${suffix}`, entityType: type.comparisonEntityType, domain: "" })),
      rows: comparisonRowsFor(type.id).map((label, index) => ({ label, values: [`比較${index + 1}A`, `比較${index + 1}B`, `比較${index + 1}C`], sourceIds: [] }))
    },
    cta: { title: cta, body: "気になる企業のIR資料を開き、数字と戦略を自分の言葉で比較してみよう。" },
    caption: `${audience}向けに「${topic}」を${type.label}として整理しました。\n\nデモ生成のため、実際に使う前に最新情報と参照元を確認してください。\n\n${cta}`,
    hashtags: account.hashtags || [`#${String(audience).replace(/[・\s]/g, "")}`, "#就活", "#業界研究", "#企業研究"]
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
  const companyMode = /company/.test(type.id);
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
      "You must use web search before writing. Search across publicly accessible websites without a domain allowlist, including company sites, news, industry media and recruiting platforms. Assess authorship, dates, methodology and independence; cross-check material claims. Do not treat anonymous reviews as representative workforce facts.",
      "Copy every source URL character-for-character from a URL actually returned by web search. Never translate a language path, change a filename, infer a sibling PDF, or construct a likely URL. If the exact URL was not returned by the search tool, do not list it as a source.",
      `Use sources published from ${cutoff.toISOString().slice(0, 10)} through ${today.toISOString().slice(0, 10)}. If a publication date cannot be confirmed, use an empty publishedAt and do not invent a date.`,
      "Provide at least 3 distinct sources. Every numerical, comparative, trend, or company claim must be traceable to a listed source.",
      "Separate facts from interpretation. Do not invent rankings, salaries, deadlines, market sizes, or corporate claims.",
      "Evidence-based qualitative inference is allowed in summaries and comparison cells. Prefix every inferred statement with 推測 and attach sourceIds for its premises. Never present an inference as fact or fabricate inputs; numerical estimates require a visible 推定 marker and a cited reproducible method.",
      "For each studentInsight, choose one axis from 働き方, 挑戦機会, 社員還元, 将来のキャリア. Explain what the verified fact means the student should examine in recruiting materials or interviews.",
      "Phrase interpretations cautiously, such as 確認したい, 可能性がある, or 判断材料になる. Do not state an interpretation as an established fact.",
      "Write natural Japanese for 28・29卒 students. Avoid abstract advice and include a concrete action on the final slide.",
      "Create exactly five pages using the supplied JSON fields: cover, quantitative IR summary, qualitative IR summary, comparison table, and action page.",
      `The selected post type is ${type.id} (${type.label}). Set content.postType to exactly ${type.id}. Never call it another report type in the title, subtitle, caption, headings, or body.`,
      `Follow this post-type purpose exactly: ${type.structure}`,
      "For company_comparison, quantitative.metrics and comparison.columns must list the same 3–5 employers in the same order with identical names and domains. Respect a requested count of 3, 4 or 5 in the topic or notes.",
      "Search escalation order: company website, IR/securities reports, official recruiting, government statistics, reliable news, industry media, job platforms, then corroborated other public sources. Do not stop after the first unavailable source.",
      "Numerical estimates are allowed only with cited input values, explicit calculation or methodology in supportedClaim, and a visible 推定 marker in displayValue or the comparison cell. Never invent an input. Unavailable wording is a last resort after broadened search and consideration of estimation; leave truthful uncertainty if no defensible inference exists.",
      "Type rules: industry_report analyzes one industry and may compare employers; company_report analyzes one specified company and its competitors; industry_comparison compares industries; company_comparison compares employers; trend_report analyzes one trend and affected fields. Do not silently switch types based on the topic.",
      `Set subject.entityType to ${type.subjectEntityType}.`,
      "Limit every named company to an employer that Japanese job seekers can realistically apply to. For each company, verify through a credible, attributable source at least one of: a Japanese legal entity, a Japan office with official careers information, or an official job listing based in Japan.",
      "A global website or Japanese-language product page alone does not prove Japan employment. A reputable job board listing the named employer and a Japan work location may support eligibility. Exclude employers with no Japan employment evidence; do not infer eligibility from nationality.",
      "For each credible Japan employment source, set sourceType to japan_employment and list the exact corresponding company names in japanEmploymentCompanies. Such a source may have an empty publishedAt. For time-sensitive factual sources use recent_fact and an empty japanEmploymentCompanies array.",
      "Set subject.entityType to company only for a single-company report and provide the company's official hostname in subject.domain. Otherwise use industry or topic with an empty domain.",
      "For a single-company report, do not repeat the company name in the visible cover title; the logo identifies the company, while title states the concrete research angle.",
      "Use source ids S1, S2, ... consistently in every sourceIds field. Every number and table row must cite at least one listed source id.",
      "For quantitative.metrics, use three to five values measured on one comparable basis. Set value to a 0-100 relative bar length and preserve the factual value and unit in displayValue.",
      "For each quantitative metric, set entityType to company only when the label is a company. Then set companyDomain to that company's official website hostname. Otherwise use other and an empty domain.",
      "Write quantitative.summaryTitle in at most 10 Japanese characters and summaryText in 90-110 Japanese characters.",
      "Write quantitative.studentInsight in 45-70 Japanese characters and base it only on the cited quantitative facts.",
      "Write qualitative positive/negative titles in at most 10 Japanese characters, each explanation in 45-60 Japanese characters, and outlookText in 80-100 Japanese characters.",
      "Write qualitative.studentInsight in 45-70 Japanese characters and connect the outlook to a concrete career-research question.",
      "Search the web for three commonly compared industries or companies. Use the four comparison row labels exactly as supplied and keep each table cell concise.",
      "Every comparison cell must directly answer its fixed row label. Never place profit figures under 市場成長性 or business segments under 主要企業. If evidence is insufficient, broaden research to news, industry publications and recruiting sites. A qualitative inference must be labeled 推測 and supported by cited premises.",
      "For each comparison column, set entityType to company or industry. For a company, provide its official website hostname in domain; for an industry, use an empty domain.",
      `For this post type every comparison column must use entityType ${type.comparisonEntityType}.`,
      "Never fill a cell with 非開示 or 確認できず. Do not invent salary or offer odds; use the supplied researchable comparison axes and evidence-based qualitative interpretations.",
      "Write imageQuery in English for neutral empty workspaces, architecture or equipment relevant to the industry. No people, faces, logos, aggression, stereotypes, staged meetings or implied actual company workplaces.",
      "Research every comparison company separately across publicly accessible official sites, news, industry publications, recruiting sites and other relevant web sources before filling all 12 cells. Keep equivalent periods and definitions. Do not use 確認できず as a completed comparison. If evidence is unavailable, keep the uncertainty truthful; it will block approval and trigger a bounded re-search. Never invent missing facts.",
      "Make every heading understandable without its body by including a concrete subject plus its action, cause, or effect within 10 Japanese characters. Avoid generic fragments such as 出資・経営で収益, 外部変動リスク, or 非資源へ投資.",
      "Never generalize one company's fact to the whole industry or all three companies. If evidence covers only one company, name it explicitly. State a shared trend only when separate supplied sources support it for every company concerned.",
      "Hashtags must begin with #.",
      "Never mention or hashtag 就活ねこ, 就活ガイド, or デモ.",
      "Use the supplied brand hashtags as the base hashtags and end the caption with the exact supplied call to action."
    ].join("\n"),
    input: JSON.stringify({
      currentDate: today.toISOString().slice(0, 10),
      freshnessCutoff: cutoff.toISOString().slice(0, 10),
      contentType: type.label,
      contentTypeId: type.id,
      requiredStructure: type.structure,
      pageStructure: ["cover", "quantitative", "qualitative", "comparison", "cta"],
      qualitativeLabels: companyMode ? ["強み", "弱み"] : ["メリット", "リスク"],
      comparisonRows: comparisonRowsFor(type.id),
      topic: input.topic,
      targetYear: input.targetYear,
      accountName: input.account.name,
      persona: input.account.persona,
      tone: input.account.tone,
      callToAction: resolveCta(input.account, type.id),
      brandHashtags: input.account.hashtags || [],
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
      "For editorial criteria, a score of 3 is acceptable for publication and 4 or 5 is strong. Scores 0 to 2 indicate a publication-blocking problem. Give specific reasons and actionable suggestions.",
      "For 抽象論 and 保存したくなる実用性, require a clear connection from verified IR facts to at least one of: working style, challenge opportunities, employee returns, or future career.",
      "Check that studentInsight is a cautious interpretation and introduces no uncited number, news item, policy, or unsupported certainty.",
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

function validateContent(content, contentType = "industry_report") {
  if (!content || typeof content !== "object") throw new Error("原稿データが正しくありません。");
  const requiredString = (object, key, label = key) => {
    if (typeof object?.[key] !== "string" || !object[key].trim()) throw new Error(`${label}を入力してください。`);
    return object[key].trim();
  };
  const title = requiredString(content, "title", "表紙H1");
  const expectedType = getContentType(contentType);
  const postType = String(content.postType || expectedType.id);
  if (postType !== expectedType.id) throw new Error(`投稿タイプが一致しません（選択: ${expectedType.id} / 生成: ${postType}）。`);
  const subtitle = requiredString(content, "subtitle", "表紙H2");
  const imageQuery = requiredString(content, "imageQuery", "写真検索キーワード");
  const subjectRaw = content.subject || { name: title, entityType: contentType === "company_report" ? "company" : "industry", domain: "" };
  const caption = requiredString(content, "caption", "キャプション");
  const quantitative = content.quantitative;
  if (!quantitative || !Array.isArray(quantitative.metrics) || (quantitative.metrics.length < 3 || quantitative.metrics.length > 5)) throw new Error("定量グラフの数値は3〜5件必要です。");
  const normalizeDomain = (value) => String(value || "").trim().replace(/^https?:\/\//i, "").split(/[/?#]/)[0].toLowerCase();
  const insightAxes = new Set(["働き方", "挑戦機会", "社員還元", "将来のキャリア"]);
  const normalizeAxis = (value) => insightAxes.has(value) ? value : "将来のキャリア";
  const metrics = quantitative.metrics.map((metric, index) => ({
    label: requiredString(metric, "label", `定量データ${index + 1}のラベル`),
    entityType: metric.entityType === "company" ? "company" : "other",
    companyDomain: metric.entityType === "company" ? normalizeDomain(metric.companyDomain) : "",
    value: Math.max(0, Math.min(100, Number(metric.value) || 0)),
    displayValue: requiredString(metric, "displayValue", `定量データ${index + 1}の表示値`),
    sourceIds: Array.isArray(metric.sourceIds) ? [...new Set(metric.sourceIds.map(String))] : []
  }));
  const qualitative = content.qualitative;
  if (!qualitative) throw new Error("定性要約を入力してください。");
  const comparison = content.comparison;
  if (!comparison || !Array.isArray(comparison.columns) || (comparison.columns.length < 3 || comparison.columns.length > 5)) throw new Error("比較対象は3〜5件必要です。");
  if (!Array.isArray(comparison.rows) || comparison.rows.length !== 4) throw new Error("比較軸は4件必要です。");
  const expectedRows = comparisonRowsFor(contentType);
  const companyMode = /company/.test(contentType);
  const columns = comparison.columns.map((column, index) => {
    const value = typeof column === "string" ? { name: column, entityType: companyMode ? "company" : "industry", domain: "" } : column;
    return {
      name: requiredString(value, "name", `比較対象${index + 1}`),
      entityType: value.entityType === "company" ? "company" : "industry",
      domain: value.entityType === "company" ? normalizeDomain(value.domain) : ""
    };
  });
  const subjectEntityType = ["company", "industry", "topic"].includes(subjectRaw.entityType) ? subjectRaw.entityType : "topic";
  if (subjectEntityType !== expectedType.subjectEntityType) throw new Error(`投稿タイプに対する調査対象が一致しません（必要: ${expectedType.subjectEntityType}）。`);
  if (columns.some((column) => column.entityType !== expectedType.comparisonEntityType)) throw new Error(`投稿タイプに対する比較対象が一致しません（必要: ${expectedType.comparisonEntityType}）。`);
  const rows = comparison.rows.map((row, index) => {
    if (!Array.isArray(row.values) || row.values.length !== columns.length) throw new Error(`比較表${index + 1}行目の値は3〜5件必要です。`);
    return {
      label: expectedRows[index],
      values: row.values.map((value) => String(value || "").trim()),
      sourceIds: Array.isArray(row.sourceIds) ? [...new Set(row.sourceIds.map(String))] : []
    };
  });
  if (!Array.isArray(content.hashtags) || !content.hashtags.length || content.hashtags.some((tag) => typeof tag !== "string" || !tag.trim())) throw new Error("ハッシュタグを1つ以上入力してください。");
  const hashtags = content.hashtags.map((tag) => tag.trim().replace(/^[#＃]+/, "").replace(/\s+/g, "")).filter(Boolean).map((tag) => `#${tag}`);
  if (!hashtags.length) throw new Error("ハッシュタグを1つ以上入力してください。");
  const normalizedContent = {
    postType,
    title,
    subtitle,
    imageQuery,
    subject: {
      name: requiredString(subjectRaw, "name", "調査対象名"),
      entityType: subjectEntityType,
      domain: subjectRaw.entityType === "company" ? normalizeDomain(subjectRaw.domain) : ""
    },
    quantitative: {
      chartTitle: requiredString(quantitative, "chartTitle", "グラフタイトル"),
      chartUnit: requiredString(quantitative, "chartUnit", "グラフ単位"),
      metrics,
      summaryTitle: requiredString(quantitative, "summaryTitle", "定量要約見出し").slice(0, 10),
      summaryText: requiredString(quantitative, "summaryText", "定量要約本文"),
      insightAxis: normalizeAxis(quantitative.insightAxis),
      studentInsight: requiredString(quantitative, "studentInsight", "定量情報の就活への示唆"),
      sourceIds: Array.isArray(quantitative.sourceIds) ? [...new Set(quantitative.sourceIds.map(String))] : []
    },
    qualitative: {
      positiveLabel: /company/.test(contentType) ? "強み" : "メリット",
      positiveTitle: requiredString(qualitative, "positiveTitle", "ポジティブ見出し").slice(0, 10),
      positiveText: requiredString(qualitative, "positiveText", "ポジティブ説明"),
      negativeLabel: /company/.test(contentType) ? "弱み" : "リスク",
      negativeTitle: requiredString(qualitative, "negativeTitle", "ネガティブ見出し").slice(0, 10),
      negativeText: requiredString(qualitative, "negativeText", "ネガティブ説明"),
      outlookTitle: requiredString(qualitative, "outlookTitle", "見通し見出し").slice(0, 10),
      outlookText: requiredString(qualitative, "outlookText", "見通し説明"),
      insightAxis: normalizeAxis(qualitative.insightAxis),
      studentInsight: requiredString(qualitative, "studentInsight", "定性情報の就活への示唆"),
      sourceIds: Array.isArray(qualitative.sourceIds) ? [...new Set(qualitative.sourceIds.map(String))] : []
    },
    comparison: {
      columns,
      rows
    },
    cta: {
      title: requiredString(content.cta, "title", "CTA見出し"),
      body: requiredString(content.cta, "body", "CTA本文")
    },
    caption,
    hashtags: [...new Set(hashtags)]
  };
  require("./layout").assertSeries(normalizedContent);
  return normalizedContent;
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

async function normalizeTextLengths(input) {
  if (!lengthIssues(input.content).length) return input.content;
  if (!process.env.OPENAI_API_KEY) throw new Error("文字数の自動調整にはOpenAI接続が必要です。");
  return repairTextLengths(input.content, async (content, issues) => {
    const request = buildRepairRequest({ ...input, content, feedback: issues.map(i => `${i.section}.${i.key}: 現在${i.current}文字。${i.min}〜${i.max}文字、目標${Math.floor((i.min + i.max) / 2)}文字。`) });
    request.instructions += "\nThis is a LENGTH-ONLY rewrite. Change only the listed failing fields. Preserve all facts, numeric tokens, named companies, attribution, uncertainty, and source IDs. Do not add factual claims or generic padding. Expand by explaining the same existing meaning; shorten by removing redundant phrasing. Return the complete content object. Other fields must stay identical.";
    const response = await callOpenAI(request);
    return JSON.parse(extractOutputText(response));
  });
}

async function autoImproveQuality(input, referenceDate = new Date()) {
  if (!process.env.OPENAI_API_KEY) throw new Error("総合評価の自動改善にはOpenAI接続が必要です。");
  const initial = { content: input.content, sources: input.sources || [], quality: await evaluateContentQuality(input, referenceDate) };
  return improveQuality(initial, {
    rewrite: async current => {
      const request = buildRepairRequest({ ...input, ...current, feedback: repairFeedback(current.content, current.sources, current.quality) });
      const response = await callOpenAI(request);
      let content = applyAccountRules(validateContent(JSON.parse(extractOutputText(response)), input.contentType), input.account, input.contentType);
      content = validateContent(await normalizeTextLengths({ ...input, ...current, content }), input.contentType);
      return { content, sources: current.sources, quality: await evaluateContentQuality({ ...input, content, sources: current.sources }, referenceDate) };
    },
    research: async current => {
      const request = buildOpenAIRequest({ ...input, notes: `${input.notes || ""}\n前回の不合格理由: ${repairFeedback(current.content, current.sources, current.quality).join(" ")}\n出典不足の場合は、最新の公式一次資料をWeb検索し、検索で実際に返ったURLを使用する。` }, referenceDate);
      const response = await callOpenAI(request);
      const raw = JSON.parse(extractOutputText(response));
      const sources = normalizeSources(raw.sources, extractWebEvidence(response));
      let content = applyAccountRules(validateContent(raw.content, input.contentType), input.account, input.contentType);
      content = validateContent(await normalizeTextLengths({ ...input, content, sources }), input.contentType);
      return { content, sources, quality: await evaluateContentQuality({ ...input, content, sources }, referenceDate) };
    }
  });
}

function qualityRank(quality) {
  const checks = quality?.checks || [];
  const failedCount = checks.filter((check) => check.pass === false).length;
  const complete = checks.length === QUALITY_CRITERIA.length;
  const overall = Number(quality?.overallScore) || 0;
  const ready = complete && failedCount === 0 && overall >= OVERALL_PASS_SCORE ? 1 : 0;
  const minimum = complete ? Math.min(...checks.map((check) => Number(check.score) || 0)) : 0;
  return [ready, failedCount ? -failedCount : 0, minimum, overall];
}

function isBetterQuality(candidate, current) {
  const next = qualityRank(candidate);
  const previous = qualityRank(current);
  for (let index = 0; index < next.length; index += 1) {
    if (next[index] !== previous[index]) return next[index] > previous[index];
  }
  return false;
}

async function generateWithOpenAI(input, referenceDate = new Date()) {
  const response = await callOpenAI(buildOpenAIRequest(input, referenceDate));
  const raw = JSON.parse(extractOutputText(response));
  let sources = normalizeSources(raw.sources, extractWebEvidence(response));
  let content = applyAccountRules(validateContent(raw.content, input.contentType), input.account, input.contentType);
  const { comparisonEvidenceIssues } = require("./quality");
  if (comparisonEvidenceIssues(content).length) {
    const followup = await callOpenAI(buildOpenAIRequest({ ...input, notes: `${input.notes || ""}\n比較表の各社を公式資料・報道・業界媒体・採用サイトで再調査する。推測は出典を付けて推測と明記する。前回原稿: ${JSON.stringify(content.comparison)}\n${comparisonEvidenceIssues(content).join(" ")}` }, referenceDate));
    const researched = JSON.parse(extractOutputText(followup));
    const candidate = applyAccountRules(validateContent(researched.content, input.contentType), input.account, input.contentType);
    if (comparisonEvidenceIssues(candidate).length < comparisonEvidenceIssues(content).length) {
      content = candidate;
      sources = normalizeSources(researched.sources, extractWebEvidence(followup));
    }
  }
  let quality = await evaluateContentQuality({ content, sources, topic: input.topic, contentType: input.contentType, targetYear: input.targetYear }, referenceDate);
  if (comparisonEvidenceIssues(content).length) {
    const request = buildRepairRequest({ ...input, content, sources, feedback: comparisonEvidenceIssues(content) });
    request.instructions += "\nComplete missing comparison cells using the supplied web evidence. Where a direct fact is absent, write a useful qualitative inference prefixed 推測 and cite the premises in that row's sourceIds. Numerical estimates require visible 推定, cited inputs and a reproducible method in sources.supportedClaim. Preserve supported cells and every other page. Never output 非開示 or 確認できず. If even a qualitative inference has no supporting premise, do not invent one.";
    const repaired = validateContent(JSON.parse(extractOutputText(await callOpenAI(request))), input.contentType);
    if (comparisonEvidenceIssues(repaired).length < comparisonEvidenceIssues(content).length) {
      content = applyAccountRules(repaired, input.account, input.contentType);
      quality = await evaluateContentQuality({ ...input, content, sources }, referenceDate);
    }
  }
  const maxRepairAttempts = Math.min(2, positiveInteger(process.env.OPENAI_MAX_REPAIR_ATTEMPTS, 1));
  for (let attempt = 0; attempt < maxRepairAttempts; attempt += 1) {
    const feedback = repairFeedback(content, sources, quality);
    if (!feedback.length) break;
    const repairResponse = await callOpenAI(buildRepairRequest({
      content,
      sources,
      topic: input.topic,
      contentType: input.contentType,
      targetYear: input.targetYear,
      feedback
    }));
    const candidateContent = applyAccountRules(validateContent(JSON.parse(extractOutputText(repairResponse)), input.contentType), input.account, input.contentType);
    const candidateQuality = await evaluateContentQuality({ content: candidateContent, sources, topic: input.topic, contentType: input.contentType, targetYear: input.targetYear }, referenceDate);
    if (isBetterQuality(candidateQuality, quality)) {
      content = candidateContent;
      quality = candidateQuality;
    }
  }
  const normalized = await normalizeTextLengths({ ...input, content, sources });
  if (JSON.stringify(normalized) !== JSON.stringify(content)) {
    content = validateContent(normalized, input.contentType);
    quality = await evaluateContentQuality({ ...input, content, sources }, referenceDate);
  }
  return { content, sources, quality };
}

async function generateCarousel(input, referenceDate = new Date()) {
  if (!process.env.OPENAI_API_KEY) {
    const content = applyAccountRules(validateContent(demoContent(input), input.contentType), input.account, input.contentType);
    return { content, sources: [], quality: normalizeQuality({ checks: [] }, [], referenceDate), source: "demo" };
  }
  return { ...(await generateWithOpenAI(input, referenceDate)), source: "openai-web" };
}

module.exports = {
  generateCarousel,
  normalizeTextLengths,
  autoImproveQuality,
  evaluateContentQuality,
  contentSchema,
  researchSchema,
  qualitySchema,
  demoContent,
  validateContent,
  extractOutputText,
  buildOpenAIRequest,
  buildQualityRequest,
  buildRepairRequest,
  repairFeedback,
  qualityRank,
  isBetterQuality,
  resolveCta,
  applyAccountRules,
  comparisonRowsFor
};
