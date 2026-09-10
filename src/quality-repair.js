const { publicationGate, QUALITY_CRITERIA, structureChecks, comparisonEvidenceIssues } = require("./quality");
function ready(candidate) {
  return publicationGate(candidate.quality, candidate.content, candidate.sources, {}, { checkLogos: false }).ready;
}
function needsResearch(candidate) {
  if (comparisonEvidenceIssues(candidate.content).length) return true;
  return QUALITY_CRITERIA.slice(1, 3).some(criterion => !candidate.quality?.checks?.some(check => check.criterion === criterion && check.score >= 4));
}
function rank(candidate) {
  const gate = publicationGate(candidate.quality, candidate.content, candidate.sources, {}, { checkLogos: false });
  return [Number(gate.ready), -gate.failed.length, -structureChecks(candidate.content, candidate.sources).length, Number(candidate.quality?.overallScore) || 0];
}
function better(next, previous) {
  const a = rank(next), b = rank(previous);
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
async function improveQuality(initial, { rewrite, research }) {
  let best = structuredClone(initial);
  const attempts = [];
  let researched = false;
  for (let i = 0; i < 3 && !ready(best); i++) {
    const useResearch = !researched && (needsResearch(best) || i === 2);
    if (useResearch) researched = true;
    const kind = useResearch ? "research" : "rewrite";
    try {
      const candidate = await (useResearch ? research : rewrite)(structuredClone(best));
      const accepted = better(candidate, best);
      attempts.push({ kind, accepted, score: candidate.quality?.overallScore });
      if (accepted) best = candidate;
    } catch (error) {
      attempts.push({ kind, accepted: false, error: error.message });
      break;
    }
  }
  return { ...best, repairReport: { ready: ready(best), attempts, failed: publicationGate(best.quality, best.content, best.sources, {}, { checkLogos: false }).failed } };
}
module.exports = { improveQuality, needsResearch, better };
