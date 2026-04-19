/**
 * 扫描 assets/watermarks/plugins/ 下的图片，生成 src/watermarkPlugins.generated.ts。
 * Metro 需要静态 require，故通过脚本生成；增删或重命名插件文件后会在 prestart/postinstall 自动执行。
 * （替换同路径 PNG 内容无需改生成文件，热重载即可。）
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const pluginsDir = path.join(root, 'assets', 'watermarks', 'plugins');
const configFile = path.join(pluginsDir, 'watermarks.config.json');
const outFile = path.join(root, 'src', 'watermarkPlugins.generated.ts');

const EXT = new Set(['.png', '.webp', '.jpg', '.jpeg']);

function clamp(n, a, b) {
  const x = Number.isFinite(n) ? n : a;
  return Math.max(a, Math.min(b, x));
}

function readConfig() {
  const fallback = { defaults: { opacity: 0.95, scale: 1 }, watermarks: {} };
  if (!fs.existsSync(configFile)) return fallback;
  try {
    const raw = fs.readFileSync(configFile, 'utf8');
    const parsed = JSON.parse(raw);
    const defaults = parsed?.defaults ?? {};
    const watermarks = parsed?.watermarks ?? {};
    return {
      defaults: {
        opacity: clamp(Number(defaults.opacity), 0, 1),
        scale: clamp(Number(defaults.scale), 0.1, 3),
      },
      watermarks: typeof watermarks === 'object' && watermarks ? watermarks : {},
    };
  } catch {
    return fallback;
  }
}

function slugFromStem(stem) {
  return stem
    .normalize('NFKC')
    .trim()
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 72) || 'unnamed';
}

function makePluginId(stem, used) {
  const base = slugFromStem(stem);
  let id = `plugin_${base}`;
  while (used.has(id)) {
    id = `plugin_${base}_${crypto.randomBytes(2).toString('hex')}`;
  }
  used.add(id);
  return id;
}

if (!fs.existsSync(pluginsDir)) {
  fs.mkdirSync(pluginsDir, { recursive: true });
}

const cfg = readConfig();

const usedIds = new Set();
const files = fs
  .readdirSync(pluginsDir, { withFileTypes: true })
  .filter((d) => d.isFile())
  .map((d) => d.name)
  .filter((name) => EXT.has(path.extname(name).toLowerCase()))
  .filter((name) => name !== path.basename(configFile))
  .sort((a, b) => a.localeCompare(b, 'en'));

const rows = [];
for (const file of files) {
  const stem = path.basename(file, path.extname(file));
  const id = makePluginId(stem, usedIds);
  const label = stem.trim() || file;
  const entryCfg = cfg.watermarks?.[stem] ?? {};
  const opacity = clamp(Number(entryCfg.opacity ?? cfg.defaults.opacity), 0, 1);
  const scale = clamp(Number(entryCfg.scale ?? cfg.defaults.scale), 0.1, 3);
  const rel = `../assets/watermarks/plugins/${file}`.split(path.sep).join('/');
  rows.push(
    `  { id: ${JSON.stringify(id)}, label: ${JSON.stringify(label)}, source: require('${rel}'), opacity: ${opacity}, scale: ${scale} },`,
  );
}

const body = `/** 由 scripts/sync-watermark-plugins.mjs 生成，请勿手改 */
export type PluginWatermarkEntry = { id: string; label: string; source: number; opacity: number; scale: number };

export const PLUGIN_WATERMARK_ENTRIES: PluginWatermarkEntry[] = [
${rows.join('\n')}
];
`;

fs.writeFileSync(outFile, body, 'utf8');
console.log(`sync-watermarks: ${files.length} plugin(s) -> ${path.relative(root, outFile)}`);
