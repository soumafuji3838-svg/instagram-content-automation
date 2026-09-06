const limits = [
  ["quantitative", "summaryTitle", 1, 10], ["quantitative", "summaryText", 90, 110],
  ["quantitative", "studentInsight", 45, 70],
  ["qualitative", "positiveTitle", 1, 10], ["qualitative", "positiveText", 45, 60],
  ["qualitative", "negativeTitle", 1, 10], ["qualitative", "negativeText", 45, 60],
  ["qualitative", "outlookTitle", 1, 10], ["qualitative", "outlookText", 80, 100],
  ["qualitative", "studentInsight", 45, 70]
];
const count = value => Array.from(String(value || "").trim()).length;
function lengthIssues(content) {
  return limits.filter(([section, key, min, max]) => count(content[section]?.[key]) < min || count(content[section]?.[key]) > max)
    .map(([section, key, min, max]) => ({ section, key, min, max, current: count(content[section]?.[key]) }));
}
const numbers = text => (String(text).match(/[0-9０-９]+(?:[,.．，][0-9０-９]+)*/g) || []).sort();
async function repairTextLengths(content, rewrite) {
  let current = structuredClone(content);
  for (let attempt = 0; attempt < 3; attempt++) {
    const issues = lengthIssues(current);
    if (!issues.length) return current;
    const candidate = await rewrite(structuredClone(current), issues);
    for (const { section, key, min, max } of issues) {
      const value = candidate?.[section]?.[key];
      if (typeof value !== "string" || count(value) < min || count(value) > max) continue;
      // Never accept numerical changes, or changes outside the failed prose fields.
      if (JSON.stringify(numbers(value)) !== JSON.stringify(numbers(current[section][key]))) continue;
      current[section][key] = value.trim();
    }
  }
  if (lengthIssues(current).length) throw new Error("文字数の自動調整を3回試しましたが、事実を保ったまま規定内に収められませんでした。原稿は変更していません。時間をおいて再実行してください。");
  return current;
}
module.exports = { limits, count, lengthIssues, repairTextLengths };
