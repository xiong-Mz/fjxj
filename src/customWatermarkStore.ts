import * as FileSystem from 'expo-file-system';

import type { CustomWatermark, WatermarkAnchor, WatermarkPlacement } from './watermarkTypes';

const DIR = `${FileSystem.documentDirectory ?? ''}custom-watermarks/`;
const JSON_PATH = `${DIR}watermarks.json`;

type Persisted = { version: 1; items: CustomWatermark[] };

function clamp(n: number, a: number, b: number) {
  if (!Number.isFinite(n)) return a;
  return Math.max(a, Math.min(b, n));
}

function nearestAnchorFromNormalizedPlacement(p: { x: number; y: number } | undefined): WatermarkAnchor {
  const x = clamp(p?.x ?? 0.5, 0, 1);
  const y = clamp(p?.y ?? 0.85, 0, 1);
  const targets: { a: WatermarkAnchor; x: number; y: number }[] = [
    { a: 'top_left', x: 0, y: 0 },
    { a: 'top_center', x: 0.5, y: 0 },
    { a: 'top_right', x: 1, y: 0 },
    { a: 'bottom_left', x: 0, y: 1 },
    { a: 'bottom_center', x: 0.5, y: 1 },
    { a: 'bottom_right', x: 1, y: 1 },
  ];
  let best = targets[0]!;
  let bestD = Infinity;
  for (const t of targets) {
    const dx = x - t.x;
    const dy = y - t.y;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  return best.a;
}

function sanitizeAnchor(x: unknown): WatermarkAnchor {
  const v = String(x ?? '');
  if (
    v === 'top_left' ||
    v === 'top_center' ||
    v === 'top_right' ||
    v === 'bottom_left' ||
    v === 'bottom_center' ||
    v === 'bottom_right'
  ) {
    return v;
  }
  return 'bottom_center';
}

function sanitizePlacement(p: unknown): WatermarkPlacement | undefined {
  if (!p || typeof p !== 'object') return undefined;
  const x = clamp(Number((p as any).x), 0, 1);
  const y = clamp(Number((p as any).y), 0, 1);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  return { x, y };
}

function sanitizeItem(x: CustomWatermark): CustomWatermark {
  // 兼容旧版 placement: {x,y}
  const legacyPlacement = (x as any).placement as { x: number; y: number } | undefined;
  return {
    id: String(x.id || ''),
    name: String(x.name || '水印'),
    uri: String(x.uri || ''),
    opacity: clamp(Number(x.opacity ?? 0.95), 0, 1),
    scale: Math.round(clamp(Number(x.scale ?? 1), 0.1, 100) * 100) / 100,
    anchor: sanitizeAnchor((x as any).anchor ?? nearestAnchorFromNormalizedPlacement(legacyPlacement)),
    placement: sanitizePlacement((x as any).placement),
  };
}

export async function ensureCustomWatermarkDir(): Promise<void> {
  if (!FileSystem.documentDirectory) return;
  const dirInfo = await FileSystem.getInfoAsync(DIR);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(DIR, { intermediates: true });
  }
}

export async function loadCustomWatermarks(): Promise<CustomWatermark[]> {
  if (!FileSystem.documentDirectory) return [];
  await ensureCustomWatermarkDir();
  const info = await FileSystem.getInfoAsync(JSON_PATH);
  if (!info.exists) return [];
  try {
    const raw = await FileSystem.readAsStringAsync(JSON_PATH);
    const parsed: unknown = JSON.parse(raw);
    const items = (parsed as Persisted | undefined)?.items;
    if (!Array.isArray(items)) return [];
    return items.map((it) => sanitizeItem(it as CustomWatermark)).filter((it) => !!it.id && !!it.uri);
  } catch {
    return [];
  }
}

export async function saveCustomWatermarks(items: CustomWatermark[]): Promise<void> {
  if (!FileSystem.documentDirectory) return;
  await ensureCustomWatermarkDir();
  const payload: Persisted = { version: 1, items };
  await FileSystem.writeAsStringAsync(JSON_PATH, JSON.stringify(payload, null, 2));
}

export function makeCustomWatermarkId(): string {
  return `custom_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function importPngToCustomWatermark(
  pickedUri: string,
  name?: string,
): Promise<CustomWatermark | null> {
  if (!FileSystem.documentDirectory) return null;
  await ensureCustomWatermarkDir();
  const id = makeCustomWatermarkId();
  const outPath = `${DIR}${id}.png`;
  try {
    // 直接 copy；ImagePicker 通常返回 file:// URI
    await FileSystem.copyAsync({ from: pickedUri, to: outPath });
    return {
      id,
      name: (name ?? '水印').trim() || '水印',
      uri: outPath,
      opacity: 0.95,
      scale: 1,
      anchor: 'bottom_center',
      placement: undefined,
    };
  } catch {
    return null;
  }
}

export async function removeCustomWatermark(id: string): Promise<void> {
  if (!FileSystem.documentDirectory) return;
  await ensureCustomWatermarkDir();
  const path = `${DIR}${id}.png`;
  const info = await FileSystem.getInfoAsync(path);
  if (info.exists) {
    await FileSystem.deleteAsync(path, { idempotent: true });
  }
}

