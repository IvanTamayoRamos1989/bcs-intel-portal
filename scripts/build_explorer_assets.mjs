// Concatenates the atlas sources (src/explorer/*.js|*.css) into public/explorar/explorer.{js,css}.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const dir = 'src/explorer';
const files = readdirSync(dir).sort();
const js = files.filter(f => f.endsWith('.js')).map(f => readFileSync(join(dir, f), 'utf8')).join('');
const css = files.filter(f => f.endsWith('.css')).map(f => readFileSync(join(dir, f), 'utf8')).join('');
writeFileSync('public/explorar/explorer.js', js);
writeFileSync('public/explorar/explorer.css', css);
console.log(`explorer assets: js ${js.length} B, css ${css.length} B`);
