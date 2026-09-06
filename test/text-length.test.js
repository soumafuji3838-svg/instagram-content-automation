const test = require("node:test");
const assert = require("node:assert/strict");
const { limits, lengthIssues, repairTextLengths } = require("../src/text-length");
function valid() {
  const content = { quantitative: { metrics: [{ displayValue: "2,985億円", sourceIds: ["S1"] }] }, qualitative: {}, caption: "元の本文" };
  for (const [section, key, min] of limits) content[section][key] = "あ".repeat(min);
  return content;
}
test("valid length does not call the model", async () => {
  const content = valid();
  assert.deepEqual(await repairTextLengths(content, () => { throw new Error("unexpected"); }), content);
});
test("repairs only failed fields and preserves numeric data, references and caption", async () => {
  const content = valid(); content.qualitative.positiveText = "説明";
  const output = await repairTextLengths(content, async c => {
    c.qualitative.positiveText = "あ".repeat(50);
    c.quantitative.metrics[0].displayValue = "999億円";
    c.caption = "変更";
    return c;
  });
  assert.equal(lengthIssues(output).length, 0);
  assert.deepEqual(output.quantitative.metrics, content.quantitative.metrics);
  assert.equal(output.caption, "元の本文");
  assert.equal(content.qualitative.positiveText, "説明");
});
test("rejects number changes and stops after three attempts without modifying original", async () => {
  const content = valid(); content.qualitative.positiveText = "3社";
  let calls = 0;
  await assert.rejects(repairTextLengths(content, async c => { calls++; return { ...c, qualitative: { ...c.qualitative, positiveText: "4社" + "あ".repeat(48) } }; }));
  assert.equal(calls, 3);
  assert.equal(content.qualitative.positiveText, "3社");
});
test("a third-attempt correction is accepted", async () => {
  const content = valid(); content.qualitative.positiveText = "短い";
  let calls = 0;
  const output = await repairTextLengths(content, async c => ({ ...c, qualitative: { ...c.qualitative, positiveText: ++calls === 3 ? "あ".repeat(50) : "短い" } }));
  assert.equal(lengthIssues(output).length, 0);
});
