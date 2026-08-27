import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'admin-ui');
const output = path.join(root, 'dist', 'admin-ui');
await rm(output, { recursive: true, force: true });
await mkdir(path.join(output, 'assets'), { recursive: true });

const mappings = {};
for (const name of ['app.js', 'styles.css']) {
  const contents = await readFile(path.join(source, name));
  const extension = path.extname(name);
  const stem = path.basename(name, extension);
  const digest = createHash('sha256').update(contents).digest('hex').slice(0, 12);
  const hashed = `${stem}.${digest}${extension}`;
  await writeFile(path.join(output, 'assets', hashed), contents, { mode: 0o644 });
  mappings[name] = hashed;
}
let index = await readFile(path.join(source, 'index.html'), 'utf8');
index = index
  .replace('__ADMIN_JS__', mappings['app.js'])
  .replace('__ADMIN_CSS__', mappings['styles.css']);
await writeFile(path.join(output, 'index.html'), index, { mode: 0o644 });
