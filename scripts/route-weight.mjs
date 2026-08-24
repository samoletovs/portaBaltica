// Measures what a reader actually downloads for a route, by walking the static
// import graph in dist/assets from a given entry chunk. Chunk names are not
// stable between builds, so comparing them by eye is unreliable.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'dist/assets';
const files = readdirSync(DIR).filter((name) => name.endsWith('.js'));

const IMPORT = /(?:import|from)\s*["']\.\/([A-Za-z0-9._-]+\.js)["']/g;

function importsOf(file) {
  const source = readFileSync(join(DIR, file), 'utf8');
  return [...new Set([...source.matchAll(IMPORT)].map((match) => match[1]))];
}

function closure(roots) {
  const seen = new Set();
  const queue = [...roots];
  while (queue.length > 0) {
    const file = queue.pop();
    if (!file || seen.has(file)) continue;
    if (!files.includes(file)) continue;
    seen.add(file);
    queue.push(...importsOf(file));
  }
  return seen;
}

function find(prefix) {
  return files.filter((name) => name.startsWith(prefix));
}

const entry = find('index-');
const routes = {
  '/ (news feed)': [...entry, ...find('NewsFeed-')],
  '/article/:slug': [...entry, ...find('ArticlePage-')],
  '/about/ai': [...entry, ...find('AiPolicyPage-')],
  '/corrections': [...entry, ...find('CorrectionsPage-')],
  '/data (dashboard)': [...entry, ...find('App-')],
};

for (const [route, roots] of Object.entries(routes)) {
  const reachable = closure(roots);
  const bytes = [...reachable].reduce((total, file) => total + statSync(join(DIR, file)).size, 0);
  const hasCharts = [...reachable].some((file) => file.startsWith('charts-'));
  const hasMarkdown = [...reachable].some((file) =>
    readFileSync(join(DIR, file), 'utf8').includes('list-decimal'),
  );
  console.log(
    `${route.padEnd(20)} ${(bytes / 1024).toFixed(1).padStart(7)} kB  chunks=${String(reachable.size).padStart(2)}  charts=${hasCharts}  markdown=${hasMarkdown}`,
  );
}
