const test = require("node:test");
const assert = require("node:assert/strict");
const { quantitativeSvg } = require("../src/renderer");
const { demoContent } = require("../src/generator");
const { getDesign } = require("../src/designs");
const account = require("../config/accounts.json")[0];
test("bars stop before the dedicated value column, including invalid relative values", () => {
  const content = demoContent({ topic: "総合商社", targetYear: "28卒", account, contentType: "industry_report" });
  content.quantitative.metrics.forEach((m, i) => { m.value = [100, 150, -10][i]; m.displayValue = "2,985億円"; });
  const svg = quantitativeSvg({ content, account, design: getDesign(account.designId) });
  const widths = [...svg.matchAll(/<rect x="270"[^>]*width="(\d+)"/g)].map(m => Number(m[1]));
  assert.ok(widths.length >= 6);
  assert.ok(widths.every(w => w >= 0 && w <= 510));
  assert.match(svg, /<text x="1000"/);
});
