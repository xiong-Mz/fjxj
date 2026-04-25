import React, { useEffect, useMemo, useRef } from 'react';
import { InteractionManager, StyleSheet, View } from 'react-native';
import {
  Canvas,
  ColorMatrix,
  Image,
  ImageFormat,
  useCanvasRef,
  useImage,
} from '@shopify/react-native-skia';
import * as FileSystem from 'expo-file-system';

import {
  computeWatermarkRect,
  computeWatermarkRectWithAnchor,
  computeWatermarkRectWithPlacement,
  getWatermarkAssetSource,
  getWatermarkRenderConfig,
  isImageWatermarkStyle,
} from './watermarkConfig';
import type { WatermarkSelection } from './watermarkTypes';

type Props = {
  uri: string;
  width: number;
  height: number;
  matrix: number[];
  /** 水印选择（插件或自定义）；none 为关闭 */
  watermark?: WatermarkSelection;
  onExported: (fileUri: string) => void;
  onError: (e: Error) => void;
};

export function FilmProcessor({
  uri,
  width,
  height,
  matrix,
  watermark = { kind: 'none' },
  onExported,
  onError,
}: Props) {
  const image = useImage(uri);
  const wmSource =
    watermark.kind === 'plugin' ? getWatermarkAssetSource(watermark.id) : null;
  const wmUri = watermark.kind === 'custom' ? watermark.watermark.uri : null;
  const wmImage = useImage(wmUri ?? wmSource);
  const wmCfg = useMemo(() => {
    if (watermark.kind === 'plugin') return getWatermarkRenderConfig(watermark.id);
    if (watermark.kind === 'custom') {
      return { opacity: watermark.watermark.opacity, scale: watermark.watermark.scale };
    }
    return { opacity: 0, scale: 1 };
  }, [watermark]);

  const ref = useCanvasRef();
  const onExportedRef = useRef(onExported);
  const onErrorRef = useRef(onError);
  onExportedRef.current = onExported;
  onErrorRef.current = onError;

  const matrixKey = matrix.join(',');
  const wmKey =
    watermark.kind === 'none' ? '' : watermark.kind === 'plugin' ? watermark.id : watermark.watermark.id;

  const wmLayout = useMemo(() => {
    if (!wmImage) return null;
    const iw = wmImage.width();
    const ih = wmImage.height();
    if (iw <= 0 || ih <= 0) return null;
    if (watermark.kind === 'custom') {
      if (watermark.watermark.placement) {
        return computeWatermarkRectWithPlacement(
          width,
          height,
          iw,
          ih,
          wmCfg.scale,
          watermark.watermark.placement,
        );
      }
      return computeWatermarkRectWithAnchor(
        width,
        height,
        iw,
        ih,
        wmCfg.scale,
        watermark.watermark.anchor,
      );
    }
    if (watermark.kind === 'plugin') {
      // 插件水印：默认底部居中；若用户拖拽过则使用 placement
      if (watermark.placement) {
        return computeWatermarkRectWithPlacement(
          width,
          height,
          iw,
          ih,
          wmCfg.scale,
          watermark.placement,
        );
      }
      return computeWatermarkRect(width, height, iw, ih, wmCfg.scale);
    }
    return null;
  }, [height, width, watermark, wmCfg.scale, wmImage]);

  useEffect(() => {
    if (!image || !FileSystem.cacheDirectory) return;
    if (watermark.kind === 'plugin' && isImageWatermarkStyle(watermark.id) && !wmImage) return;
    if (watermark.kind === 'custom' && !wmImage) return;
    let cancelled = false;

    const run = async () => {
      try {
        await new Promise<void>((resolve) => {
          InteractionManager.runAfterInteractions(() => resolve());
        });
        await new Promise<void>((r) => requestAnimationFrame(() => r()));
        const snap = await ref.current?.makeImageSnapshotAsync();
        if (!snap || cancelled) return;
        const b64 = snap.encodeToBase64(ImageFormat.JPEG, 90);
        const out = `${FileSystem.cacheDirectory}film_${Date.now()}.jpg`;
        await FileSystem.writeAsStringAsync(out, b64, {
          encoding: FileSystem.EncodingType.Base64,
        });
        if (!cancelled) onExportedRef.current(out);
      } catch (e) {
        if (!cancelled) {
          onErrorRef.current(e instanceof Error ? e : new Error(String(e)));
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [image, uri, width, height, matrixKey, watermark, wmImage, wmKey]);

  if (!FileSystem.cacheDirectory) return null;

  const showWm = wmLayout && wmImage;

  return (
    <View style={[styles.offscreen, { width, height }]} pointerEvents="none">
      {image ? (
        <Canvas ref={ref} style={{ width, height }}>
          <Image x={0} y={0} width={width} height={height} image={image} fit="cover">
            <ColorMatrix matrix={matrix} />
          </Image>
          {showWm ? (
            <Image
              x={wmLayout.x}
              y={wmLayout.y}
              width={wmLayout.w}
              height={wmLayout.h}
              image={wmImage}
              fit="fill"
              opacity={wmCfg.opacity}
            />
          ) : null}
        </Canvas>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  offscreen: {
    position: 'absolute',
    left: -10000,
    top: 0,
  },
});
