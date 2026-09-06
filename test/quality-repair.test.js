const test = require("node:test");
const assert = require("node:assert/strict");
const { improveQuality } = require("../src/quality-repair");
const { QUALITY_CRITERIA } = require("../src/quality");
const { limits } = require("../src/text-length");
function candidate(score = 90, referenceScore = 5) {
  const content = { quantitative: { metrics: [] , sourceIds: ["S1"] }, qualitative: { sourceIds: ["S1"] }, comparison: { rows: [] } };
  for (const [section, key, min] of limits) content[section][key] = "あ".repeat(min);
  return { content, sources: [{ id: "S1", url: "https://example.com" }], quality: { overallScore: score, checks: QUALITY_CRITERIA.map((criterion, i) => ({ criterion, score: i === 2 ? referenceScore : 5 })) } };
}
test("source failures trigger research and stop as soon as gate passes", async () => {
  let research = 0, rewrite = 0;
  const result = await improveQuality(candidate(63, 2), { research: async () => { research++; return candidate(); }, rewrite: async () => { rewrite++; return candidate(); } });
  assert.equal(research, 1); assert.equal(rewrite, 0); assert.equal(result.repairReport.ready, true);
});
test("editorial failure rewrites content without research when sufficient", async () => {
  const result = await improveQuality(candidate(70), { rewrite: async () => candidate(80), research: async () => { throw new Error("unexpected research"); } });
  assert.equal(result.quality.overallScore, 80); assert.equal(result.repairReport.attempts[0].kind, "rewrite");
});
test("bounded unsuccessful repair retains best score and does not claim success", async () => {
  const result = await improveQuality(candidate(70), { rewrite: async () => candidate(60), research: async () => candidate(55) });
  assert.equal(result.quality.overallScore, 70); assert.equal(result.repairReport.ready, false); assert.equal(result.repairReport.attempts.length, 3);
});
test("API failure retains original candidate and records error", async () => {
  const result = await improveQuality(candidate(70), { rewrite: async () => { throw new Error("API unavailable"); }, research: async () => candidate() });
  assert.equal(result.quality.overallScore, 70); assert.equal(result.repairReport.ready, false);
  assert.match(result.repairReport.attempts[0].error, /unavailable/);
});
