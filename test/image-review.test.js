const test = require("node:test");
const assert = require("node:assert/strict");
const sharp = require("sharp");
const { checks, fingerprint, imageReviewReady } = require("../src/image-review");
const { uploadedCoverPhoto, restoreCoverPhoto } = require("../src/photo");
test("image review requires every check and is bound to content and rendered assets", () => {
  const post = { content: { title: "industry" }, assets: ["one"], coverPhoto: { status: "ready", id: "photo1" } };
  assert.equal(imageReviewReady(post), false);
  post.imageReview = { fingerprint: fingerprint(post), checks: checks.map(() => true) };
  assert.equal(imageReviewReady(post), true);
  post.imageReview.checks[1] = false;
  assert.equal(imageReviewReady(post), false);
  post.imageReview.checks[1] = true;
  post.assets = ["two"];
  assert.equal(imageReviewReady(post), false);
});
test("uploads are decoded, normalized and restorable without local files", async () => {
  const input = await sharp({ create: { width: 40, height: 40, channels: 3, background: "white" } }).png().toBuffer();
  const photo = await uploadedCoverPhoto(input.toString("base64"));
  assert.equal((await sharp(photo.buffer).metadata()).format, "jpeg");
  assert.deepEqual((await restoreCoverPhoto(photo.metadata)).buffer, photo.buffer);
  await assert.rejects(uploadedCoverPhoto("x".repeat(900001)));
  await assert.rejects(uploadedCoverPhoto(Buffer.from("<svg></svg>").toString("base64")));
});
