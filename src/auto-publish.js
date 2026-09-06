// Preparation only: deliberately has no Graph API call or live enable flag.
// A persistent atomic job claim and reconciliation of uncertain results are
// prerequisites for enabling a scheduled publisher across Vercel instances.
const { publicationGate } = require("./quality");
const { imageReviewReady } = require("./image-review");
function planAutomaticPublication(post) {
  const reasons = [];
  if (post.status !== "approved") reasons.push("承認が必要です。");
  if (post.generationSource === "demo") reasons.push("デモ投稿は対象外です。");
  if (post.publishResult || post.publishedAt) reasons.push("投稿履歴があるため再送しません。");
  if (!imageReviewReady(post)) reasons.push("画像の確認が必要です。");
  const gate = publicationGate(post.quality, post.content, post.sources || [], post.companyLogos || {});
  if (!gate.ready) reasons.push(...gate.failed);
  return { postId: post.id, eligible: reasons.length === 0, reasons, mode: "plan_only", willPublish: false };
}
module.exports = { planAutomaticPublication };
