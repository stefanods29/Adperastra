const fs = require('fs');
const path = require('path');
const root = process.cwd();
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}
const files = [
  ...walk(path.join(root, 'src', 'office')),
  ...walk(path.join(root, 'src', 'handlers', 'office')),
  ...walk(path.join(root, 'src', 'services')),
  ...walk(path.join(root, 'src', '__tests__')),
];
console.log('files', files.length);
const targets = new Set(['types', 'OfficeController', 'officeValues', 'presentationTypes', 'OfficeViewport', 'officeAi', 'officeDrafts', 'officeDeck', 'officeSheet']);
const map = new Map();
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const re = /import\s+([\s\S]*?)\s+from\s+["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(src))) {
    const spec = m[2];
    const base = path.resolve(path.dirname(f), spec);
    const stem = path.basename(base);
    if (!targets.has(stem)) continue;
    const rel = path.relative(root, base).replace(/\\/g, '/');
    const names = m[1];
    const brace = names.match(/\{([\s\S]*?)\}/);
    const nlist = brace ? brace[1].split(',').map((s) => s.trim()).filter(Boolean) : [names.trim()];
    if (!map.has(rel)) map.set(rel, new Set());
    for (const n of nlist) map.get(rel).add(n.replace(/^type\s+/, '').replace(/\s+as\s+.*$/, '').trim());
  }
}
for (const [mod, names] of [...map.entries()].sort()) {
  console.log('=== ' + mod + ' (' + names.size + ') ===');
  console.log([...names].sort().join(', '));
}
