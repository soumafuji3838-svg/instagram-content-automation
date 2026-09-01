const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const accounts = require("../config/accounts.json");
const { demoContent } = require("../src/generator");
const { renderCarousel } = require("../src/renderer");

async function main() {
  const id = `demo-${crypto.randomBytes(3).toString("hex")}`;
  const account = accounts[0];
  const content = demoContent({ topic: "夏インターンの探し方", targetYear: "28・29卒", account });
  const assets = await renderCarousel({ id, content, account });
  const manifest = { id, content, assets };
  await fs.writeFile(path.join(process.cwd(), "output", id, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify(manifest, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
