const contentTypes = [
  {
    id: "industry_report",
    label: "2分でわかる｜業界レポート",
    footerLabel: "業界レポート",
    structure: "業界の定義、主要領域、収益構造、主要企業、直近の変化、就活で確認する行動",
    subjectEntityType: "industry",
    comparisonEntityType: "company",
    sectionLabels: { quantitative: "業界｜定量データ", qualitative: "業界｜構造と動向", comparison: "業界｜主要企業比較", comparisonTitle: "主要企業を同じ4軸で比較" }
  },
  {
    id: "company_report",
    label: "2分でわかる｜企業レポート",
    footerLabel: "企業レポート",
    structure: "企業概要、主要事業、収益構造、強み、直近の動き、就活で確認する行動",
    subjectEntityType: "company",
    comparisonEntityType: "company",
    sectionLabels: { quantitative: "企業｜定量データ", qualitative: "企業｜強みと課題", comparison: "企業｜競合比較", comparisonTitle: "競合企業を同じ4軸で比較" }
  },
  {
    id: "industry_comparison",
    label: "2分でわかる｜業界比較",
    footerLabel: "業界比較レポート",
    structure: "比較対象、顧客、収益構造、市場環境、働き方・職種、選ぶための確認項目",
    subjectEntityType: "industry",
    comparisonEntityType: "industry",
    sectionLabels: { quantitative: "業界比較｜定量データ", qualitative: "業界比較｜違いと影響", comparison: "業界比較｜3業界", comparisonTitle: "3業界を同じ4軸で比較" }
  },
  {
    id: "company_comparison",
    label: "2分でわかる｜企業比較",
    footerLabel: "企業比較レポート",
    structure: "比較対象、主要事業、収益源、強み、直近の動き、志望先を選ぶ確認項目",
    subjectEntityType: "topic",
    comparisonEntityType: "company",
    sectionLabels: { quantitative: "企業比較｜定量データ", qualitative: "企業比較｜強みと課題", comparison: "企業比較｜3社", comparisonTitle: "3社を同じ4軸で比較" }
  },
  {
    id: "trend_report",
    label: "2分でわかる｜トレンドレポート",
    footerLabel: "トレンドレポート",
    structure: "何が起きたか、根拠、背景、業界への影響、企業への影響、就活生の確認項目",
    subjectEntityType: "topic",
    comparisonEntityType: "industry",
    sectionLabels: { quantitative: "トレンド｜定量データ", qualitative: "トレンド｜背景と影響", comparison: "トレンド｜関連領域", comparisonTitle: "関連領域を同じ4軸で比較" }
  }
];

function getContentType(id) {
  return contentTypes.find((item) => item.id === id) || contentTypes[0];
}

module.exports = { contentTypes, getContentType };
