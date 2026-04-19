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
  getWatermarkAssetSource,
  getWatermarkRenderConfig,
  isImageWatermarkStyle,
  type WatermarkStyleId,
} from './watermarkConfig';

type Props = {
  uri: string;
  width: number;
  height: number;
  matrix: number[];
  /** 非 none 时在成片底部居中叠加透明 PNG 角标 */
  watermarkStyle?: WatermarkStyleId;
  onExported: (fileUri: string) => void;
  onError: (e: Error) => void;
};

export function FilmProcessor({
  uri,
  width,
  height,
  matrix,
  watermarkStyle = 'none',
  onExported,
  onError,
}: Props) {
  const image = useImage(uri);
  const wmSource = isImageWatermarkStyle(watermarkStyle)
    ? getWatermarkAssetSource(watermarkStyle)
    : null;
  const wmImage = useImage(wmSource);
  const wmCfg = useMemo(() => getWatermarkRenderConfig(watermarkStyle), [watermarkStyle]);

  const ref = useCanvasRef();
  const onExportedRef = useRef(onExported);
  const onErrorRef = useRef(onError);
  onExportedRef.current = onExported;
  onErrorRef.current = onError;

  const matrixKey = matrix.join(',');
  const wmKey = watermarkStyle === 'none' ? '' : watermarkStyle;

  const wmLayout = useMemo(() => {
    if (!wmImage) return null;
    const iw = wmImage.width();
    const ih = wmImage.height();
    if (iw <= 0 || ih <= 0) return null;
    return computeWatermarkRect(width, height, iw, ih, wmCfg.scale);
  }, [height, width, wmCfg.scale, wmImage]);

  useEffect(() => {
    if (!image || !FileSystem.cacheDirectory) return;
    if (isImageWatermarkStyle(watermarkStyle) && !wmImage) return;
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
  }, [image, uri, width, height, matrixKey, watermarkStyle, wmImage, wmKey]);

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
