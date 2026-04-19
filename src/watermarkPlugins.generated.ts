/** 由 scripts/sync-watermark-plugins.mjs 生成，请勿手改 */
export type PluginWatermarkEntry = { id: string; label: string; source: number; opacity: number; scale: number };

export const PLUGIN_WATERMARK_ENTRIES: PluginWatermarkEntry[] = [
  { id: "plugin_action5Pro", label: "action5Pro", source: require('../assets/watermarks/plugins/action5Pro.png'), opacity: 0.95, scale: 1 },
  { id: "plugin_pocket3", label: "pocket3", source: require('../assets/watermarks/plugins/pocket3.png'), opacity: 0.95, scale: 0.8 },
];
