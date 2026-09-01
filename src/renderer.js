const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");
const { getDesign } = require("./designs");
const { getContentType } = require("./content-types");

const fontDirectory = path.join(process.cwd(), "node_modules", "noto-fontface-cjk-jp", "fonts", "Noto");
const fontConfigDirectory = path.join(process.cwd(), "data");
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

function footerSvg(design, label) {
  const { colors, typography } = design;
  const footer = design.cover.footer;
  return `
    <rect x="0" y="${footer.y}" width="1080" height="${footer.height}" fill="url(#footerGradient)"/>
    <text x="94" y="1303" font-size="43" font-weight="${typography.brandWeight}" fill="#FFFFFF">2分でわかる</text>
    <text x="984" y="1303" font-size="43" font-weight="${typography.headlineWeight}" fill="#FFFFFF" text-anchor="end">${escapeXml(label)}</text>
    <rect x="0" y="${footer.y}" width="1080" height="2" fill="${colors.cyan}"/>`;
}

function coverSvg({ topic, content, account, design, contentType }) {
  const { colors, typography, cover } = design;
  const type = getContentType(contentType);
  const topicLines = wrapJapanese(topic || content.title, cover.topic.maxUnits);
  const hookLines = wrapJapanese(content.hook, cover.hook.maxUnits);
  return baseSvg(design, `
    <rect x="0" y="0" width="1080" height="140" fill="${colors.surface}"/>
    <text x="${cover.brand.x}" y="${cover.brand.y}" font-size="${cover.brand.fontSize}" font-weight="${typography.brandWeight}" fill="${colors.navy}" text-anchor="${cover.brand.anchor}">${escapeXml(account.name)}</text>
    <rect x="${cover.hero.x}" y="${cover.hero.y}" width="${cover.hero.width}" height="${cover.hero.height}" rx="${cover.hero.radius}" fill="url(#heroGradient)"/>
    <rect x="54" y="158" width="12" height="886" fill="${colors.cyan}"/>
    <text x="76" y="245" font-size="27" font-weight="700" fill="${colors.blue}" letter-spacing="0.12em">${escapeXml(account.target)}｜${escapeXml(type.footerLabel)}</text>
    ${textBlock(topicLines, { x: cover.topic.x, y: cover.topic.y, size: cover.topic.fontSize, lineHeight: cover.topic.lineHeight, color: colors.navy, weight: typography.headlineWeight, maxLines: cover.topic.maxLines })}
    <line x1="76" y1="710" x2="1002" y2="710" stroke="${colors.line}" stroke-width="3"/>
    ${textBlock(hookLines, { x: cover.hook.x, y: cover.hook.y, size: cover.hook.fontSize, lineHeight: cover.hook.lineHeight, color: colors.navy, weight: typography.bodyWeight, maxLines: cover.hook.maxLines })}
    <text x="1002" y="1002" font-size="25" fill="${colors.muted}" text-anchor="end">@${escapeXml(account.instagram)}</text>
    ${footerSvg(design, type.footerLabel)}
  `);
}

function bodySvg({ slide, account, design, contentType, index, total }) {
  const { colors, typography, body } = design;
  const type = getContentType(contentType);
  const titleLines = wrapJapanese(slide.title, body.title.maxUnits);
  const bodyLines = wrapJapanese(slide.body, body.bodyText.maxUnits);
  return baseSvg(design, `
    <rect x="0" y="0" width="1080" height="130" fill="${colors.surface}"/>
    <text x="${body.brand.x}" y="${body.brand.y}" font-size="${body.brand.fontSize}" font-weight="${typography.brandWeight}" fill="${colors.navy}" text-anchor="${body.brand.anchor}">${escapeXml(account.name)}</text>
    <rect x="54" y="154" width="972" height="72" fill="${colors.paleBlue}"/>
    <text x="${body.label.x}" y="${body.label.y}" font-size="${body.label.fontSize}" font-weight="700" fill="${colors.blue}">${escapeXml(slide.eyebrow)}</text>
    <text x="1008" y="${body.label.y}" font-size="24" font-weight="500" fill="${colors.muted}" text-anchor="end">${index} / ${total}</text>
    ${textBlock(titleLines, { x: body.title.x, y: body.title.y, size: body.title.fontSize, lineHeight: body.title.lineHeight, color: colors.navy, weight: typography.headlineWeight, maxLines: body.title.maxLines })}
    <rect x="${body.bodyPanel.x}" y="${body.bodyPanel.y}" width="${body.bodyPanel.width}" height="${body.bodyPanel.height}" rx="${body.bodyPanel.radius}" fill="${colors.surface}" stroke="${colors.line}" stroke-width="2"/>
    <rect x="54" y="610" width="10" height="480" rx="5" fill="${colors.cyan}"/>
    ${textBlock(bodyLines, { x: body.bodyText.x, y: body.bodyText.y, size: body.bodyText.fontSize, lineHeight: body.bodyText.lineHeight, color: colors.navy, weight: typography.bodyWeight, maxLines: body.bodyText.maxLines })}
    <text x="1000" y="1148" font-size="23" fill="${colors.muted}" text-anchor="end">@${escapeXml(account.instagram)}</text>
    ${footerSvg(design, type.footerLabel)}
  `);
}

async function renderCarousel({ id, topic, contentType, content, account }) {
  const directory = path.join(process.cwd(), "output", id);
  await fs.mkdir(directory, { recursive: true });
  const design = getDesign(account.designId);
  const total = content.slides.length + 1;
  const svgs = [coverSvg({ topic, content, account, design, contentType })];
  content.slides.forEach((slide, index) => svgs.push(bodySvg({ slide, account, design, contentType, index: index + 2, total })));

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

module.exports = { renderCarousel, wrapJapanese, escapeXml, coverSvg, bodySvg };
