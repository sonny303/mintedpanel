// Builds the static wiki site from docs/wiki/*.md.
//
// Zero-dependency markdown renderer covering exactly the subset the wiki
// pages use (h1–h3, unordered lists, tables, bold, inline code, links).
// Output goes to docs/wiki/site/ (the browsable artifact) and is mirrored
// to public/wiki/ so every deploy serves it at /wiki/. Run with:
//   npm run wiki:build

import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = join(root, "docs", "wiki");
const outDirs = [join(srcDir, "site"), join(root, "public", "wiki")];

const NAV = [
  { section: "Walkthroughs", pages: [] },
  { section: "Reference", pages: [] },
];
const PAGE_ORDER = [
  ["README", "Home", 0],
  ["cases", "Cases", 0],
  ["payer-setup", "Payer Setup", 0],
  ["reporting-center", "Reporting Center", 0],
  ["org-detail", "Org Detail", 0],
  ["groups", "Groups", 0],
  ["providers", "Providers", 0],
  ["data-definitions", "Data definitions", 1],
  ["where-did-it-go", "Where did it go?", 1],
];

const escapeHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const italicize = (s) =>
  s
    .split(/(<code>[^<]*<\/code>)/)
    .map((seg) =>
      seg.startsWith("<code>")
        ? seg
        : seg.replace(/(^|[\s(])_([^_<]+)_(?=$|[\s).,;:])/g, "$1<em>$2</em>"),
    )
    .join("");

const inline = (s) =>
  italicize(
    escapeHtml(s)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>"),
  )
    .replace(/\[([^\]]+)\]\(\.\/([\w-]+)\.md\)/g, '<a href="./$2.html">$1</a>')
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" rel="noopener">$1</a>');

const renderMarkdown = (md) => {
  const lines = md.split("\n");
  const out = [];
  let list = false;
  let table = null;
  let para = [];
  const closePara = () => {
    if (para.length > 0) out.push(`<p>${inline(para.join(" "))}</p>`);
    para = [];
  };
  const closeList = () => {
    if (list) out.push("</ul>");
    list = false;
  };
  const closeTable = () => {
    if (table) out.push("</tbody></table>");
    table = null;
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^\|/.test(line)) {
      closePara();
      closeList();
      const cells = line
        .replace(/^\||\|$/g, "")
        .split("|")
        .map((c) => c.trim());
      if (cells.every((c) => /^:?-+:?$/.test(c))) continue;
      if (!table) {
        table = true;
        out.push("<table><thead><tr>");
        out.push(...cells.map((c) => `<th>${inline(c)}</th>`));
        out.push("</tr></thead><tbody>");
      } else {
        out.push(`<tr>${cells.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`);
      }
      continue;
    }
    closeTable();
    const h = /^(#{1,3}) (.*)$/.exec(line);
    if (h) {
      closePara();
      closeList();
      const level = h[1].length;
      out.push(`<h${level}>${inline(h[2])}</h${level}>`);
      continue;
    }
    const li = /^- (.*)$/.exec(line);
    if (li) {
      closePara();
      if (!list) {
        out.push("<ul>");
        list = true;
      }
      out.push(`<li>${inline(li[1])}</li>`);
      continue;
    }
    if (list && /^ {2,}\S/.test(raw)) {
      out[out.length - 1] = out[out.length - 1].replace(/<\/li>$/, ` ${inline(line.trim())}</li>`);
      continue;
    }
    closeList();
    if (line === "") {
      closePara();
      continue;
    }
    para.push(line.trim());
  }
  closePara();
  closeList();
  closeTable();
  // Resolve block-level italics that span a whole (merged) paragraph.
  return out.join("\n").replace(/<p>_(.*)_(\s*)<\/p>/g, "<p><em>$1</em>$2</p>");
};

const CSS = `
* { margin:0; padding:0; box-sizing:border-box; font-family: ui-sans-serif, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
body { background:#FAFAF8; color:#1a1a1a; }
header { background:#1B4D3E; color:#fff; padding:14px 32px; display:flex; align-items:center; gap:12px; }
header .mark { width:22px; height:22px; border:2px solid #fff; border-radius:4px; }
header a { color:#fff; text-decoration:none; font-size:16px; font-weight:600; }
header .crumb { margin-left:auto; font-size:13px; opacity:.8; }
.layout { display:flex; max-width:1180px; margin:0 auto; }
nav { width:250px; padding:28px 20px; border-right:1px solid #E8E5E0; min-height:calc(100vh - 52px); flex-shrink:0; }
nav input { width:100%; padding:8px 10px; border:1px solid #E8E5E0; border-radius:6px; font-size:13px; background:#fff; margin-bottom:20px; }
nav h3 { font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:#8a8a86; margin:18px 0 8px; }
nav a { display:block; padding:6px 10px; font-size:13.5px; color:#3a3a38; text-decoration:none; border-radius:6px; }
nav a.active { background:#1B4D3E; color:#fff; }
nav a.filtered-out { display:none; }
main { flex:1; padding:36px 48px; max-width:780px; min-width:0; }
main h1 { font-size:24px; font-weight:650; margin-bottom:14px; }
main h2 { font-size:17px; font-weight:600; margin:24px 0 8px; }
main h3 { font-size:15px; font-weight:600; margin:18px 0 6px; }
main p, main li { font-size:14px; line-height:1.65; color:#2c2c2a; margin-bottom:10px; }
main ul { padding-left:20px; margin-bottom:12px; }
main li { margin-bottom:4px; }
main code { background:#F0EFEB; border-radius:4px; padding:1px 5px; font-family:ui-monospace,monospace; font-size:12.5px; }
main a { color:#1B4D3E; }
main table { border-collapse:collapse; margin:12px 0 18px; width:100%; }
main th, main td { border:1px solid #E8E5E0; padding:7px 10px; font-size:13px; text-align:left; vertical-align:top; }
main th { background:#F5F4F0; font-weight:600; }
footer.pagefoot { margin-top:34px; padding-top:14px; border-top:1px solid #E8E5E0; display:flex; justify-content:space-between; font-size:13px; }
footer.pagefoot a { color:#1B4D3E; text-decoration:none; }
`;

const SEARCH_JS = `
document.getElementById("wiki-search").addEventListener("input", (e) => {
  const q = e.target.value.toLowerCase();
  document.querySelectorAll("nav a[data-title]").forEach((a) => {
    a.classList.toggle("filtered-out", q !== "" && !a.dataset.title.includes(q));
  });
});
`;

for (const [slug, title, section] of PAGE_ORDER) {
  NAV[section].pages.push({ slug, title });
}

const walkthroughs = PAGE_ORDER.filter(([, , s]) => s === 0).slice(1);

const page = (slug, title, body) => {
  const nav = NAV.map(
    ({ section, pages }) =>
      `<h3>${section}</h3>` +
      pages
        .filter((p) => p.slug !== "README")
        .map(
          (p) =>
            `<a href="./${p.slug}.html" data-title="${p.title.toLowerCase()}"${
              p.slug === slug ? ' class="active"' : ""
            }>${p.title}</a>`,
        )
        .join("\n"),
  ).join("\n");
  const idx = walkthroughs.findIndex(([s]) => s === slug);
  const prev = idx > 0 ? walkthroughs[idx - 1] : null;
  const next = idx >= 0 && idx < walkthroughs.length - 1 ? walkthroughs[idx + 1] : null;
  const foot =
    idx >= 0
      ? `<footer class="pagefoot"><span>${
          prev ? `<a href="./${prev[0]}.html">← ${prev[1]}</a>` : ""
        }</span><span>${next ? `<a href="./${next[0]}.html">${next[1]} →</a>` : ""}</span></footer>`
      : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} — Minted Panel Wiki</title>
<style>${CSS}</style>
</head>
<body>
<header><span class="mark"></span><a href="./index.html">Minted Panel Wiki</a><span class="crumb">built from docs/wiki — npm run wiki:build</span></header>
<div class="layout">
<nav>
<input id="wiki-search" type="search" placeholder="Filter pages…" aria-label="Filter pages">
${nav}
</nav>
<main>
${body}
${foot}
</main>
</div>
<script>${SEARCH_JS}</script>
</body>
</html>
`;
};

for (const dir of outDirs) mkdirSync(dir, { recursive: true });
const sources = readdirSync(srcDir).filter((f) => f.endsWith(".md"));
for (const [slug, title] of PAGE_ORDER) {
  const file = `${slug}.md`;
  if (!sources.includes(file)) {
    throw new Error(`wiki page missing: ${file}`);
  }
  const body = renderMarkdown(readFileSync(join(srcDir, file), "utf8"));
  const outName = slug === "README" ? "index.html" : `${slug}.html`;
  const html = page(slug, title, body);
  for (const dir of outDirs) writeFileSync(join(dir, outName), html);
}
const unknown = sources.filter((f) => !PAGE_ORDER.some(([slug]) => `${slug}.md` === f));
if (unknown.length > 0) {
  throw new Error(
    `wiki pages not registered in scripts/build-wiki-site.mjs PAGE_ORDER: ${unknown.join(", ")}`,
  );
}
process.stdout.write(`wiki site built: ${PAGE_ORDER.length} pages → ${outDirs.join(", ")}\n`);
