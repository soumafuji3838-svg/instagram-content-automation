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
  for (const source of rawSources || []) {
    const url = normalizeUrl(source?.url);
    if (!url) continue;
    const citation = citationMap.get(url);
    normalized.push({
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
      normalized.push({ title: citation.title, publisher: "", url, publishedAt: "", supportedClaim: "", verifiedBySearch: true });
    }
  }
  return normalized.filter((source, index, list) => list.findIndex((item) => item.url === source.url) === index);
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

module.exports = { QUALITY_CRITERIA, cutoffDate, extractWebEvidence, normalizeSources, sourceChecks, normalizeQuality };
