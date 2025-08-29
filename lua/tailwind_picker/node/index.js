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
    // Layout
    'container','aspect-auto','aspect-square','aspect-video',
    
    // Visibility
    'visible','invisible','sr-only','not-sr-only',
    
    // Position
    'static','fixed','absolute','relative','sticky',
    'inset-0','inset-x-0','inset-y-0','top-0','right-0','bottom-0','left-0',
    'top-1','right-1','bottom-1','left-1','top-2','right-2','bottom-2','left-2',
    'top-4','right-4','bottom-4','left-4','top-8','right-8','bottom-8','left-8',
    
    // Display
    'block','inline-block','inline','flex','inline-flex','table','inline-table',
    'table-caption','table-cell','table-column','table-column-group',
    'table-footer-group','table-header-group','table-row-group','table-row',
    'flow-root','grid','inline-grid','contents','list-item','hidden',
    
    // Flexbox & Grid
    'flex-row','flex-row-reverse','flex-col','flex-col-reverse',
    'flex-wrap','flex-wrap-reverse','flex-nowrap',
    'flex-1','flex-auto','flex-initial','flex-none',
    'grow','grow-0','shrink','shrink-0',
    'justify-start','justify-end','justify-center','justify-between','justify-around','justify-evenly',
    'items-start','items-end','items-center','items-baseline','items-stretch',
    'content-start','content-end','content-center','content-between','content-around','content-evenly',
    'self-auto','self-start','self-end','self-center','self-stretch','self-baseline',
    'grid-cols-1','grid-cols-2','grid-cols-3','grid-cols-4','grid-cols-5','grid-cols-6',
    'grid-cols-7','grid-cols-8','grid-cols-9','grid-cols-10','grid-cols-11','grid-cols-12',
    'col-auto','col-span-1','col-span-2','col-span-3','col-span-4','col-span-5','col-span-6',
    'grid-rows-1','grid-rows-2','grid-rows-3','grid-rows-4','grid-rows-5','grid-rows-6',
    'row-auto','row-span-1','row-span-2','row-span-3','row-span-4','row-span-5','row-span-6',
    'gap-0','gap-1','gap-2','gap-3','gap-4','gap-5','gap-6','gap-8','gap-10','gap-12',
    'gap-x-0','gap-x-1','gap-x-2','gap-x-3','gap-x-4','gap-x-5','gap-x-6','gap-x-8',
    'gap-y-0','gap-y-1','gap-y-2','gap-y-3','gap-y-4','gap-y-5','gap-y-6','gap-y-8',
    
    // Spacing - Padding
    'p-0','p-px','p-0.5','p-1','p-1.5','p-2','p-2.5','p-3','p-3.5','p-4','p-5','p-6','p-7','p-8','p-9','p-10','p-11','p-12','p-14','p-16','p-20','p-24','p-28','p-32','p-36','p-40','p-44','p-48','p-52','p-56','p-60','p-64','p-72','p-80','p-96',
    'px-0','px-px','px-0.5','px-1','px-1.5','px-2','px-2.5','px-3','px-3.5','px-4','px-5','px-6','px-7','px-8','px-9','px-10','px-11','px-12','px-14','px-16','px-20','px-24','px-28','px-32','px-36','px-40','px-44','px-48','px-52','px-56','px-60','px-64','px-72','px-80','px-96',
    'py-0','py-px','py-0.5','py-1','py-1.5','py-2','py-2.5','py-3','py-3.5','py-4','py-5','py-6','py-7','py-8','py-9','py-10','py-11','py-12','py-14','py-16','py-20','py-24','py-28','py-32','py-36','py-40','py-44','py-48','py-52','py-56','py-60','py-64','py-72','py-80','py-96',
    'pt-0','pt-px','pt-0.5','pt-1','pt-1.5','pt-2','pt-2.5','pt-3','pt-3.5','pt-4','pt-5','pt-6','pt-7','pt-8','pt-9','pt-10','pt-11','pt-12','pt-14','pt-16','pt-20','pt-24','pt-28','pt-32','pt-36','pt-40','pt-44','pt-48','pt-52','pt-56','pt-60','pt-64','pt-72','pt-80','pt-96',
    'pr-0','pr-px','pr-0.5','pr-1','pr-1.5','pr-2','pr-2.5','pr-3','pr-3.5','pr-4','pr-5','pr-6','pr-7','pr-8','pr-9','pr-10','pr-11','pr-12','pr-14','pr-16','pr-20','pr-24','pr-28','pr-32','pr-36','pr-40','pr-44','pr-48','pr-52','pr-56','pr-60','pr-64','pr-72','pr-80','pr-96',
    'pb-0','pb-px','pb-0.5','pb-1','pb-1.5','pb-2','pb-2.5','pb-3','pb-3.5','pb-4','pb-5','pb-6','pb-7','pb-8','pb-9','pb-10','pb-11','pb-12','pb-14','pb-16','pb-20','pb-24','pb-28','pb-32','pb-36','pb-40','pb-44','pb-48','pb-52','pb-56','pb-60','pb-64','pb-72','pb-80','pb-96',
    'pl-0','pl-px','pl-0.5','pl-1','pl-1.5','pl-2','pl-2.5','pl-3','pl-3.5','pl-4','pl-5','pl-6','pl-7','pl-8','pl-9','pl-10','pl-11','pl-12','pl-14','pl-16','pl-20','pl-24','pl-28','pl-32','pl-36','pl-40','pl-44','pl-48','pl-52','pl-56','pl-60','pl-64','pl-72','pl-80','pl-96',
    
    // Spacing - Margin
    'm-0','m-px','m-0.5','m-1','m-1.5','m-2','m-2.5','m-3','m-3.5','m-4','m-5','m-6','m-7','m-8','m-9','m-10','m-11','m-12','m-14','m-16','m-20','m-24','m-28','m-32','m-36','m-40','m-44','m-48','m-52','m-56','m-60','m-64','m-72','m-80','m-96','m-auto',
    'mx-0','mx-px','mx-0.5','mx-1','mx-1.5','mx-2','mx-2.5','mx-3','mx-3.5','mx-4','mx-5','mx-6','mx-7','mx-8','mx-9','mx-10','mx-11','mx-12','mx-14','mx-16','mx-20','mx-24','mx-28','mx-32','mx-36','mx-40','mx-44','mx-48','mx-52','mx-56','mx-60','mx-64','mx-72','mx-80','mx-96','mx-auto',
    'my-0','my-px','my-0.5','my-1','my-1.5','my-2','my-2.5','my-3','my-3.5','my-4','my-5','my-6','my-7','my-8','my-9','my-10','my-11','my-12','my-14','my-16','my-20','my-24','my-28','my-32','my-36','my-40','my-44','my-48','my-52','my-56','my-60','my-64','my-72','my-80','my-96','my-auto',
    'mt-0','mt-px','mt-0.5','mt-1','mt-1.5','mt-2','mt-2.5','mt-3','mt-3.5','mt-4','mt-5','mt-6','mt-7','mt-8','mt-9','mt-10','mt-11','mt-12','mt-14','mt-16','mt-20','mt-24','mt-28','mt-32','mt-36','mt-40','mt-44','mt-48','mt-52','mt-56','mt-60','mt-64','mt-72','mt-80','mt-96','mt-auto',
    'mr-0','mr-px','mr-0.5','mr-1','mr-1.5','mr-2','mr-2.5','mr-3','mr-3.5','mr-4','mr-5','mr-6','mr-7','mr-8','mr-9','mr-10','mr-11','mr-12','mr-14','mr-16','mr-20','mr-24','mr-28','mr-32','mr-36','mr-40','mr-44','mr-48','mr-52','mr-56','mr-60','mr-64','mr-72','mr-80','mr-96','mr-auto',
    'mb-0','mb-px','mb-0.5','mb-1','mb-1.5','mb-2','mb-2.5','mb-3','mb-3.5','mb-4','mb-5','mb-6','mb-7','mb-8','mb-9','mb-10','mb-11','mb-12','mb-14','mb-16','mb-20','mb-24','mb-28','mb-32','mb-36','mb-40','mb-44','mb-48','mb-52','mb-56','mb-60','mb-64','mb-72','mb-80','mb-96','mb-auto',
    'ml-0','ml-px','ml-0.5','ml-1','ml-1.5','ml-2','ml-2.5','ml-3','ml-3.5','ml-4','ml-5','ml-6','ml-7','ml-8','ml-9','ml-10','ml-11','ml-12','ml-14','ml-16','ml-20','ml-24','ml-28','ml-32','ml-36','ml-40','ml-44','ml-48','ml-52','ml-56','ml-60','ml-64','ml-72','ml-80','ml-96','ml-auto',
    
    // Sizing
    'w-0','w-px','w-0.5','w-1','w-1.5','w-2','w-2.5','w-3','w-3.5','w-4','w-5','w-6','w-7','w-8','w-9','w-10','w-11','w-12','w-14','w-16','w-20','w-24','w-28','w-32','w-36','w-40','w-44','w-48','w-52','w-56','w-60','w-64','w-72','w-80','w-96',
    'w-auto','w-1/2','w-1/3','w-2/3','w-1/4','w-2/4','w-3/4','w-1/5','w-2/5','w-3/5','w-4/5','w-1/6','w-2/6','w-3/6','w-4/6','w-5/6',
    'w-full','w-screen','w-min','w-max','w-fit',
    'max-w-0','max-w-none','max-w-xs','max-w-sm','max-w-md','max-w-lg','max-w-xl','max-w-2xl','max-w-3xl','max-w-4xl','max-w-5xl','max-w-6xl','max-w-7xl',
    'max-w-full','max-w-min','max-w-max','max-w-fit','max-w-prose','max-w-screen-sm','max-w-screen-md','max-w-screen-lg','max-w-screen-xl','max-w-screen-2xl',
    'min-w-0','min-w-full','min-w-min','min-w-max','min-w-fit',
    'h-0','h-px','h-0.5','h-1','h-1.5','h-2','h-2.5','h-3','h-3.5','h-4','h-5','h-6','h-7','h-8','h-9','h-10','h-11','h-12','h-14','h-16','h-20','h-24','h-28','h-32','h-36','h-40','h-44','h-48','h-52','h-56','h-60','h-64','h-72','h-80','h-96',
    'h-auto','h-1/2','h-1/3','h-2/3','h-1/4','h-2/4','h-3/4','h-1/5','h-2/5','h-3/5','h-4/5','h-1/6','h-2/6','h-3/6','h-4/6','h-5/6',
    'h-full','h-screen','h-min','h-max','h-fit',
    'max-h-0','max-h-px','max-h-0.5','max-h-1','max-h-1.5','max-h-2','max-h-2.5','max-h-3','max-h-3.5','max-h-4','max-h-5','max-h-6','max-h-7','max-h-8','max-h-9','max-h-10','max-h-11','max-h-12','max-h-14','max-h-16','max-h-20','max-h-24','max-h-28','max-h-32','max-h-36','max-h-40','max-h-44','max-h-48','max-h-52','max-h-56','max-h-60','max-h-64','max-h-72','max-h-80','max-h-96',
    'max-h-full','max-h-screen','max-h-min','max-h-max','max-h-fit',
    'min-h-0','min-h-full','min-h-screen','min-h-min','min-h-max','min-h-fit',
    
    // Typography
    'font-sans','font-serif','font-mono',
    'text-xs','text-sm','text-base','text-lg','text-xl','text-2xl','text-3xl','text-4xl','text-5xl','text-6xl','text-7xl','text-8xl','text-9xl',
    'font-thin','font-extralight','font-light','font-normal','font-medium','font-semibold','font-bold','font-extrabold','font-black',
    'italic','not-italic',
    'uppercase','lowercase','capitalize','normal-case',
    'underline','overline','line-through','no-underline',
    'text-left','text-center','text-right','text-justify','text-start','text-end',
    'align-baseline','align-top','align-middle','align-bottom','align-text-top','align-text-bottom','align-sub','align-super',
    'whitespace-normal','whitespace-nowrap','whitespace-pre','whitespace-pre-line','whitespace-pre-wrap','whitespace-break-spaces',
    'break-normal','break-words','break-all','break-keep',
    'leading-3','leading-4','leading-5','leading-6','leading-7','leading-8','leading-9','leading-10',
    'leading-none','leading-tight','leading-snug','leading-normal','leading-relaxed','leading-loose',
    'tracking-tighter','tracking-tight','tracking-normal','tracking-wide','tracking-wider','tracking-widest',
    'indent-0','indent-px','indent-0.5','indent-1','indent-1.5','indent-2','indent-2.5','indent-3','indent-3.5','indent-4','indent-5','indent-6','indent-7','indent-8',
    
    // Text Colors
    'text-inherit','text-current','text-transparent','text-black','text-white',
    'text-slate-50','text-slate-100','text-slate-200','text-slate-300','text-slate-400','text-slate-500','text-slate-600','text-slate-700','text-slate-800','text-slate-900','text-slate-950',
    'text-gray-50','text-gray-100','text-gray-200','text-gray-300','text-gray-400','text-gray-500','text-gray-600','text-gray-700','text-gray-800','text-gray-900','text-gray-950',
    'text-zinc-50','text-zinc-100','text-zinc-200','text-zinc-300','text-zinc-400','text-zinc-500','text-zinc-600','text-zinc-700','text-zinc-800','text-zinc-900','text-zinc-950',
    'text-neutral-50','text-neutral-100','text-neutral-200','text-neutral-300','text-neutral-400','text-neutral-500','text-neutral-600','text-neutral-700','text-neutral-800','text-neutral-900','text-neutral-950',
    'text-stone-50','text-stone-100','text-stone-200','text-stone-300','text-stone-400','text-stone-500','text-stone-600','text-stone-700','text-stone-800','text-stone-900','text-stone-950',
    'text-red-50','text-red-100','text-red-200','text-red-300','text-red-400','text-red-500','text-red-600','text-red-700','text-red-800','text-red-900','text-red-950',
    'text-orange-50','text-orange-100','text-orange-200','text-orange-300','text-orange-400','text-orange-500','text-orange-600','text-orange-700','text-orange-800','text-orange-900','text-orange-950',
    'text-amber-50','text-amber-100','text-amber-200','text-amber-300','text-amber-400','text-amber-500','text-amber-600','text-amber-700','text-amber-800','text-amber-900','text-amber-950',
    'text-yellow-50','text-yellow-100','text-yellow-200','text-yellow-300','text-yellow-400','text-yellow-500','text-yellow-600','text-yellow-700','text-yellow-800','text-yellow-900','text-yellow-950',
    'text-lime-50','text-lime-100','text-lime-200','text-lime-300','text-lime-400','text-lime-500','text-lime-600','text-lime-700','text-lime-800','text-lime-900','text-lime-950',
    'text-green-50','text-green-100','text-green-200','text-green-300','text-green-400','text-green-500','text-green-600','text-green-700','text-green-800','text-green-900','text-green-950',
    'text-emerald-50','text-emerald-100','text-emerald-200','text-emerald-300','text-emerald-400','text-emerald-500','text-emerald-600','text-emerald-700','text-emerald-800','text-emerald-900','text-emerald-950',
    'text-teal-50','text-teal-100','text-teal-200','text-teal-300','text-teal-400','text-teal-500','text-teal-600','text-teal-700','text-teal-800','text-teal-900','text-teal-950',
    'text-cyan-50','text-cyan-100','text-cyan-200','text-cyan-300','text-cyan-400','text-cyan-500','text-cyan-600','text-cyan-700','text-cyan-800','text-cyan-900','text-cyan-950',
    'text-sky-50','text-sky-100','text-sky-200','text-sky-300','text-sky-400','text-sky-500','text-sky-600','text-sky-700','text-sky-800','text-sky-900','text-sky-950',
    'text-blue-50','text-blue-100','text-blue-200','text-blue-300','text-blue-400','text-blue-500','text-blue-600','text-blue-700','text-blue-800','text-blue-900','text-blue-950',
    'text-indigo-50','text-indigo-100','text-indigo-200','text-indigo-300','text-indigo-400','text-indigo-500','text-indigo-600','text-indigo-700','text-indigo-800','text-indigo-900','text-indigo-950',
    'text-violet-50','text-violet-100','text-violet-200','text-violet-300','text-violet-400','text-violet-500','text-violet-600','text-violet-700','text-violet-800','text-violet-900','text-violet-950',
    'text-purple-50','text-purple-100','text-purple-200','text-purple-300','text-purple-400','text-purple-500','text-purple-600','text-purple-700','text-purple-800','text-purple-900','text-purple-950',
    'text-fuchsia-50','text-fuchsia-100','text-fuchsia-200','text-fuchsia-300','text-fuchsia-400','text-fuchsia-500','text-fuchsia-600','text-fuchsia-700','text-fuchsia-800','text-fuchsia-900','text-fuchsia-950',
    'text-pink-50','text-pink-100','text-pink-200','text-pink-300','text-pink-400','text-pink-500','text-pink-600','text-pink-700','text-pink-800','text-pink-900','text-pink-950',
    'text-rose-50','text-rose-100','text-rose-200','text-rose-300','text-rose-400','text-rose-500','text-rose-600','text-rose-700','text-rose-800','text-rose-900','text-rose-950',
    
    // Background Colors
    'bg-inherit','bg-current','bg-transparent','bg-black','bg-white',
    'bg-slate-50','bg-slate-100','bg-slate-200','bg-slate-300','bg-slate-400','bg-slate-500','bg-slate-600','bg-slate-700','bg-slate-800','bg-slate-900','bg-slate-950',
    'bg-gray-50','bg-gray-100','bg-gray-200','bg-gray-300','bg-gray-400','bg-gray-500','bg-gray-600','bg-gray-700','bg-gray-800','bg-gray-900','bg-gray-950',
    'bg-zinc-50','bg-zinc-100','bg-zinc-200','bg-zinc-300','bg-zinc-400','bg-zinc-500','bg-zinc-600','bg-zinc-700','bg-zinc-800','bg-zinc-900','bg-zinc-950',
    'bg-neutral-50','bg-neutral-100','bg-neutral-200','bg-neutral-300','bg-neutral-400','bg-neutral-500','bg-neutral-600','bg-neutral-700','bg-neutral-800','bg-neutral-900','bg-neutral-950',
    'bg-stone-50','bg-stone-100','bg-stone-200','bg-stone-300','bg-stone-400','bg-stone-500','bg-stone-600','bg-stone-700','bg-stone-800','bg-stone-900','bg-stone-950',
    'bg-red-50','bg-red-100','bg-red-200','bg-red-300','bg-red-400','bg-red-500','bg-red-600','bg-red-700','bg-red-800','bg-red-900','bg-red-950',
    'bg-orange-50','bg-orange-100','bg-orange-200','bg-orange-300','bg-orange-400','bg-orange-500','bg-orange-600','bg-orange-700','bg-orange-800','bg-orange-900','bg-orange-950',
    'bg-amber-50','bg-amber-100','bg-amber-200','bg-amber-300','bg-amber-400','bg-amber-500','bg-amber-600','bg-amber-700','bg-amber-800','bg-amber-900','bg-amber-950',
    'bg-yellow-50','bg-yellow-100','bg-yellow-200','bg-yellow-300','bg-yellow-400','bg-yellow-500','bg-yellow-600','bg-yellow-700','bg-yellow-800','bg-yellow-900','bg-yellow-950',
    'bg-lime-50','bg-lime-100','bg-lime-200','bg-lime-300','bg-lime-400','bg-lime-500','bg-lime-600','bg-lime-700','bg-lime-800','bg-lime-900','bg-lime-950',
    'bg-green-50','bg-green-100','bg-green-200','bg-green-300','bg-green-400','bg-green-500','bg-green-600','bg-green-700','bg-green-800','bg-green-900','bg-green-950',
    'bg-emerald-50','bg-emerald-100','bg-emerald-200','bg-emerald-300','bg-emerald-400','bg-emerald-500','bg-emerald-600','bg-emerald-700','bg-emerald-800','bg-emerald-900','bg-emerald-950',
    'bg-teal-50','bg-teal-100','bg-teal-200','bg-teal-300','bg-teal-400','bg-teal-500','bg-teal-600','bg-teal-700','bg-teal-800','bg-teal-900','bg-teal-950',
    'bg-cyan-50','bg-cyan-100','bg-cyan-200','bg-cyan-300','bg-cyan-400','bg-cyan-500','bg-cyan-600','bg-cyan-700','bg-cyan-800','bg-cyan-900','bg-cyan-950',
    'bg-sky-50','bg-sky-100','bg-sky-200','bg-sky-300','bg-sky-400','bg-sky-500','bg-sky-600','bg-sky-700','bg-sky-800','bg-sky-900','bg-sky-950',
    'bg-blue-50','bg-blue-100','bg-blue-200','bg-blue-300','bg-blue-400','bg-blue-500','bg-blue-600','bg-blue-700','bg-blue-800','bg-blue-900','bg-blue-950',
    'bg-indigo-50','bg-indigo-100','bg-indigo-200','bg-indigo-300','bg-indigo-400','bg-indigo-500','bg-indigo-600','bg-indigo-700','bg-indigo-800','bg-indigo-900','bg-indigo-950',
    'bg-violet-50','bg-violet-100','bg-violet-200','bg-violet-300','bg-violet-400','bg-violet-500','bg-violet-600','bg-violet-700','bg-violet-800','bg-violet-900','bg-violet-950',
    'bg-purple-50','bg-purple-100','bg-purple-200','bg-purple-300','bg-purple-400','bg-purple-500','bg-purple-600','bg-purple-700','bg-purple-800','bg-purple-900','bg-purple-950',
    'bg-fuchsia-50','bg-fuchsia-100','bg-fuchsia-200','bg-fuchsia-300','bg-fuchsia-400','bg-fuchsia-500','bg-fuchsia-600','bg-fuchsia-700','bg-fuchsia-800','bg-fuchsia-900','bg-fuchsia-950',
    'bg-pink-50','bg-pink-100','bg-pink-200','bg-pink-300','bg-pink-400','bg-pink-500','bg-pink-600','bg-pink-700','bg-pink-800','bg-pink-900','bg-pink-950',
    'bg-rose-50','bg-rose-100','bg-rose-200','bg-rose-300','bg-rose-400','bg-rose-500','bg-rose-600','bg-rose-700','bg-rose-800','bg-rose-900','bg-rose-950',
    
    // Border
    'border-0','border','border-2','border-4','border-8',
    'border-x-0','border-x','border-x-2','border-x-4','border-x-8',
    'border-y-0','border-y','border-y-2','border-y-4','border-y-8',
    'border-t-0','border-t','border-t-2','border-t-4','border-t-8',
    'border-r-0','border-r','border-r-2','border-r-4','border-r-8',
    'border-b-0','border-b','border-b-2','border-b-4','border-b-8',
    'border-l-0','border-l','border-l-2','border-l-4','border-l-8',
    'border-solid','border-dashed','border-dotted','border-double','border-hidden','border-none',
    'border-inherit','border-current','border-transparent','border-black','border-white',
    'border-slate-50','border-slate-100','border-slate-200','border-slate-300','border-slate-400','border-slate-500','border-slate-600','border-slate-700','border-slate-800','border-slate-900','border-slate-950',
    'border-gray-50','border-gray-100','border-gray-200','border-gray-300','border-gray-400','border-gray-500','border-gray-600','border-gray-700','border-gray-800','border-gray-900','border-gray-950',
    'border-red-50','border-red-100','border-red-200','border-red-300','border-red-400','border-red-500','border-red-600','border-red-700','border-red-800','border-red-900','border-red-950',
    'border-blue-50','border-blue-100','border-blue-200','border-blue-300','border-blue-400','border-blue-500','border-blue-600','border-blue-700','border-blue-800','border-blue-900','border-blue-950',
    'border-green-50','border-green-100','border-green-200','border-green-300','border-green-400','border-green-500','border-green-600','border-green-700','border-green-800','border-green-900','border-green-950',
    
    // Border Radius
    'rounded-none','rounded-sm','rounded','rounded-md','rounded-lg','rounded-xl','rounded-2xl','rounded-3xl','rounded-full',
    'rounded-t-none','rounded-t-sm','rounded-t','rounded-t-md','rounded-t-lg','rounded-t-xl','rounded-t-2xl','rounded-t-3xl','rounded-t-full',
    'rounded-r-none','rounded-r-sm','rounded-r','rounded-r-md','rounded-r-lg','rounded-r-xl','rounded-r-2xl','rounded-r-3xl','rounded-r-full',
    'rounded-b-none','rounded-b-sm','rounded-b','rounded-b-md','rounded-b-lg','rounded-b-xl','rounded-b-2xl','rounded-b-3xl','rounded-b-full',
    'rounded-l-none','rounded-l-sm','rounded-l','rounded-l-md','rounded-l-lg','rounded-l-xl','rounded-l-2xl','rounded-l-3xl','rounded-l-full',
    'rounded-tl-none','rounded-tl-sm','rounded-tl','rounded-tl-md','rounded-tl-lg','rounded-tl-xl','rounded-tl-2xl','rounded-tl-3xl','rounded-tl-full',
    'rounded-tr-none','rounded-tr-sm','rounded-tr','rounded-tr-md','rounded-tr-lg','rounded-tr-xl','rounded-tr-2xl','rounded-tr-3xl','rounded-tr-full',
    'rounded-br-none','rounded-br-sm','rounded-br','rounded-br-md','rounded-br-lg','rounded-br-xl','rounded-br-2xl','rounded-br-3xl','rounded-br-full',
    'rounded-bl-none','rounded-bl-sm','rounded-bl','rounded-bl-md','rounded-bl-lg','rounded-bl-xl','rounded-bl-2xl','rounded-bl-3xl','rounded-bl-full',
    
    // Effects
    'shadow-sm','shadow','shadow-md','shadow-lg','shadow-xl','shadow-2xl','shadow-inner','shadow-none',
    'opacity-0','opacity-5','opacity-10','opacity-20','opacity-25','opacity-30','opacity-40','opacity-50','opacity-60','opacity-70','opacity-75','opacity-80','opacity-90','opacity-95','opacity-100',
    'blur-none','blur-sm','blur','blur-md','blur-lg','blur-xl','blur-2xl','blur-3xl',
    
    // Overflow
    'overflow-auto','overflow-hidden','overflow-clip','overflow-visible','overflow-scroll',
    'overflow-x-auto','overflow-x-hidden','overflow-x-clip','overflow-x-visible','overflow-x-scroll',
    'overflow-y-auto','overflow-y-hidden','overflow-y-clip','overflow-y-visible','overflow-y-scroll',
    'overscroll-auto','overscroll-contain','overscroll-none',
    'overscroll-x-auto','overscroll-x-contain','overscroll-x-none',
    'overscroll-y-auto','overscroll-y-contain','overscroll-y-none',
    
    // Interactivity
    'cursor-auto','cursor-default','cursor-pointer','cursor-wait','cursor-text','cursor-move','cursor-help','cursor-not-allowed','cursor-none','cursor-context-menu','cursor-progress','cursor-cell','cursor-crosshair','cursor-vertical-text','cursor-alias','cursor-copy','cursor-no-drop','cursor-grab','cursor-grabbing','cursor-all-scroll','cursor-col-resize','cursor-row-resize','cursor-n-resize','cursor-e-resize','cursor-s-resize','cursor-w-resize','cursor-ne-resize','cursor-nw-resize','cursor-se-resize','cursor-sw-resize','cursor-ew-resize','cursor-ns-resize','cursor-nesw-resize','cursor-nwse-resize','cursor-zoom-in','cursor-zoom-out',
    'select-none','select-text','select-all','select-auto',
    'pointer-events-none','pointer-events-auto',
    
    // Transitions & Animation
    'transition-none','transition-all','transition','transition-colors','transition-opacity','transition-shadow','transition-transform',
    'duration-75','duration-100','duration-150','duration-200','duration-300','duration-500','duration-700','duration-1000',
    'ease-linear','ease-in','ease-out','ease-in-out',
    'animate-none','animate-spin','animate-ping','animate-pulse','animate-bounce',
    
    // Transforms
    'transform','transform-cpu','transform-gpu','transform-none',
    'scale-0','scale-50','scale-75','scale-90','scale-95','scale-100','scale-105','scale-110','scale-125','scale-150',
    'scale-x-0','scale-x-50','scale-x-75','scale-x-90','scale-x-95','scale-x-100','scale-x-105','scale-x-110','scale-x-125','scale-x-150',
    'scale-y-0','scale-y-50','scale-y-75','scale-y-90','scale-y-95','scale-y-100','scale-y-105','scale-y-110','scale-y-125','scale-y-150',
    'rotate-0','rotate-1','rotate-2','rotate-3','rotate-6','rotate-12','rotate-45','rotate-90','rotate-180',
    'translate-x-0','translate-x-px','translate-x-0.5','translate-x-1','translate-x-1.5','translate-x-2','translate-x-2.5','translate-x-3','translate-x-3.5','translate-x-4','translate-x-5','translate-x-6','translate-x-7','translate-x-8','translate-x-9','translate-x-10','translate-x-11','translate-x-12','translate-x-14','translate-x-16','translate-x-20','translate-x-24','translate-x-28','translate-x-32','translate-x-36','translate-x-40','translate-x-44','translate-x-48','translate-x-52','translate-x-56','translate-x-60','translate-x-64','translate-x-72','translate-x-80','translate-x-96',
    'translate-y-0','translate-y-px','translate-y-0.5','translate-y-1','translate-y-1.5','translate-y-2','translate-y-2.5','translate-y-3','translate-y-3.5','translate-y-4','translate-y-5','translate-y-6','translate-y-7','translate-y-8','translate-y-9','translate-y-10','translate-y-11','translate-y-12','translate-y-14','translate-y-16','translate-y-20','translate-y-24','translate-y-28','translate-y-32','translate-y-36','translate-y-40','translate-y-44','translate-y-48','translate-y-52','translate-y-56','translate-y-60','translate-y-64','translate-y-72','translate-y-80','translate-y-96',
    'skew-x-0','skew-x-1','skew-x-2','skew-x-3','skew-x-6','skew-x-12',
    'skew-y-0','skew-y-1','skew-y-2','skew-y-3','skew-y-6','skew-y-12',
    
    // Filters
    'blur-none','blur-sm','blur','blur-md','blur-lg','blur-xl','blur-2xl','blur-3xl',
    'brightness-0','brightness-50','brightness-75','brightness-90','brightness-95','brightness-100','brightness-105','brightness-110','brightness-125','brightness-150','brightness-200',
    'contrast-0','contrast-50','contrast-75','contrast-100','contrast-125','contrast-150','contrast-200',
    'grayscale-0','grayscale','sepia-0','sepia',
    'invert-0','invert','hue-rotate-0','hue-rotate-15','hue-rotate-30','hue-rotate-60','hue-rotate-90','hue-rotate-180',
    'saturate-0','saturate-50','saturate-100','saturate-150','saturate-200',
    
    // Tables
    'border-collapse','border-separate','table-auto','table-fixed',
    'caption-top','caption-bottom',
    
    // Lists
    'list-none','list-disc','list-decimal','list-inside','list-outside',
    
    // Appearance
    'appearance-none','appearance-auto',
    
    // Accessibility
    'sr-only','not-sr-only',
    
    // Other Layout
    'isolate','isolation-auto',
    'object-contain','object-cover','object-fill','object-none','object-scale-down',
    'object-bottom','object-center','object-left','object-left-bottom','object-left-top','object-right','object-right-bottom','object-right-top','object-top',
    'clear-left','clear-right','clear-both','clear-none',
    'float-right','float-left','float-none',
    'box-border','box-content',
    'truncate','text-ellipsis','text-clip'
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
