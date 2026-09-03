const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");
const { dataRoot, postOutputDirectory } = require("./runtime-paths");
const { getDesign } = require("./designs");
const { getContentType } = require("./content-types");
const { normalizeDomain, prepareCompanyLogos } = require("./logo");

const fontDirectory = path.join(process.cwd(), "node_modules", "noto-fontface-cjk-jp", "fonts", "Noto");
const fontConfigDirectory = dataRoot();
const fontConfigPath = path.join(fontConfigDirectory, "fonts.conf");
fsSync.mkdirSync(fontConfigDirectory, { recursive: true });
fsSync.writeFileSync(fontConfigPath, `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <include ignore_missing="yes">/etc/fonts/fonts.conf</include>
  <dir>${fontDirectory}</dir>
</fontconfig>\n`);
process.env.FONTCONFIG_FILE = fontConfigPath;

const sharp = require("sharp");

const WIDTH = 1080;
const HEIGHT = 1350;

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function wrapJapanese(text, maxUnits) {
  const lines = [];
  for (const paragraph of String(text).split("\n")) {
    let line = "";
    let units = 0;
    for (const char of paragraph) {
      const weight = /[\x00-\xff]/.test(char) ? 0.55 : 1;
      const closingPunctuation = "、。！？）」』】％%：；".includes(char);
      if (line && closingPunctuation && units + weight > maxUnits) {
        line += char;
        lines.push(line);
        line = "";
        units = 0;
        continue;
      }
      if (line && units + weight > maxUnits) {
        lines.push(line);
        line = char;
        units = weight;
      } else {
        line += char;
        units += weight;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

function textBlock(lines, { x, y, size, lineHeight, color, weight = 700, maxLines = 5, anchor = "start", family = "Noto Sans CJK JP" }) {
  return lines.slice(0, maxLines).map((line, index) => (
    `<text x="${x}" y="${y + index * lineHeight}" font-family="${family}" font-size="${size}" font-weight="${weight}" fill="${color}" text-anchor="${anchor}">${escapeXml(line)}</text>`
  )).join("\n");
}

function baseSvg(design, inner) {
  const { canvas, colors, typography } = design;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
    <defs>
      <linearGradient id="footerGradient" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="${colors.cyan}"/>
        <stop offset="100%" stop-color="${colors.blue}"/>
      </linearGradient>
      <linearGradient id="heroGradient" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${colors.surface}"/>
        <stop offset="100%" stop-color="${colors.paleBlue}"/>
      </linearGradient>
    </defs>
    <style>text{font-family:'${typography.family}',sans-serif;letter-spacing:0.02em}</style>
    <rect width="${canvas.width}" height="${canvas.height}" fill="${colors.background}"/>
    ${inner}
  </svg>`;
}

function coverFooterSvg(design, label) {
  const { colors, typography } = design;
  return `
    <rect x="0" y="1216" width="1080" height="134" fill="url(#footerGradient)"/>
    <text x="86" y="1303" font-size="43" font-weight="${typography.brandWeight}" fill="#FFFFFF">2分でわかる</text>
    <text x="994" y="1303" font-size="43" font-weight="${typography.headlineWeight}" fill="#FFFFFF" text-anchor="end">${escapeXml(label)}</text>`;
}

function pageHeaderSvg(account, design, label, page) {
  const { colors, typography } = design;
  return `
    <rect x="0" y="0" width="1080" height="132" fill="${colors.surface}"/>
    <text x="54" y="78" font-size="31" font-weight="${typography.brandWeight}" fill="${colors.navy}">${escapeXml(account.name)}</text>
    <text x="1026" y="76" font-size="23" fill="${colors.muted}" text-anchor="end">${page} / 5</text>
    <rect x="54" y="105" width="972" height="2" fill="${colors.line}"/>
    <text x="54" y="174" font-size="26" font-weight="700" fill="${colors.blue}">${escapeXml(label)}</text>`;
}

function pageFooterSvg(account, design, sourceIds = []) {
  const { colors } = design;
  const ids = [...new Set(sourceIds)].filter(Boolean).join("・");
  return `
    <rect x="54" y="1260" width="972" height="2" fill="${colors.line}"/>
    <text x="54" y="1310" font-size="21" fill="${colors.muted}">@${escapeXml(account.instagram)}</text>
    <text x="1026" y="1310" font-size="20" fill="${colors.muted}" text-anchor="end">${ids ? `出典 ${escapeXml(ids)}` : "出典はキャプションに記載"}</text>`;
}

function companyLogoSvg(domain, logos, { x, y, width, height }) {
  const normalized = normalizeDomain(domain);
  const buffer = logos?.[normalized]?.buffer;
  if (buffer) {
    return `<image x="${x}" y="${y}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet" href="data:image/png;base64,${buffer.toString("base64")}"/>`;
  }
  const cx = x + width / 2;
  const cy = y + height / 2;
  return `<g fill="none" stroke="#617184" stroke-width="4" opacity="0.65">
    <rect x="${cx - 24}" y="${cy - 20}" width="48" height="40" rx="4"/>
    <path d="M${cx - 32} ${cy - 20} L${cx} ${cy - 42} L${cx + 32} ${cy - 20} M${cx - 12} ${cy + 20} V${cy - 2} H${cx + 12} V${cy + 20}"/>
  </g>`;
}

function coverSvg({ content, account, design, contentType, photoBuffer, logos = {} }) {
  const { colors, typography } = design;
  const type = getContentType(contentType);
  const h1 = wrapJapanese(content.title, 13);
  const h2 = wrapJapanese(content.subtitle, 24);
  const photo = photoBuffer
    ? `<image x="0" y="142" width="1080" height="690" preserveAspectRatio="xMidYMid slice" href="data:image/jpeg;base64,${photoBuffer.toString("base64")}"/>`
    : `<rect x="0" y="142" width="1080" height="690" fill="url(#heroGradient)"/>
       <circle cx="540" cy="420" r="112" fill="${colors.line}" opacity="0.7"/>
       <rect x="340" y="545" width="400" height="160" rx="80" fill="${colors.line}" opacity="0.7"/>
       <text x="540" y="770" font-size="22" fill="${colors.muted}" text-anchor="middle">PEXELS_API_KEY設定後にフリー素材を自動配置</text>`;
  const companySubject = content.subject?.entityType === "company";
  const subjectLogo = companySubject ? companyLogoSvg(content.subject.domain, logos, { x: 54, y: 858, width: 260, height: 78 }) : "";
  const titleY = companySubject ? 1008 : 930;
  const subtitleY = companySubject ? 1112 : 1088;
  return baseSvg(design, `
    <rect x="0" y="0" width="1080" height="142" fill="${colors.surface}"/>
    <text x="540" y="91" font-size="43" font-weight="${typography.brandWeight}" fill="${colors.navy}" text-anchor="middle">${escapeXml(account.name)}</text>
    ${photo}
    <rect x="0" y="832" width="1080" height="384" fill="${colors.surface}"/>
    ${subjectLogo}
    ${textBlock(h1, { x: 54, y: titleY, size: companySubject ? 54 : 68, lineHeight: 66, color: colors.navy, weight: typography.headlineWeight, maxLines: companySubject ? 1 : 2 })}
    ${textBlock(h2, { x: 56, y: subtitleY, size: companySubject ? 31 : 36, lineHeight: 45, color: colors.navy, weight: typography.bodyWeight, maxLines: 2 })}
    ${coverFooterSvg(design, type.footerLabel)}
  `);
}

function quantitativeSvg({ content, account, design, logos = {} }) {
  const { colors, typography } = design;
  const q = content.quantitative;
  const bars = q.metrics.map((metric, index) => {
    const y = 322 + index * 118;
    const width = Math.max(10, Math.round(metric.value * 6.3));
    const label = metric.entityType === "company"
      ? companyLogoSvg(metric.companyDomain, logos, { x: 78, y: y - 49, width: 150, height: 58 })
      : `<text x="78" y="${y}" font-size="25" font-weight="600" fill="${colors.navy}">${escapeXml(metric.label)}</text>`;
    return `
      ${label}
      <rect x="270" y="${y - 33}" width="720" height="48" rx="24" fill="${colors.paleBlue}"/>
      <rect x="270" y="${y - 33}" width="${width}" height="48" rx="24" fill="${index === 0 ? colors.blue : colors.cyan}"/>
      <text x="1000" y="${y}" font-size="24" font-weight="700" fill="${colors.navy}" text-anchor="end">${escapeXml(metric.displayValue)}</text>`;
  }).join("");
  const summary = wrapJapanese(q.summaryText, 27);
  const insight = wrapJapanese(q.studentInsight, 38);
  const sourceIds = [...q.sourceIds, ...q.metrics.flatMap((metric) => metric.sourceIds)];
  return baseSvg(design, `
    ${pageHeaderSvg(account, design, "IR｜定量要約", 2)}
    <text x="54" y="244" font-size="39" font-weight="${typography.headlineWeight}" fill="${colors.navy}">${escapeXml(q.chartTitle)}</text>
    <text x="1026" y="244" font-size="21" fill="${colors.muted}" text-anchor="end">${escapeXml(q.chartUnit)}</text>
    <rect x="54" y="275" width="972" height="430" rx="26" fill="${colors.surface}" stroke="${colors.line}" stroke-width="2"/>
    ${bars}
    <rect x="54" y="748" width="972" height="450" rx="26" fill="${colors.surface}" stroke="${colors.line}" stroke-width="2"/>
    <rect x="54" y="748" width="10" height="450" rx="5" fill="${colors.cyan}"/>
    <text x="94" y="826" font-size="28" font-weight="700" fill="${colors.blue}">要約</text>
    <text x="94" y="892" font-size="44" font-weight="${typography.headlineWeight}" fill="${colors.navy}">${escapeXml(q.summaryTitle)}</text>
    ${textBlock(summary, { x: 94, y: 938, size: 27, lineHeight: 38, color: colors.navy, weight: typography.bodyWeight, maxLines: 4 })}
    <rect x="84" y="1072" width="912" height="108" rx="18" fill="${colors.paleBlue}"/>
    <text x="110" y="1118" font-size="22" font-weight="700" fill="${colors.blue}">就活への示唆｜${escapeXml(q.insightAxis)}</text>
    ${textBlock(insight, { x: 110, y: 1154, size: 21, lineHeight: 29, color: colors.navy, weight: typography.bodyWeight, maxLines: 2 })}
    ${pageFooterSvg(account, design, sourceIds)}
  `);
}

function qualitativeSvg({ content, account, design }) {
  const { colors, typography } = design;
  const q = content.qualitative;
  const positive = wrapJapanese(q.positiveText, 13);
  const negative = wrapJapanese(q.negativeText, 13);
  const outlook = wrapJapanese(q.outlookText, 27);
  const insight = wrapJapanese(q.studentInsight, 38);
  return baseSvg(design, `
    ${pageHeaderSvg(account, design, "IR｜定性要約", 3)}
    <rect x="54" y="220" width="466" height="470" rx="26" fill="${colors.surface}" stroke="${colors.line}" stroke-width="2"/>
    <rect x="560" y="220" width="466" height="470" rx="26" fill="${colors.surface}" stroke="${colors.line}" stroke-width="2"/>
    <rect x="54" y="220" width="466" height="64" rx="26" fill="${colors.paleBlue}"/>
    <rect x="560" y="220" width="466" height="64" rx="26" fill="#F5F3EF"/>
    <text x="86" y="264" font-size="26" font-weight="700" fill="${colors.blue}">${escapeXml(q.positiveLabel)}</text>
    <text x="592" y="264" font-size="26" font-weight="700" fill="${colors.navy}">${escapeXml(q.negativeLabel)}</text>
    <text x="86" y="352" font-size="38" font-weight="${typography.headlineWeight}" fill="${colors.navy}">${escapeXml(q.positiveTitle)}</text>
    <text x="592" y="352" font-size="38" font-weight="${typography.headlineWeight}" fill="${colors.navy}">${escapeXml(q.negativeTitle)}</text>
    ${textBlock(positive, { x: 86, y: 424, size: 28, lineHeight: 47, color: colors.navy, weight: typography.bodyWeight, maxLines: 5 })}
    ${textBlock(negative, { x: 592, y: 424, size: 28, lineHeight: 47, color: colors.navy, weight: typography.bodyWeight, maxLines: 5 })}
    <rect x="54" y="728" width="972" height="470" rx="26" fill="${colors.surface}" stroke="${colors.line}" stroke-width="2"/>
    <rect x="54" y="728" width="10" height="470" rx="5" fill="${colors.cyan}"/>
    <text x="94" y="808" font-size="27" font-weight="700" fill="${colors.blue}">将来的な見通し</text>
    <text x="94" y="878" font-size="43" font-weight="${typography.headlineWeight}" fill="${colors.navy}">${escapeXml(q.outlookTitle)}</text>
    ${textBlock(outlook, { x: 94, y: 948, size: 26, lineHeight: 40, color: colors.navy, weight: typography.bodyWeight, maxLines: 4 })}
    <rect x="84" y="1078" width="912" height="102" rx="18" fill="${colors.paleBlue}"/>
    <text x="110" y="1120" font-size="22" font-weight="700" fill="${colors.blue}">就活への示唆｜${escapeXml(q.insightAxis)}</text>
    ${textBlock(insight, { x: 110, y: 1155, size: 21, lineHeight: 28, color: colors.navy, weight: typography.bodyWeight, maxLines: 2 })}
    ${pageFooterSvg(account, design, q.sourceIds)}
  `);
}

function tableCellText(value, x, y, width, colors, bold = false) {
  const maxUnits = width < 200 ? 7 : 10;
  const lines = wrapJapanese(value, maxUnits);
  return textBlock(lines, { x, y, size: bold ? 24 : 21, lineHeight: 30, color: colors.navy, weight: bold ? 700 : 400, maxLines: 4, anchor: "middle" });
}

function comparisonSvg({ content, account, design, logos = {} }) {
  const { colors } = design;
  const c = content.comparison;
  const x = [54, 252, 510, 768, 1026];
  const rowTop = 278;
  const headerHeight = 118;
  const rowHeight = 188;
  let table = `<rect x="54" y="${rowTop}" width="972" height="${headerHeight + rowHeight * 4}" rx="22" fill="${colors.surface}" stroke="${colors.line}" stroke-width="2"/>`;
  table += `<rect x="54" y="${rowTop}" width="972" height="${headerHeight}" rx="22" fill="${colors.paleBlue}"/>`;
  table += `<text x="153" y="${rowTop + 72}" font-size="23" font-weight="700" fill="${colors.blue}" text-anchor="middle">比較軸</text>`;
  c.columns.forEach((column, index) => {
    const centerX = 381 + index * 258;
    table += column.entityType === "company"
      ? companyLogoSvg(column.domain, logos, { x: centerX - 92, y: rowTop + 27, width: 184, height: 64 })
      : tableCellText(column.name, centerX, rowTop + 66, 238, colors, true);
  });
  for (let index = 1; index < 5; index += 1) table += `<line x1="54" y1="${rowTop + headerHeight + rowHeight * (index - 1)}" x2="1026" y2="${rowTop + headerHeight + rowHeight * (index - 1)}" stroke="${colors.line}" stroke-width="2"/>`;
  for (let index = 1; index < 4; index += 1) table += `<line x1="${x[index]}" y1="${rowTop}" x2="${x[index]}" y2="${rowTop + headerHeight + rowHeight * 4}" stroke="${colors.line}" stroke-width="2"/>`;
  c.rows.forEach((row, rowIndex) => {
    const cy = rowTop + headerHeight + rowIndex * rowHeight + 67;
    table += tableCellText(row.label, 153, cy, 178, colors, true);
    row.values.forEach((value, colIndex) => { table += tableCellText(value, 381 + colIndex * 258, cy, 238, colors); });
  });
  return baseSvg(design, `
    ${pageHeaderSvg(account, design, "比較｜3社・3業界", 4)}
    <text x="54" y="242" font-size="39" font-weight="500" fill="${colors.navy}">同じ4軸で違いを比較</text>
    ${table}
    ${pageFooterSvg(account, design, c.rows.flatMap((row) => row.sourceIds))}
  `);
}

function ctaSvg({ content, account, design, contentType }) {
  const { colors, typography } = design;
  const type = getContentType(contentType);
  const title = wrapJapanese(content.cta.title, 14);
  const body = wrapJapanese(content.cta.body, 25);
  return baseSvg(design, `
    <rect x="0" y="0" width="1080" height="1350" fill="url(#heroGradient)"/>
    <text x="540" y="104" font-size="38" font-weight="${typography.brandWeight}" fill="${colors.navy}" text-anchor="middle">${escapeXml(account.name)}</text>
    <path d="M454 248 Q454 220 482 220 H598 Q626 220 626 248 V480 L540 425 L454 480 Z" fill="${colors.blue}"/>
    ${textBlock(title, { x: 540, y: 650, size: 64, lineHeight: 84, color: colors.navy, weight: typography.headlineWeight, maxLines: 3, anchor: "middle" })}
    ${textBlock(body, { x: 540, y: 922, size: 31, lineHeight: 50, color: colors.navy, weight: typography.bodyWeight, maxLines: 3, anchor: "middle" })}
    <rect x="186" y="1088" width="708" height="92" rx="46" fill="${colors.blue}"/>
    <text x="540" y="1148" font-size="29" font-weight="700" fill="#FFFFFF" text-anchor="middle">2分でわかる｜${escapeXml(type.footerLabel)}</text>
    <text x="540" y="1270" font-size="23" fill="${colors.muted}" text-anchor="middle">@${escapeXml(account.instagram)}</text>
  `);
}

async function existingPhoto(directory) {
  try { return await fs.readFile(path.join(directory, "cover-photo.jpg")); }
  catch { return null; }
}

async function renderCarousel({ id, topic, contentType, content, account, coverPhoto = null }) {
  const directory = postOutputDirectory(id);
  await fs.mkdir(directory, { recursive: true });
  const design = getDesign(account.designId);
  const photoBuffer = coverPhoto?.buffer || await existingPhoto(directory);
  const logos = await prepareCompanyLogos(content, directory);
  if (coverPhoto?.buffer) await fs.writeFile(path.join(directory, "cover-photo.jpg"), coverPhoto.buffer);
  if (coverPhoto?.metadata) await fs.writeFile(path.join(directory, "photo.json"), `${JSON.stringify(coverPhoto.metadata, null, 2)}\n`);
  const svgs = [
    coverSvg({ topic, content, account, design, contentType, photoBuffer, logos }),
    quantitativeSvg({ content, account, design, logos }),
    qualitativeSvg({ content, account, design }),
    comparisonSvg({ content, account, design, logos }),
    ctaSvg({ content, account, design, contentType })
  ];

  const files = [];
  for (let index = 0; index < svgs.length; index += 1) {
    const fileName = `slide-${String(index + 1).padStart(2, "0")}.png`;
    const filePath = path.join(directory, fileName);
    await sharp(Buffer.from(svgs[index])).png({ compressionLevel: 9 }).toFile(filePath);
    files.push(`/output/${id}/${fileName}`);
  }
  await fs.writeFile(path.join(directory, "content.json"), `${JSON.stringify(content, null, 2)}\n`);
  return files;
}

module.exports = { renderCarousel, wrapJapanese, escapeXml, coverSvg, quantitativeSvg, qualitativeSvg, comparisonSvg, ctaSvg };
