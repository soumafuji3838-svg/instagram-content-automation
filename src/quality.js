const QUALITY_CRITERIA = [
  "抽象論になっていないか",
  "最新の情報か（投稿日から3カ月以内の情報）",
  "参照が存在するか",
  "同じ内容を繰り返していないか",
  "見出しだけで意味が伝わるか",
  "保存したくなる実用性があるか",
  "誇張や根拠のない断定がないか"
];

const OVERALL_PASS_SCORE = 75;
const SOURCE_CRITERIA = new Set([QUALITY_CRITERIA[1], QUALITY_CRITERIA[2]]);

function minimumScoreFor(criterion) {
  return SOURCE_CRITERIA.has(criterion) ? 4 : 3;
}

function cutoffDate(referenceDate = new Date()) {
  const date = new Date(referenceDate);
  date.setUTCMonth(date.getUTCMonth() - 3);
  return date;
}

function normalizeUrl(value) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function evidenceKey(value) {
  const normalized = normalizeUrl(value);
  if (!normalized) return null;
  const url = new URL(normalized);
  url.search = "";
  let pathname = url.pathname.replace(/\/+$/, "");
  if (!pathname) pathname = "/";
  return `${url.hostname.replace(/^www\./, "").toLowerCase()}${pathname}`;
}

function extractWebEvidence(response) {
  const citations = [];
  const consultedUrls = [];
  for (const item of response?.output || []) {
    if (item.type === "web_search_call") {
      for (const source of item.action?.sources || []) {
        const url = normalizeUrl(source.url);
        if (url) consultedUrls.push(url);
      }
      if (item.action?.url) {
        const url = normalizeUrl(item.action.url);
        if (url) consultedUrls.push(url);
      }
    }
    for (const content of item.content || []) {
      for (const annotation of content.annotations || []) {
        if (annotation.type !== "url_citation") continue;
        const citation = annotation.url_citation || annotation;
        const url = normalizeUrl(citation.url);
        if (url) citations.push({ url, title: String(citation.title || "参照元") });
      }
    }
  }
  return { citations, consultedUrls: [...new Set(consultedUrls)] };
}

function normalizeSources(rawSources, evidence = { citations: [], consultedUrls: [] }) {
  const citationMap = new Map((evidence.citations || []).map((item) => [normalizeUrl(item.url), item]));
  const consulted = new Set((evidence.consultedUrls || []).map(normalizeUrl).filter(Boolean));
  const citedKeys = new Set((evidence.citations || []).map((item) => evidenceKey(item.url)).filter(Boolean));
  const consultedKeys = new Set((evidence.consultedUrls || []).map(evidenceKey).filter(Boolean));
  const normalized = [];
  for (const [index, source] of (rawSources || []).entries()) {
    const url = normalizeUrl(source?.url);
    if (!url) continue;
    const citation = citationMap.get(url);
    normalized.push({
      id: String(source.id || `S${index + 1}`).trim(),
      title: String(source.title || citation?.title || "参照元").trim(),
      publisher: String(source.publisher || "").trim(),
      url,
      publishedAt: String(source.publishedAt || "").trim(),
      supportedClaim: String(source.supportedClaim || "").trim(),
      sourceType: source.sourceType === "japan_employment" ? "japan_employment" : "recent_fact",
      japanEmploymentCompanies: Array.isArray(source.japanEmploymentCompanies) ? [...new Set(source.japanEmploymentCompanies.map((name) => String(name).trim()).filter(Boolean))] : [],
      verifiedBySearch: Boolean(citation || consulted.has(url) || citedKeys.has(evidenceKey(url)) || consultedKeys.has(evidenceKey(url)))
    });
  }
  for (const citation of evidence.citations || []) {
    const url = normalizeUrl(citation.url);
    if (url && !normalized.some((source) => source.url === url)) {
      normalized.push({ id: `S${normalized.length + 1}`, title: citation.title, publisher: "", url, publishedAt: "", supportedClaim: "", sourceType: "recent_fact", japanEmploymentCompanies: [], verifiedBySearch: true });
    }
  }
  return normalized.filter((source, index, list) => list.findIndex((item) => item.url === source.url) === index);
}

function textLength(value) {
  return Array.from(String(value || "").trim()).length;
}

function comparisonEvidenceIssues(content) {
  const issues = [];
  for (const row of content?.comparison?.rows || []) {
    if ((row.values || []).some(value => !String(value || "").trim() || /確認できず|不明|非開示|情報なし|未確認/.test(String(value)))) {
      issues.push(`比較表「${row.label}」に情報不足があります。各社のWeb情報を再調査し、推測には根拠と明示が必要です。`);
    }
  }
  return issues;
}

function structureChecks(content, sources = []) {
  const failed = [];
  if (!content) return ["5枚構成の原稿データがありません。"]; 
  failed.push(...comparisonEvidenceIssues(content));
  const within = (value, min, max, label) => {
    const length = textLength(value);
    if (length < min || length > max) failed.push(`${label}は${min}〜${max}文字にしてください（現在${length}文字）。`);
  };
  const heading = (value, label) => {
    const length = textLength(value);
    if (!length || length > 10) failed.push(`${label}は1〜10文字にしてください（現在${length}文字）。`);
  };
  heading(content.quantitative?.summaryTitle, "定量要約の見出し");
  within(content.quantitative?.summaryText, 90, 110, "定量要約の本文");
  within(content.quantitative?.studentInsight, 45, 70, "定量情報の就活への示唆");
  heading(content.qualitative?.positiveTitle, `${content.qualitative?.positiveLabel || "強み・メリット"}の見出し`);
  within(content.qualitative?.positiveText, 45, 60, `${content.qualitative?.positiveLabel || "強み・メリット"}の本文`);
  heading(content.qualitative?.negativeTitle, `${content.qualitative?.negativeLabel || "弱み・リスク"}の見出し`);
  within(content.qualitative?.negativeText, 45, 60, `${content.qualitative?.negativeLabel || "弱み・リスク"}の本文`);
  heading(content.qualitative?.outlookTitle, "将来見通しの見出し");
  within(content.qualitative?.outlookText, 80, 100, "将来見通しの本文");
  within(content.qualitative?.studentInsight, 45, 70, "定性情報の就活への示唆");
  if (content.subject?.entityType === "company" && !content.subject.domain) failed.push("企業レポートの表紙ロゴ用に公式ドメインが必要です。");
  if (content.subject?.entityType === "company" && content.subject.name && String(content.title || "").includes(content.subject.name)) failed.push("企業レポートの表紙タイトルから企業名を外し、企業名はロゴで表示してください。");
  if ((content.quantitative?.metrics || []).some((metric) => metric.entityType === "company" && !metric.companyDomain)) failed.push("企業別グラフの各企業に公式ドメインが必要です。");
  if ((content.comparison?.columns || []).some((column) => column.entityType === "company" && !column.domain)) failed.push("企業比較の各企業に公式ドメインが必要です。");

  const namedCompanies = [...new Set([
    ...(content.subject?.entityType === "company" ? [content.subject.name] : []),
    ...(content.quantitative?.metrics || []).filter((metric) => metric.entityType === "company").map((metric) => metric.label),
    ...(content.comparison?.columns || []).filter((column) => column.entityType === "company").map((column) => column.name)
  ].map((name) => String(name || "").trim()).filter(Boolean))];
  const employmentSources = (sources || []).filter((source) => source.sourceType === "japan_employment" && source.verifiedBySearch);
  const evidencedCompanies = new Set(employmentSources.flatMap((source) => source.japanEmploymentCompanies || []).map((name) => String(name).trim()));
  const missingEmploymentEvidence = namedCompanies.filter((name) => !evidencedCompanies.has(name));
  if (missingEmploymentEvidence.length) failed.push(`日本国内での公式採用情報を確認できない企業があります：${missingEmploymentEvidence.join("、")}`);

  for (const metric of content.quantitative?.metrics || []) {
    if (/推定|推測/.test(metric.displayValue) && !(sources || []).some(source => (metric.sourceIds || []).includes(source.id) && /計算|算出|推定|推測|算式|method/i.test(source.supportedClaim || ""))) failed.push("推定値に出典と算出方法が必要です。");
  }
  const knownSourceIds = new Set((sources || []).map((source) => source.id).filter(Boolean));
  const references = [
    ...(content.quantitative?.sourceIds || []),
    ...(content.quantitative?.metrics || []).flatMap((metric) => metric.sourceIds || []),
    ...(content.qualitative?.sourceIds || []),
    ...(content.comparison?.rows || []).flatMap((row) => row.sourceIds || [])
  ];
  if (!references.length) failed.push("各ページに出典IDを紐付けてください。");
  const unknown = [...new Set(references.filter((id) => !knownSourceIds.has(id)))];
  if (unknown.length) failed.push(`存在しない出典IDがあります：${unknown.join("、")}`);
  if ((content.quantitative?.metrics || []).some((metric) => !(metric.sourceIds || []).length)) failed.push("定量グラフの各数値に出典IDが必要です。");
  if ((content.comparison?.rows || []).some((row) => !(row.sourceIds || []).length)) failed.push("比較表の各行に出典IDが必要です。");
  return [...new Set(failed)];
}

function publicationGate(quality, content, sources, companyLogos = {}, { checkLogos = true } = {}) {
  const checks = quality?.checks || [];
  const failed = [];
  if (!quality || quality.overallScore < OVERALL_PASS_SCORE) failed.push(`総合評価が${OVERALL_PASS_SCORE}点未満です。`);
  for (const check of checks) {
    if (check.score < minimumScoreFor(check.criterion)) failed.push(`${check.criterion}が公開基準を満たしていません。`);
  }
  if (checks.length !== QUALITY_CRITERIA.length) failed.push("品質評価7項目がそろっていません。");
  if (content) failed.push(...structureChecks(content, sources));
  if(content) {
    const expected = require("./logo").logoDomains(content);
    if(checkLogos && expected.some(domain=>!["ready","cached"].includes(companyLogos[domain]?.status)))failed.push("掲載企業のロゴ記録が不足しています。");
    try { require("./layout").assertSeries(content); } catch(error) {failed.push(error.message);}
  }
  const failedLogos = Object.values(companyLogos || {}).filter((logo) => !["ready", "cached"].includes(logo?.status));
  if (failedLogos.length) failed.push("取得できていない企業ロゴがあります。公式ドメインを確認してください。");
  return { ready: failed.length === 0, failed: [...new Set(failed)] };
}

function sourceChecks(sources, referenceDate = new Date()) {
  const cutoff = cutoffDate(referenceDate);
  const today = new Date(referenceDate);
  const recentFactSources = sources.filter((source) => source.sourceType !== "japan_employment");
  const dated = recentFactSources.filter((source) => /^\d{4}-\d{2}-\d{2}$/.test(source.publishedAt) && !Number.isNaN(Date.parse(source.publishedAt)));
  const recent = dated.filter((source) => {
    const published = new Date(`${source.publishedAt}T00:00:00Z`);
    return published >= cutoff && published <= today;
  });
  const verified = sources.filter((source) => source.verifiedBySearch);
  return {
    freshness: {
      criterion: QUALITY_CRITERIA[1],
      score: recentFactSources.length >= 2 && dated.length === recentFactSources.length && recent.length === recentFactSources.length ? 5 : recent.length >= 2 ? 3 : 0,
      pass: recentFactSources.length >= 2 && dated.length === recentFactSources.length && recent.length === recentFactSources.length,
      reason: `時点情報${recentFactSources.length}件中${recent.length}件が直近3カ月以内（基準日: ${cutoff.toISOString().slice(0, 10)}）です。採用資格の恒久ページは別枠です。`,
      suggestion: recent.length === recentFactSources.length && recentFactSources.length >= 2 ? "最新性を確認済みです。" : "日付が確認でき、直近3カ月以内の参照元へ差し替えてください。"
    },
    references: {
      criterion: QUALITY_CRITERIA[2],
      score: verified.length >= 3 ? 5 : verified.length >= 2 ? 3 : 0,
      pass: verified.length >= 3,
      reason: `${sources.length}件中${verified.length}件をWeb検索結果で確認しました。`,
      suggestion: verified.length >= 3 ? "参照URLを確認済みです。" : "Web検索で確認できる参照元を3件以上追加してください。"
    }
  };
}

function normalizeQuality(rawQuality, sources, referenceDate = new Date()) {
  const supplied = new Map((rawQuality?.checks || []).map((check) => [check.criterion, check]));
  const programmatic = sourceChecks(sources, referenceDate);
  const checks = QUALITY_CRITERIA.map((criterion, index) => {
    if (index === 1) return programmatic.freshness;
    if (index === 2) return programmatic.references;
    const check = supplied.get(criterion) || {};
    const score = Math.max(0, Math.min(5, Number.parseInt(check.score, 10) || 0));
    return {
      criterion,
      score,
      pass: score >= minimumScoreFor(criterion),
      reason: String(check.reason || "評価結果がありません。"),
      suggestion: String(check.suggestion || "具体的な根拠と行動を追加してください。")
    };
  });
  const overallScore = Math.round(checks.reduce((sum, check) => sum + check.score, 0) / (checks.length * 5) * 100);
  return { overallScore, checks, evaluatedAt: new Date(referenceDate).toISOString() };
}

module.exports = { QUALITY_CRITERIA, OVERALL_PASS_SCORE, minimumScoreFor, cutoffDate, normalizeUrl, evidenceKey, extractWebEvidence, normalizeSources, sourceChecks, normalizeQuality, textLength, structureChecks, publicationGate, comparisonEvidenceIssues };
