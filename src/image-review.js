const crypto = require("node:crypto");
const checks = [
  "テーマと関連し、企業・業界の実態を誤解させない",
  "ふざけた演出・嘲笑・金銭などの誇張したステレオタイプがない",
  "業界や働く人への敬意があり、不当に侮辱・揶揄していない",
  "素材写真を実際の企業・社員・現場と誤認させない",
  "画像の利用権・人物の公開許諾を確認した"
];
function fingerprint(post) {
  return crypto.createHash("sha256").update(JSON.stringify([post.content, post.assets, post.coverPhoto?.id])).digest("hex");
}
function imageReviewReady(post) {
  return post.coverPhoto?.status === "ready" && post.imageReview?.fingerprint === fingerprint(post) && checks.every((_, i) => post.imageReview?.checks?.[i] === true);
}
module.exports = { checks, fingerprint, imageReviewReady };
