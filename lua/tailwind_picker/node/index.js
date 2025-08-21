#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--mode') args.mode = argv[++i];
    else if (a === '--project') args.project = argv[++i];
    else if (a === '--config') args.config = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--debug') args.debug = true;
  }
  return args;
}

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

async function checkTailwindVersion(projectDir) {
  try {
    const pkgPath = require.resolve('tailwindcss/package.json', { paths: [projectDir] });
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const version = pkg.version || '';
    if (!version.startsWith('3.')) throw new Error('Tailwind v3 required. Found v' + version);
    return { version, root: path.dirname(pkgPath) };
  } catch (e) {
    throw new Error('Unable to resolve tailwindcss in project (v3 required): ' + e.message);
  }
}

async function compileUtilities(projectDir, configPath, safelist) {
  const tmpDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'twpicker-'));
  const inputCss = path.join(tmpDir, 'input.css');
  const outputCss = path.join(tmpDir, 'output.css');
  const contentHtml = path.join(tmpDir, 'index.html');
  fs.writeFileSync(inputCss, '@tailwind utilities;');
  fs.writeFileSync(contentHtml, `<div class="${safelist.join(' ')}"></div>`);
  const cliPath = require.resolve('tailwindcss/lib/cli.js', { paths: [projectDir] });
  const res = await run(process.execPath, [cliPath, '-i', inputCss, '-o', outputCss, '--config', configPath, '--content', contentHtml], { cwd: projectDir });
  if (res.code !== 0) throw new Error(res.stderr || res.stdout || 'tailwind build failed');
  return fs.readFileSync(outputCss, 'utf8');
}

function sanitizeClassToFilename(cls) {
  return cls.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function extractRulesForClasses(css, classes) {
  const map = {};
  for (const cls of classes) map[cls] = '';
  const blocks = css.split('}');
  for (const block of blocks) {
    const [rawSel, rawBody] = block.split('{');
    if (!rawSel || !rawBody) continue;
    const sel = rawSel.trim();
    const body = rawBody.trim();
    for (const cls of classes) {
      const dot = '.' + cls.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
      const re = new RegExp(`(^|[,\n\r\s])${dot}([\s,{.:#\[]|$)`);
      if (re.test(sel)) map[cls] += body + '\n';
    }
  }
  return map;
}

async function enumerateUtilities(projectDir, configPath) {
  try {
    const tlsPath = require.resolve('tailwindcss-language-service', { paths: [projectDir] });
    const tls = require(tlsPath);
    if (typeof tls.getDefaultState !== 'function') throw new Error('unexpected TLS API');
    const state = tls.getDefaultState();
    if (typeof tls.getClassNames === 'function') {
      const names = Array.from(new Set(tls.getClassNames(state)));
      return expandFlexUtilities(expandSpacingUtilities(names)).sort();
    }
  } catch {}

  const base = [
    'container','sr-only','not-sr-only','visible','invisible','static','fixed','absolute','relative','sticky','block','inline-block','inline','flex','inline-flex','table','inline-table','table-caption','table-cell','table-column','table-column-group','table-footer-group','table-header-group','table-row-group','table-row','flow-root','grid','inline-grid','contents','hidden','float-right','float-left','clear-left','clear-right','clear-both','isolate','isolation-auto','overflow-auto','overflow-hidden','overflow-clip','overflow-visible','overflow-scroll','overscroll-auto','overscroll-contain','overscroll-none','truncate','whitespace-normal','whitespace-nowrap','break-normal','break-words','break-all','rounded','rounded-none','rounded-sm','rounded-md','rounded-lg','rounded-xl','rounded-2xl','rounded-3xl','rounded-full','border','border-0','border-2','border-4','border-8','border-t','border-r','border-b','border-l','bg-inherit','bg-current','bg-transparent','bg-black','bg-white','p-0','p-1','p-2','p-3','p-4','p-5','p-6','p-8','p-10','m-0','m-1','m-2','m-3','m-4','m-5','m-6','m-8','m-10','mt-0','mt-1','mt-2','mt-3','mt-4','mt-5','mt-6','mt-8','mt-10','text-left','text-center','text-right','text-justify','text-xs','text-sm','text-base','text-lg','text-xl','text-2xl','text-3xl','text-4xl','font-sans','font-serif','font-mono','font-thin','font-extralight','font-light','font-normal','font-medium','font-semibold','font-bold','font-extrabold','font-black'
  ];
  return expandFlexUtilities(expandSpacingUtilities(base)).sort();
}

function expandSpacingUtilities(list) {
  const set = new Set(list);
  const spacing = ['0','1','2','3','4','5','6','8','10'];
  const add = (prefix, vals) => vals.forEach(v => set.add(`${prefix}-${v}`));
  const addDirs = (basePrefix, vals) => {
    add(basePrefix, vals);
    ['x','y','t','r','b','l'].forEach(suf => add(basePrefix + suf, vals));
  };
  addDirs('p', spacing);
  addDirs('m', spacing);
  return Array.from(set);
}

function expandFlexUtilities(list) {
  const set = new Set(list);
  ['flex-row', 'flex-row-reverse', 'flex-col', 'flex-col-reverse'].forEach((c) => set.add(c));
  ['flex-wrap', 'flex-wrap-reverse', 'flex-nowrap'].forEach((c) => set.add(c));
  ['flex-1', 'flex-auto', 'flex-initial', 'flex-none'].forEach((c) => set.add(c));
  return Array.from(set);
}

async function buildIndex({ project, config, out, debug }) {
  ensureDir(out);

  const classes = await enumerateUtilities(project, config);

  let css = '';
  let compiled = false;
  try {
    await checkTailwindVersion(project);
    css = await compileUtilities(project, config, classes);
    compiled = !!css;
  } catch (e) {
    if (debug) console.error('Compile failed:', e.message);
  }

  const classToCss = extractRulesForClasses(css || '', classes);

  fs.writeFileSync(path.join(out, 'classes.json'), JSON.stringify(classes, null, 2));
  const fnameMap = {};
  for (const cls of classes) {
    const file = sanitizeClassToFilename(cls) + '.css';
    fnameMap[sanitizeClassToFilename(cls)] = cls;
    fs.writeFileSync(path.join(out, file), (classToCss[cls] || '').trim() + '\n');
  }
  fs.writeFileSync(path.join(out, 'filename-map.json'), JSON.stringify(fnameMap, null, 2));
  fs.writeFileSync(path.join(out, 'meta.json'), JSON.stringify({ compiled }, null, 2));
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.mode !== 'index') {
    console.error('Unsupported mode. Use --mode index');
    process.exit(2);
  }
  if (!args.project || !args.config || !args.out) {
    console.error('--project, --config, and --out are required');
    process.exit(2);
  }
  try {
    await buildIndex(args);
    process.exit(0);
  } catch (e) {
    console.error(e.message || String(e));
    process.exit(1);
  }
}

main();
