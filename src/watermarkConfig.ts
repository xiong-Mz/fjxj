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
  maxScale = 3,
): { x: number; y: number; w: number; h: number } {
  const edge = Math.min(containerWidth, containerHeight);
  const margin = Math.max(WATERMARK_LAYOUT.minMarginPx, edge * WATERMARK_LAYOUT.marginFromMinEdge);
  const safeMaxScale = Number.isFinite(maxScale) ? Math.max(0.1, maxScale) : 3;
  const safeScale = Number.isFinite(scale) ? Math.max(0.1, Math.min(safeMaxScale, scale)) : 1;
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

/** 自定义水印：在 computeWatermarkRect 的“尺寸规则”基础上，支持固定锚点位置 */
export function computeWatermarkRectWithAnchor(
  containerWidth: number,
  containerHeight: number,
  assetPixelWidth: number,
  assetPixelHeight: number,
  scale: number,
  anchor:
    | 'top_left'
    | 'top_center'
    | 'top_right'
    | 'bottom_left'
    | 'bottom_center'
    | 'bottom_right',
): { x: number; y: number; w: number; h: number } {
  // 自定义水印允许更大倍率（比如 100）
  const base = computeWatermarkRect(
    containerWidth,
    containerHeight,
    assetPixelWidth,
    assetPixelHeight,
    scale,
    100,
  );
  const edge = Math.min(containerWidth, containerHeight);
  const margin = Math.max(WATERMARK_LAYOUT.minMarginPx, edge * WATERMARK_LAYOUT.marginFromMinEdge);

  const xLeft = margin;
  const xCenter = (containerWidth - base.w) / 2;
  const xRight = containerWidth - margin - base.w;

  const yTop = margin;
  const yBottom = containerHeight - margin - base.h;

  let x = xCenter;
  let y = yBottom;
  switch (anchor) {
    case 'top_left':
      x = xLeft;
      y = yTop;
      break;
    case 'top_center':
      x = xCenter;
      y = yTop;
      break;
    case 'top_right':
      x = xRight;
      y = yTop;
      break;
    case 'bottom_left':
      x = xLeft;
      y = yBottom;
      break;
    case 'bottom_center':
      x = xCenter;
      y = yBottom;
      break;
    case 'bottom_right':
      x = xRight;
      y = yBottom;
      break;
  }
  return {
    x: Math.max(0, Math.min(containerWidth - base.w, x)),
    y: Math.max(0, Math.min(containerHeight - base.h, y)),
    w: base.w,
    h: base.h,
  };
}

/** 自定义水印自由位置：在 computeWatermarkRect 的尺寸规则基础上，允许在画布内任意摆放 */
export function computeWatermarkRectWithPlacement(
  containerWidth: number,
  containerHeight: number,
  assetPixelWidth: number,
  assetPixelHeight: number,
  scale: number,
  placement: { x: number; y: number },
): { x: number; y: number; w: number; h: number } {
  const base = computeWatermarkRect(
    containerWidth,
    containerHeight,
    assetPixelWidth,
    assetPixelHeight,
    scale,
    100,
  );
  const safeX = Number.isFinite(placement.x) ? Math.max(0, Math.min(1, placement.x)) : 0.5;
  const safeY = Number.isFinite(placement.y) ? Math.max(0, Math.min(1, placement.y)) : 0.85;
  const px = safeX * (containerWidth - base.w);
  const py = safeY * (containerHeight - base.h);
  const x = Math.max(0, Math.min(containerWidth - base.w, px));
  const y = Math.max(0, Math.min(containerHeight - base.h, py));
  return { x, y, w: base.w, h: base.h };
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
