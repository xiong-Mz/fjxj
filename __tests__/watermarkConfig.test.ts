import {
  WATERMARK_OPTIONS,
  computeWatermarkRect,
  getWatermarkAssetSource,
  isImageWatermarkStyle,
} from '../src/watermarkConfig';
import { PLUGIN_WATERMARK_ENTRIES } from '../src/watermarkPlugins.generated';

describe('watermarkConfig', () => {
  it('lists none first then plugin entries in sync order', () => {
    const ids = WATERMARK_OPTIONS.map((o) => o.id);
    expect(ids[0]).toBe('none');
    expect(ids.slice(1)).toEqual(PLUGIN_WATERMARK_ENTRIES.map((e) => e.id));
    expect(ids.length).toBeGreaterThanOrEqual(1);
  });

  it('isImageWatermarkStyle', () => {
    expect(isImageWatermarkStyle('none')).toBe(false);
    const first = PLUGIN_WATERMARK_ENTRIES[0];
    expect(first).toBeDefined();
    if (first) {
      expect(isImageWatermarkStyle(first.id)).toBe(true);
    }
    expect(isImageWatermarkStyle('legacy_builtin_id')).toBe(false);
    expect(isImageWatermarkStyle('unknown_plugin_id')).toBe(false);
  });

  it('getWatermarkAssetSource', () => {
    expect(getWatermarkAssetSource('none')).toBeNull();
    const first = PLUGIN_WATERMARK_ENTRIES[0];
    if (first) {
      expect(getWatermarkAssetSource(first.id)).toBeTruthy();
    }
    expect(getWatermarkAssetSource('legacy_builtin_id')).toBeNull();
    expect(getWatermarkAssetSource('unknown')).toBeNull();
  });

  it('computeWatermarkRect is bottom-centered', () => {
    const r = computeWatermarkRect(1000, 800, 480, 100);
    expect(r.x + r.w / 2).toBeCloseTo(500, 5);
    expect(r.y + r.h).toBeLessThanOrEqual(800);
    expect(r.y).toBeGreaterThanOrEqual(0);
  });

  it('computeWatermarkRect caps height so wide banners share similar scale', () => {
    const edge = Math.min(1000, 800);
    const maxH = edge * 0.082;
    const wide = computeWatermarkRect(1000, 800, 2000, 200);
    const taller = computeWatermarkRect(1000, 800, 1600, 400);
    expect(wide.h).toBeLessThanOrEqual(maxH + 1e-6);
    expect(taller.h).toBeLessThanOrEqual(maxH + 1e-6);
    expect(wide.w / wide.h).toBeCloseTo(10, 5);
    expect(taller.w / taller.h).toBeCloseTo(4, 5);
  });

  it('computeWatermarkRect applies scale factor', () => {
    const a = computeWatermarkRect(1000, 800, 480, 100, 1);
    const b = computeWatermarkRect(1000, 800, 480, 100, 0.5);
    expect(b.w).toBeLessThan(a.w);
    expect(b.h).toBeLessThan(a.h);
  });
});
