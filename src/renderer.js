const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");

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

function textBlock(lines, { x, y, size, lineHeight, color, weight = 700, maxLines = 5 }) {
  return lines.slice(0, maxLines).map((line, index) => (
    `<text x="${x}" y="${y + index * lineHeight}" font-size="${size}" font-weight="${weight}" fill="${color}">${escapeXml(line)}</text>`
  )).join("\n");
}

function baseSvg(account, css, inner) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
    <style>${css} text{font-family:'Noto Sans CJK JP',sans-serif;letter-spacing:0.02em}</style>
    <rect width="1080" height="1350" fill="${account.backgroundColor}"/>
    <circle cx="972" cy="110" r="210" fill="${account.secondaryColor}" opacity="0.9"/>
    <circle cx="82" cy="1280" r="260" fill="${account.primaryColor}" opacity="0.12"/>
    ${inner}
  </svg>`;
}

function coverSvg(content, account, css, total) {
  const hookLines = wrapJapanese(content.hook, 14);
  return baseSvg(account, css, `
    <rect x="76" y="76" width="360" height="66" rx="33" fill="${account.primaryColor}"/>
    <text x="112" y="122" font-size="30" font-weight="700" fill="#FFFFFF">${escapeXml(account.target)}</text>
    ${textBlock(hookLines, { x: 78, y: 430, size: 90, lineHeight: 120, color: account.inkColor, maxLines: 4 })}
    <rect x="78" y="1040" width="924" height="154" rx="36" fill="#FFFFFF" opacity="0.94"/>
    <text x="120" y="1111" font-size="31" font-weight="700" fill="${account.primaryColor}">${escapeXml(account.name)}</text>
    <text x="120" y="1160" font-size="28" font-weight="400" fill="${account.inkColor}">スワイプしてチェック</text>
    <text x="922" y="1160" font-size="28" font-weight="700" fill="${account.inkColor}">1 / ${total}</text>
  `);
}

function bodySvg(slide, account, css, index, total) {
  const titleLines = wrapJapanese(slide.title, 15);
  const bodyLines = wrapJapanese(slide.body, 20);
  return baseSvg(account, css, `
    <text x="78" y="120" font-size="31" font-weight="700" fill="${account.primaryColor}">${escapeXml(slide.eyebrow)}</text>
    ${textBlock(titleLines, { x: 78, y: 350, size: 76, lineHeight: 100, color: account.inkColor, maxLines: 3 })}
    <rect x="78" y="650" width="924" height="370" rx="42" fill="#FFFFFF"/>
    ${textBlock(bodyLines, { x: 126, y: 750, size: 39, lineHeight: 65, color: account.inkColor, weight: 400, maxLines: 5 })}
    <rect x="78" y="1118" width="500" height="6" rx="3" fill="${account.primaryColor}"/>
    <text x="78" y="1192" font-size="28" font-weight="700" fill="${account.inkColor}">${escapeXml(account.name)}</text>
    <text x="922" y="1192" font-size="28" font-weight="700" fill="${account.inkColor}">${index} / ${total}</text>
  `);
}

async function renderCarousel({ id, content, account }) {
  const directory = path.join(process.cwd(), "output", id);
  await fs.mkdir(directory, { recursive: true });
  const css = "";
  const total = content.slides.length + 1;
  const svgs = [coverSvg(content, account, css, total)];
  content.slides.forEach((slide, index) => svgs.push(bodySvg(slide, account, css, index + 2, total)));

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

module.exports = { renderCarousel, wrapJapanese, escapeXml };
