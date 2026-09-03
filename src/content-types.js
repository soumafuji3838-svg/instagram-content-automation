const contentTypes = [
  {
    id: "industry_report",
    label: "2分でわかる｜業界レポート",
    footerLabel: "業界レポート",
    structure: "業界の定義、主要領域、収益構造、主要企業、直近の変化、就活で確認する行動"
  },
  {
    id: "company_report",
    label: "2分でわかる｜企業レポート",
    footerLabel: "企業レポート",
    structure: "企業概要、主要事業、収益構造、強み、直近の動き、就活で確認する行動"
  },
  {
    id: "industry_comparison",
    label: "2分でわかる｜業界比較",
    footerLabel: "業界比較レポート",
    structure: "比較対象、顧客、収益構造、市場環境、働き方・職種、選ぶための確認項目"
  },
  {
    id: "company_comparison",
    label: "2分でわかる｜企業比較",
    footerLabel: "企業比較レポート",
    structure: "比較対象、主要事業、収益源、強み、直近の動き、志望先を選ぶ確認項目"
  },
  {
    id: "trend_report",
    label: "2分でわかる｜トレンドレポート",
    footerLabel: "トレンドレポート",
    structure: "何が起きたか、根拠、背景、業界への影響、企業への影響、就活生の確認項目"
  }
];

function getContentType(id) {
  return contentTypes.find((item) => item.id === id) || contentTypes[0];
}

module.exports = { contentTypes, getContentType };
