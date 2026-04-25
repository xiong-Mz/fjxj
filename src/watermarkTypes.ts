import type { ImageSourcePropType } from 'react-native';

export type WatermarkId = 'none' | string;

export type WatermarkAnchor =
  | 'top_left'
  | 'top_center'
  | 'top_right'
  | 'bottom_left'
  | 'bottom_center'
  | 'bottom_right';

export type WatermarkPlacement = {
  /**
   * 水印左上角在可用区域中的归一化位置（0~1）。
   * 0 表示贴左/贴上，1 表示贴右/贴下（会自动 clamp）。
   */
  x: number;
  y: number;
};

export type CustomWatermark = {
  id: string; // custom_<...>
  name: string;
  /** file:// URI */
  uri: string;
  opacity: number; // 0~1
  scale: number; // 0.1~3
  anchor: WatermarkAnchor;
  /** 存在时使用自由拖拽位置；否则使用 anchor */
  placement?: WatermarkPlacement;
};

export type WatermarkSelection =
  | { kind: 'none' }
  | { kind: 'plugin'; id: string; placement?: WatermarkPlacement }
  | { kind: 'custom'; watermark: CustomWatermark };

export function getWatermarkKey(sel: WatermarkSelection): string {
  if (sel.kind === 'none') return 'none';
  if (sel.kind === 'plugin') return sel.id;
  return sel.watermark.id;
}

export function getWatermarkLabel(
  sel: WatermarkSelection,
  pluginLabelById?: (id: string) => string | undefined,
): string {
  if (sel.kind === 'none') return '关闭';
  if (sel.kind === 'plugin') return pluginLabelById?.(sel.id) ?? '水印';
  return sel.watermark.name || '水印';
}

export function getWatermarkImageSource(
  sel: WatermarkSelection,
  pluginSourceById?: (id: string) => number | null,
): ImageSourcePropType | null {
  if (sel.kind === 'none') return null;
  if (sel.kind === 'plugin') {
    const n = pluginSourceById?.(sel.id) ?? null;
    return n ? n : null;
  }
  return { uri: sel.watermark.uri };
}

