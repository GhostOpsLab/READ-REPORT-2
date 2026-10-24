// Validates site/content/*.json. Run with: npm run check
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "site", "content");
let errors = 0, warnings = 0;
const err = (m) => { errors++; console.error("FOUT:", m); };
const warn = (m) => { warnings++; console.warn("let op:", m); };

const index = JSON.parse(fs.readFileSync(path.join(dir, "index.json"), "utf8"));
const topicIds = new Set(), examIds = new Set(), files = new Set();

for (const ex of index.exams) {
  if (examIds.has(ex.id)) err(`dubbele eksamen-id ${ex.id}`);
  examIds.add(ex.id);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ex.date)) err(`${ex.id}: ongeldige datum`);
  if (!ex.topics || !ex.topics.length) err(`${ex.id}: geen onderwerpe`);
  for (const t of ex.topics || []) {
    if (!/^[a-z0-9-]+$/.test(t.id)) err(`onderwerp-id ${t.id}: slegs a-z, 0-9 en -`);
    if (topicIds.has(t.id)) err(`dubbele onderwerp-id ${t.id}`);
    topicIds.add(t.id);
    if (!t.name) err(`${t.id}: geen naam`);
    if (t.file) {
      if (files.has(t.file)) err(`${t.file} word deur meer as een onderwerp gebruik`);
      files.add(t.file);
      if (!fs.existsSync(path.join(dir, t.file))) err(`${t.id}: lêer ${t.file} bestaan nie`);
    }
  }
}

let withContent = 0;
for (const f of files) {
  const p = path.join(dir, f);
  if (!fs.existsSync(p)) continue;
  withContent++;
  let c;
  try { c = JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { err(`${f}: ${e.message}`); continue; }
  const cardIds = new Set();
  if (!c.cards?.length) err(`${f}: geen kaarte`);
  for (const card of c.cards || []) {
    if (!card.id || cardIds.has(card.id)) err(`${f}: kaart-id ontbreek of is dubbel (${card.id})`);
    cardIds.add(card.id);
    if (!card.title) err(`${f}/${card.id}: geen titel`);
    if (!card.body?.length && !card.points?.length) err(`${f}/${card.id}: geen inhoud`);
    const words = [...(card.body || []), ...(card.points || [])].join(" ").split(/\s+/).length;
    if (words > 90) warn(`${f}/${card.id}: ${words} woorde, hou kaarte kort`);
  }
  const qIds = new Set();
  const qs = c.questions || [];
  if (qs.length < 8) warn(`${f}: net ${qs.length} vrae, mik vir 10 of meer`);
  for (const q of qs) {
    const w = `${f}/${q.id}`;
    if (!q.id || qIds.has(q.id)) err(`${w}: vraag-id ontbreek of is dubbel`);
    qIds.add(q.id);
    if (!q.q) err(`${w}: geen vraag nie`);
    if (!Array.isArray(q.options) || q.options.length < 2) err(`${w}: minstens 2 opsies nodig`);
    else {
      if (new Set(q.options).size !== q.options.length) err(`${w}: dubbele opsies`);
      if (!q.options.includes(q.answer)) err(`${w}: antwoord "${q.answer}" is nie een van die opsies nie`);
    }
    if (!q.hint) err(`${w}: geen wenk nie`);
    if (!q.why) err(`${w}: geen verduideliking nie`);
    for (const t of q.tags || []) if (!cardIds.has(t)) err(`${w}: tag ${t} verwys na 'n kaart wat nie bestaan nie`);
    if (!(q.tags || []).length) warn(`${w}: geen tags nie, so foute kan nie na 'n kaart gelei word nie`);
  }
  if (c.sample) warn(`${f}: is nog voorbeeld-inhoud`);
}

console.log(`${index.exams.length} eksamens, ${topicIds.size} onderwerpe, ${withContent} met inhoud. ${errors} foute, ${warnings} waarskuwings.`);
process.exit(errors ? 1 : 0);
