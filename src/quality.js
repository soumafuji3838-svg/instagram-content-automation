const QUALITY_CRITERIA = [
  "抽象論になっていないか",
  "最新の情報か（投稿日から3カ月以内の情報）",
  "参照が存在するか",
  "同じ内容を繰り返していないか",
  "見出しだけで意味が伝わるか",
  "保存したくなる実用性があるか",
  "誇張や根拠のない断定がないか"
];

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
      verifiedBySearch: Boolean(citation || consulted.has(url))
    });
  }
  for (const citation of evidence.citations || []) {
    const url = normalizeUrl(citation.url);
    if (url && !normalized.some((source) => source.url === url)) {
      normalized.push({ id: `S${normalized.length + 1}`, title: citation.title, publisher: "", url, publishedAt: "", supportedClaim: "", verifiedBySearch: true });
    }
  }
  return normalized.filter((source, index, list) => list.findIndex((item) => item.url === source.url) === index);
}

function textLength(value) {
  return Array.from(String(value || "").trim()).length;
}

function structureChecks(content, sources = []) {
  const failed = [];
  if (!content) return ["5枚構成の原稿データがありません。"]; 
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

function publicationGate(quality, content, sources, companyLogos = {}) {
  const checks = quality?.checks || [];
  const failed = [];
  if (!quality || quality.overallScore < 85) failed.push("総合評価が85点未満です。");
  for (const check of checks) {
    if (check.score < 4 || !check.pass) failed.push(`${check.criterion}が公開基準を満たしていません。`);
  }
  if (checks.length !== QUALITY_CRITERIA.length) failed.push("品質評価7項目がそろっていません。");
  if (content) failed.push(...structureChecks(content, sources));
  const failedLogos = Object.values(companyLogos || {}).filter((logo) => !["ready", "cached"].includes(logo?.status));
  if (failedLogos.length) failed.push("取得できていない企業ロゴがあります。公式ドメインを確認してください。");
  return { ready: failed.length === 0, failed: [...new Set(failed)] };
}

function sourceChecks(sources, referenceDate = new Date()) {
  const cutoff = cutoffDate(referenceDate);
  const today = new Date(referenceDate);
  const dated = sources.filter((source) => /^\d{4}-\d{2}-\d{2}$/.test(source.publishedAt) && !Number.isNaN(Date.parse(source.publishedAt)));
  const recent = dated.filter((source) => {
    const published = new Date(`${source.publishedAt}T00:00:00Z`);
    return published >= cutoff && published <= today;
  });
  const verified = sources.filter((source) => source.verifiedBySearch);
  return {
    freshness: {
      criterion: QUALITY_CRITERIA[1],
      score: sources.length >= 2 && dated.length === sources.length && recent.length === sources.length ? 5 : recent.length >= 2 ? 3 : 0,
      pass: sources.length >= 2 && dated.length === sources.length && recent.length === sources.length,
      reason: `${sources.length}件中${recent.length}件が直近3カ月以内（基準日: ${cutoff.toISOString().slice(0, 10)}）です。`,
      suggestion: recent.length === sources.length && sources.length >= 2 ? "最新性を確認済みです。" : "日付が確認でき、直近3カ月以内の参照元へ差し替えてください。"
    },
    references: {
      criterion: QUALITY_CRITERIA[2],
      score: verified.length >= 3 ? 5 : verified.length >= 2 ? 3 : 0,
      pass: verified.length >= 2,
      reason: `${sources.length}件中${verified.length}件をWeb検索結果で確認しました。`,
      suggestion: verified.length >= 2 ? "参照URLを確認済みです。" : "Web検索で確認できる参照元を2件以上追加してください。"
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
      pass: score >= 4,
      reason: String(check.reason || "評価結果がありません。"),
      suggestion: String(check.suggestion || "具体的な根拠と行動を追加してください。")
    };
  });
  const overallScore = Math.round(checks.reduce((sum, check) => sum + check.score, 0) / (checks.length * 5) * 100);
  return { overallScore, checks, evaluatedAt: new Date(referenceDate).toISOString() };
}

module.exports = { QUALITY_CRITERIA, cutoffDate, extractWebEvidence, normalizeSources, sourceChecks, normalizeQuality, textLength, structureChecks, publicationGate };
