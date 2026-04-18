import React, { useEffect, useRef } from 'react';
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

type Props = {
  uri: string;
  width: number;
  height: number;
  matrix: number[];
  onExported: (fileUri: string) => void;
  onError: (e: Error) => void;
};

export function FilmProcessor({ uri, width, height, matrix, onExported, onError }: Props) {
  const image = useImage(uri);
  const ref = useCanvasRef();
  const onExportedRef = useRef(onExported);
  const onErrorRef = useRef(onError);
  onExportedRef.current = onExported;
  onErrorRef.current = onError;

  const matrixKey = matrix.join(',');

  useEffect(() => {
    if (!image || !FileSystem.cacheDirectory) return;
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
  }, [image, uri, width, height, matrixKey]);

  if (!FileSystem.cacheDirectory) return null;

  return (
    <View style={[styles.offscreen, { width, height }]} pointerEvents="none">
      {image ? (
        <Canvas ref={ref} style={{ width, height }}>
          <Image x={0} y={0} width={width} height={height} image={image} fit="cover">
            <ColorMatrix matrix={matrix} />
          </Image>
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
