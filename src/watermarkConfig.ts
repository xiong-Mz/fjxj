import { PLUGIN_WATERMARK_ENTRIES } from './watermarkPlugins.generated';

/** `none` 为关闭；其余 id 由 `scripts/sync-watermark-plugins.mjs` 扫描 `plugins/` 生成 */
export type WatermarkStyleId = 'none' | string;

export const WATERMARK_OPTIONS: { id: WatermarkStyleId; label: string }[] = [
  { id: 'none', label: '关闭' },
  ...PLUGIN_WATERMARK_ENTRIES.map(({ id, label }) => ({ id, label })),
];

export type WatermarkRenderConfig = { opacity: number; scale: number };

/** 成片与取景预览共用的水印几何（底部水平居中） */
export const WATERMARK_LAYOUT = {
  /** 水印最大宽度占画布宽度 */
  maxWidthFraction: 0.36,
  /**
   * 水印最大高度占画布短边（与 maxWidth 一起做 contain），避免横长条角标因比例不同看起来一大一小。
   */
  maxHeightFractionOfMinEdge: 0.082,
  /** 底边留白：max(像素下限, 短边 × 比例) */
  marginFromMinEdge: 0.022,
  minMarginPx: 8,
} as const;

/** 根据画布与素材像素尺寸计算水印矩形（底边居中，与 Skia 成片一致） */
export function computeWatermarkRect(
  containerWidth: number,
  containerHeight: number,
  assetPixelWidth: number,
  assetPixelHeight: number,
  scale = 1,
): { x: number; y: number; w: number; h: number } {
  const edge = Math.min(containerWidth, containerHeight);
  const margin = Math.max(WATERMARK_LAYOUT.minMarginPx, edge * WATERMARK_LAYOUT.marginFromMinEdge);
  const safeScale = Number.isFinite(scale) ? Math.max(0.1, Math.min(3, scale)) : 1;
  const maxW = containerWidth * WATERMARK_LAYOUT.maxWidthFraction * safeScale;
  const maxH = edge * WATERMARK_LAYOUT.maxHeightFractionOfMinEdge * safeScale;
  const iw = Math.max(1, assetPixelWidth);
  const ih = Math.max(1, assetPixelHeight);
  let w = maxW;
  let h = (ih / iw) * w;
  if (h > maxH) {
    h = maxH;
    w = (iw / ih) * h;
  }
  const x = (containerWidth - w) / 2;
  const y = containerHeight - margin - h;
  return { x, y, w, h };
}

export function getWatermarkRenderConfig(id: WatermarkStyleId): WatermarkRenderConfig {
  if (id === 'none') return { opacity: 0, scale: 1 };
  const plugin = PLUGIN_WATERMARK_ENTRIES.find((e) => e.id === id);
  const opacity: unknown = plugin?.opacity;
  const scale: unknown = plugin?.scale;
  return {
    opacity: Number.isFinite(opacity as number) ? Math.max(0, Math.min(1, opacity as number)) : 0.95,
    scale: Number.isFinite(scale as number) ? Math.max(0.1, Math.min(3, scale as number)) : 1,
  };
}

/** Metro `require()` 资源 id，供 Skia `useImage` / RN `Image` 使用 */
export function getWatermarkAssetSource(id: WatermarkStyleId): number | null {
  if (id === 'none') return null;
  const plugin = PLUGIN_WATERMARK_ENTRIES.find((e) => e.id === id);
  return plugin?.source ?? null;
}

export function isImageWatermarkStyle(id: WatermarkStyleId): boolean {
  return id !== 'none' && getWatermarkAssetSource(id) != null;
}
