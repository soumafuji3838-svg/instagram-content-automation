const fs = require("node:fs/promises");
const path = require("node:path");
const sharp = require("sharp");

function normalizeDomain(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  try {
    const url = new URL(/^https?:\/\//.test(raw) ? raw : `https://${raw}`);
    const hostname = url.hostname.replace(/^www\./, "");
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(hostname)) return "";
    return hostname;
  } catch {
    return "";
  }
}

function safeFileName(domain) {
  return normalizeDomain(domain).replace(/[^a-z0-9.-]/g, "-");
}

async function fetchBuffer(url, { timeout = 10000, maxBytes = 4_000_000 } = {}) {
  const response = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(timeout),
    headers: { "User-Agent": "Mozilla/5.0 Instagram Career Research Studio/0.7" }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > maxBytes) throw new Error("Logo file is too large");
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length || buffer.length > maxBytes) throw new Error("Logo file is empty or too large");
  return { buffer, finalUrl: response.url, contentType: response.headers.get("content-type") || "" };
}

function iconLinks(html, pageUrl) {
  const links = [];
  for (const tag of String(html).match(/<link\b[^>]*>/gi) || []) {
    const rel = tag.match(/\brel\s*=\s*["']([^"']+)["']/i)?.[1] || "";
    if (!/icon/i.test(rel)) continue;
    const href = tag.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!href) continue;
    try { links.push(new URL(href, pageUrl).toString()); } catch { /* ignore malformed link */ }
  }
  return [...new Set(links)];
}

async function normalizeLogo(buffer) {
  return sharp(buffer, { failOn: "none" })
    .resize(240, 96, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 0 } })
    .png()
    .toBuffer();
}

async function fetchOfficialLogo(domain) {
  const normalized = normalizeDomain(domain);
  if (!normalized) return { buffer: null, metadata: { domain: "", status: "not_applicable" } };
  const homepage = `https://${normalized}/`;
  let candidates = [`https://${normalized}/favicon.ico`];
  try {
    const page = await fetchBuffer(homepage, { timeout: 12000, maxBytes: 2_000_000 });
    candidates = [...iconLinks(page.buffer.toString("utf8"), page.finalUrl), ...candidates];
  } catch { /* favicon and domain-based fallback may still work */ }
  candidates.push(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(normalized)}&sz=256`);

  for (const url of [...new Set(candidates)].slice(0, 8)) {
    try {
      const image = await fetchBuffer(url);
      const buffer = await normalizeLogo(image.buffer);
      return { buffer, metadata: { domain: normalized, status: "ready", sourceUrl: image.finalUrl } };
    } catch { /* try the next official icon candidate */ }
  }
  return { buffer: null, metadata: { domain: normalized, status: "failed" } };
}

function logoDomains(content) {
  const subjectDomains = content.subject?.entityType === "company" ? [content.subject.domain] : [];
  const metricDomains = (content.quantitative?.metrics || []).filter((metric) => metric.entityType === "company").map((metric) => metric.companyDomain);
  const comparisonDomains = (content.comparison?.columns || [])
    .filter((column) => column?.entityType === "company")
    .map((column) => column.domain);
  return [...new Set([...subjectDomains, ...metricDomains, ...comparisonDomains].map(normalizeDomain).filter(Boolean))];
}

async function prepareCompanyLogos(content, directory) {
  const logoDirectory = path.join(directory, "logos");
  await fs.mkdir(logoDirectory, { recursive: true });
  const entries = await Promise.all(logoDomains(content).map(async (domain) => {
    const filePath = path.join(logoDirectory, `${safeFileName(domain)}.png`);
    try { return [domain, { buffer: await fs.readFile(filePath), metadata: { domain, status: "cached" } }]; }
    catch { /* download below */ }
    const result = await fetchOfficialLogo(domain);
    if (result.buffer) await fs.writeFile(filePath, result.buffer);
    return [domain, result];
  }));
  const logos = Object.fromEntries(entries);
  await fs.writeFile(path.join(directory, "logos.json"), `${JSON.stringify(Object.fromEntries(entries.map(([domain, result]) => [domain, result.metadata])), null, 2)}\n`);
  return logos;
}

module.exports = { normalizeDomain, iconLinks, fetchOfficialLogo, logoDomains, prepareCompanyLogos };
