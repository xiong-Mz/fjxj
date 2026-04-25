import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from 'react-native';
import {
  CameraView,
  type FlashMode,
  useCameraPermissions,
  useMicrophonePermissions,
} from 'expo-camera';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import {
  Gesture,
  GestureDetector,
  type GestureUpdateEvent,
  type PinchGestureHandlerEventPayload,
} from 'react-native-gesture-handler';
import Animated, { useAnimatedProps, useSharedValue } from 'react-native-reanimated';

import {
  FILM_MODE_OPTIONS,
  FILTERS,
  combinedMatrix,
  type FilmFilter,
  type RetroPreset,
} from './colorMatrix';
import { FilmProcessor } from './FilmProcessor';
import { resolveAssetDisplayUri } from './galleryAssetUri';
import { getMediaLibraryAccessRequestOptions } from './mediaLibraryPermission';
import {
  WATERMARK_OPTIONS,
  computeWatermarkRect,
  computeWatermarkRectWithAnchor,
  computeWatermarkRectWithPlacement,
  getWatermarkAssetSource,
  getWatermarkRenderConfig,
  isImageWatermarkStyle,
  type WatermarkStyleId,
} from './watermarkConfig';
import { WatermarkSettingsModal } from './WatermarkSettingsModal';
import { loadCustomWatermarks, saveCustomWatermarks } from './customWatermarkStore';
import type { CustomWatermark, WatermarkPlacement, WatermarkSelection } from './watermarkTypes';

const AnimatedCameraView = Animated.createAnimatedComponent(CameraView);

/** 连点「RETRO FILM」标题三次切换（仅 __DEV__） */
const WM_DEBUG_TAP_RESET_MS = 600;

/**
 * 取景叠层与成片差异说明：
 * - 成片：Skia ColorMatrix（与配置矩阵一致）
 * - 预览：仅半透明色块 + blend，无法等价矩阵；且预览流与拍照 JPEG 的曝光/HDR/色彩管线可能不同
 * 使用 soft-light 比 multiply 更少压暗中间调，观感通常更接近矩阵调色（仍非 1:1）。
 * 若要几乎一致需把相机帧送进 Skia（如 Vision Camera + 帧处理），成本高。
 */
const previewTintLayerBase = {
  ...StyleSheet.absoluteFillObject,
  experimental_mixBlendMode: 'soft-light',
} as ViewStyle;

const C = {
  bg: '#1a1511',
  panel: '#231c17',
  surface: '#2e2620',
  gold: '#c9a962',
  goldBright: '#e8d5a8',
  goldMuted: '#8b6f3c',
  bronze: '#5c4a38',
  sheet: '#f2ebe2',
  sheetLine: '#ddd5c8',
  textDim: '#9a8f82',
  line: 'rgba(201,169,98,0.4)',
};

function clamp01(x: number) {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function formatRecordingDuration(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

type ExportJob = {
  uri: string;
  width: number;
  height: number;
  matrix: number[];
  fallbackUri: string;
  watermark: WatermarkSelection;
};

function SwatchTile({
  colors,
  label,
  selected,
  onPress,
}: {
  colors: [string, string];
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={styles.sheetTile}>
      <View style={[styles.sheetSwatchOuter, selected && styles.sheetSwatchOuterOn]}>
        <View style={styles.sheetSwatch}>
          <View style={[styles.sheetSwatchHalf, { backgroundColor: colors[0] }]} />
          <View style={[styles.sheetSwatchHalf, { backgroundColor: colors[1] }]} />
        </View>
      </View>
      <Text style={[styles.sheetTileLabel, selected && styles.sheetTileLabelOn]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

function WatermarkTile({
  label,
  selected,
  onPress,
  source,
  uri,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  source: number | null;
  uri?: string | null;
}) {
  return (
    <Pressable onPress={onPress} style={styles.sheetTile}>
      <View style={[styles.sheetSwatchOuter, selected && styles.sheetSwatchOuterOn]}>
        <View style={styles.watermarkThumbBox}>
          {source ? (
            <Image
              source={source}
              style={styles.watermarkThumbImage}
              resizeMode="contain"
              accessibilityLabel={label}
            />
          ) : uri ? (
            <Image
              source={{ uri }}
              style={styles.watermarkThumbImage}
              resizeMode="contain"
              accessibilityLabel={label}
            />
          ) : (
            <Ionicons name="close" size={22} color={C.goldMuted} />
          )}
        </View>
      </View>
      <Text style={[styles.sheetTileLabel, selected && styles.sheetTileLabelOn]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

function GridGlyph({ active }: { active: boolean }) {
  const cell = (k: number) => (
    <View
      key={k}
      style={[
        styles.gridGlyphCell,
        active ? styles.gridGlyphCellOn : styles.gridGlyphCellOff,
      ]}
    />
  );
  return (
    <View style={styles.gridGlyph}>
      <View style={styles.gridGlyphRow}>{cell(0)}{cell(1)}{cell(2)}</View>
      <View style={styles.gridGlyphRow}>{cell(3)}{cell(4)}{cell(5)}</View>
      <View style={styles.gridGlyphRow}>{cell(6)}{cell(7)}{cell(8)}</View>
    </View>
  );
}

export function RetroCameraScreen() {
  const camRef = useRef<InstanceType<typeof CameraView> | null>(null);
  const insets = useSafeAreaInsets();
  const watermarkRef = useRef<WatermarkSelection>({ kind: 'none' });

  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [micPermission, requestMicPermission] = useMicrophonePermissions();

  const [cameraReady, setCameraReady] = useState(false);
  const [facing, setFacing] = useState<'back' | 'front'>('back');
  const [mode, setMode] = useState<'picture' | 'video'>('picture');
  const [filterIndex, setFilterIndex] = useState(0);
  const [filmModeIndex, setFilmModeIndex] = useState(0);
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [filmSheetOpen, setFilmSheetOpen] = useState(false);
  const [watermarkSheetOpen, setWatermarkSheetOpen] = useState(false);
  const [watermark, setWatermark] = useState<WatermarkSelection>({ kind: 'none' });
  type CustomWatermarkWithPx = CustomWatermark & { pixelSize?: { w: number; h: number } };
  const [customWatermarks, setCustomWatermarks] = useState<CustomWatermarkWithPx[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [watermarkSettingsOpen, setWatermarkSettingsOpen] = useState(false);
  /** 取景卡片像素尺寸，用于与成片同一公式叠水印预览 */
  const [previewLayout, setPreviewLayout] = useState<{ w: number; h: number } | null>(null);
  const [flashMode, setFlashMode] = useState<FlashMode>('off');
  const [showGrid, setShowGrid] = useState(false);
  // 缩放：用 Reanimated shared value，手势在 UI 线程更新，避免 JS 卡顿
  const zoomSV = useSharedValue(0);
  const zoomStartSV = useSharedValue(0);
  const [galleryUri, setGalleryUri] = useState<string | null>(null);
  /** 系统相册选择后，应用内全屏预览用的本地 URI */
  const [pickedGalleryPreviewUri, setPickedGalleryPreviewUri] = useState<string | null>(null);
  /** 水印拖拽中的像素偏移（仅预览；松手后写入 placement） */
  const [wmDragPx, setWmDragPx] = useState<{ x: number; y: number } | null>(null);
  /** __DEV__：连点品牌行三次打开，用于排查手势/状态卡死 */
  const [watermarkDebugPanel, setWatermarkDebugPanel] = useState(false);
  const wmDebugTapRef = useRef<{ count: number; at: number }>({ count: 0, at: 0 });
  const wmPanGrantRef = useRef({ sx: 0, sy: 0 });
  const wmDragPxRef = useRef<{ x: number; y: number } | null>(null);
  wmDragPxRef.current = wmDragPx;

  /** 避免 Image.getSize 与 effect cleanup 竞态导致尺寸丢失，或重复请求卡死主线程 */
  const wmPixelSizeInflightRef = useRef(new Set<string>());

  const [activeExportJob, setActiveExportJob] = useState<ExportJob | null>(null);
  const exportQueueRef = useRef<ExportJob[]>([]);
  const exportProcessingRef = useRef(false);

  const [isRecording, setIsRecording] = useState(false);
  const [recordingElapsedSec, setRecordingElapsedSec] = useState(0);
  const recordingStartedAtRef = useRef<number | null>(null);
  const recordingPromiseRef = useRef<Promise<{ uri: string } | undefined> | null>(
    null,
  );

  const preset = FILM_MODE_OPTIONS[filmModeIndex];
  const filter = FILTERS[filterIndex];

  useEffect(() => {
    watermarkRef.current = watermark;
  }, [watermark]);

  const wmAssetPx = useMemo(() => {
    if (watermark.kind === 'plugin') {
      if (!isImageWatermarkStyle(watermark.id)) return null;
      const src = getWatermarkAssetSource(watermark.id);
      if (src == null) return null;
      const r = Image.resolveAssetSource(src);
      if (r && r.width > 0 && r.height > 0) return { w: r.width, h: r.height };
      return { w: 480, h: 100 };
    }
    return null;
  }, [watermark]);

  const wmRenderCfg = useMemo(() => {
    if (watermark.kind === 'plugin') return getWatermarkRenderConfig(watermark.id);
    if (watermark.kind === 'custom') {
      return { opacity: watermark.watermark.opacity, scale: watermark.watermark.scale };
    }
    return { opacity: 0, scale: 1 };
  }, [watermark]);

  const wmPreviewRect = useMemo(() => {
    if (!previewLayout) return null;
    if (watermark.kind === 'plugin') {
      if (!wmAssetPx) return null;
      if (watermark.placement) {
        return computeWatermarkRectWithPlacement(
          previewLayout.w,
          previewLayout.h,
          wmAssetPx.w,
          wmAssetPx.h,
          wmRenderCfg.scale,
          watermark.placement,
        );
      }
      return computeWatermarkRect(
        previewLayout.w,
        previewLayout.h,
        wmAssetPx.w,
        wmAssetPx.h,
        wmRenderCfg.scale,
      );
    }
    if (watermark.kind === 'custom') {
      const px = customWatermarks.find((x) => x.id === watermark.watermark.id);
      const w = px?.pixelSize?.w;
      const h = px?.pixelSize?.h;
      if (!Number.isFinite(w) || !Number.isFinite(h)) return null;
      if (watermark.watermark.placement) {
        return computeWatermarkRectWithPlacement(
          previewLayout.w,
          previewLayout.h,
          w as number,
          h as number,
          wmRenderCfg.scale,
          watermark.watermark.placement,
        );
      }
      return computeWatermarkRectWithAnchor(
        previewLayout.w,
        previewLayout.h,
        w as number,
        h as number,
        wmRenderCfg.scale,
        watermark.watermark.anchor,
      );
    }
    return null;
  }, [previewLayout, watermark, wmAssetPx, wmRenderCfg.scale, customWatermarks]);

  useEffect(() => {
    setWmDragPx(null);
  }, [watermark, wmPreviewRect?.x, wmPreviewRect?.y, wmPreviewRect?.w, wmPreviewRect?.h]);

  const displayWmRect = useMemo(() => {
    if (!wmPreviewRect) return null;
    if (!wmDragPx) return wmPreviewRect;
    return { ...wmPreviewRect, x: wmDragPx.x, y: wmDragPx.y };
  }, [wmPreviewRect, wmDragPx]);

  const persistCustomWatermarks = useCallback(async (next: CustomWatermarkWithPx[]) => {
    setCustomWatermarks(next);
    await saveCustomWatermarks(
      next.map(({ pixelSize, ...rest }) => rest),
    );
  }, []);

  const updateCustomWatermark = useCallback(
    async (id: string, patch: Partial<CustomWatermark>) => {
      const next = customWatermarks.map((it) => (it.id === id ? ({ ...it, ...patch } as CustomWatermarkWithPx) : it));
      await persistCustomWatermarks(next);
      if (watermark.kind === 'custom' && watermark.watermark.id === id) {
        const latest = next.find((x) => x.id === id);
        if (latest) setWatermark({ kind: 'custom', watermark: latest });
      }
    },
    [customWatermarks, persistCustomWatermarks, watermark],
  );

  // 加载自定义水印列表（用于相机水印选择面板）
  useEffect(() => {
    let alive = true;
    void (async () => {
      const list = await loadCustomWatermarks();
      if (!alive) return;
      if (list.length > 0) setCustomWatermarks(list);
    })();
    return () => {
      alive = false;
    };
  }, []);

  // 从“水印设置”返回时刷新列表，保证删除/修改即时生效
  const wmSettingsPrevOpenRef = useRef<boolean>(false);
  useEffect(() => {
    const prev = wmSettingsPrevOpenRef.current;
    wmSettingsPrevOpenRef.current = watermarkSettingsOpen;
    // 仅在从 open -> close 时刷新，避免测试环境初次渲染产生 act 警告
    if (!(prev === true && watermarkSettingsOpen === false)) return;
    let alive = true;
    void (async () => {
      const list = await loadCustomWatermarks();
      if (!alive) return;
      setCustomWatermarks(list);
      // 当前选中的自定义水印若已被删除，则回退到关闭
      if (watermark.kind === 'custom' && !list.some((x) => x.id === watermark.watermark.id)) {
        setWatermark({ kind: 'none' });
      } else if (watermark.kind === 'custom') {
        const latest = list.find((x) => x.id === watermark.watermark.id);
        if (latest) setWatermark({ kind: 'custom', watermark: latest });
      }
    })();
    return () => {
      alive = false;
    };
  }, [watermarkSettingsOpen, watermark]);

  // 为自定义水印获取像素尺寸（用于预览叠加计算）
  useEffect(() => {
    customWatermarks.forEach((wm) => {
      if (wm.pixelSize != null) {
        wmPixelSizeInflightRef.current.delete(wm.id);
        return;
      }
      if (wmPixelSizeInflightRef.current.has(wm.id)) return;
      wmPixelSizeInflightRef.current.add(wm.id);
      Image.getSize(
        wm.uri,
        (w, h) => {
          setCustomWatermarks((prev) => {
            const cur = prev.find((it) => it.id === wm.id);
            if (!cur || cur.pixelSize != null) return prev;
            return prev.map((it) =>
              it.id === wm.id ? ({ ...it, pixelSize: { w, h } } as CustomWatermarkWithPx) : it,
            );
          });
        },
        () => {
          wmPixelSizeInflightRef.current.delete(wm.id);
        },
      );
    });
  }, [customWatermarks]);

  const filterSwatch = (f: FilmFilter): [string, string] =>
    f.swatch ?? ['#3d3d46', '#1a1a1f'];

  const ensureMediaPermission = useCallback(async () => {
    const { writeOnly, granularPermissions } = getMediaLibraryAccessRequestOptions();
    const cur = await MediaLibrary.getPermissionsAsync(writeOnly, granularPermissions);
    if (cur.status === 'granted') return true;
    const req = await MediaLibrary.requestPermissionsAsync(writeOnly, granularPermissions);
    return req.status === 'granted';
  }, []);

  const saveUriToLibrary = useCallback(
    async (uri: string) => {
      const ok = await ensureMediaPermission();
      if (!ok) {
        Alert.alert('无法保存', '需要相册写入权限才能保存到系统相册。');
        return false;
      }
      await MediaLibrary.saveToLibraryAsync(uri);
      return true;
    },
    [ensureMediaPermission],
  );

  const refreshGalleryThumb = useCallback(async () => {
    const ok = await ensureMediaPermission();
    if (!ok) return;
    try {
      const page = await MediaLibrary.getAssetsAsync({
        first: 1,
        mediaType: MediaLibrary.MediaType.photo,
        sortBy: MediaLibrary.SortBy.creationTime,
      });
      const asset = page.assets[0];
      if (!asset) return;
      const uri = await resolveAssetDisplayUri(asset);
      if (uri) setGalleryUri(uri);
    } catch {
      /* ignore */
    }
  }, [ensureMediaPermission]);

  useEffect(() => {
    void refreshGalleryThumb();
  }, [refreshGalleryThumb]);

  useEffect(() => {
    if (!isRecording) {
      setRecordingElapsedSec(0);
      recordingStartedAtRef.current = null;
      return;
    }
    recordingStartedAtRef.current = Date.now();
    setRecordingElapsedSec(0);
    const id = setInterval(() => {
      const t0 = recordingStartedAtRef.current;
      if (t0 == null) return;
      setRecordingElapsedSec(Math.floor((Date.now() - t0) / 1000));
    }, 500);
    return () => clearInterval(id);
  }, [isRecording]);

  const cycleFlash = useCallback(() => {
    setFlashMode((f) => (f === 'off' ? 'on' : 'off'));
  }, []);

  const pinchGesture = useMemo(() => {
    return Gesture.Pinch()
      .onBegin(() => {
        zoomStartSV.value = zoomSV.value;
      })
      .onUpdate((ev: GestureUpdateEvent<PinchGestureHandlerEventPayload>) => {
        // 更“快”的映射：scale-1 的线性增量，手感更像系统相机
        const s = ev.scale;
        const next = Math.max(0, Math.min(1, zoomStartSV.value + (s - 1) * 0.55));
        zoomSV.value = next;
      });
  }, [zoomSV, zoomStartSV]);

  const cameraAnimatedProps = useAnimatedProps(() => {
    return {
      zoom: zoomSV.value,
    } as any;
  }, []);

  const commitWatermarkPlacementIfNeeded = useCallback(
    (p: WatermarkPlacement, movedPx: number) => {
      if (movedPx < 2) return;
      const cur = watermarkRef.current;
      if (cur.kind === 'plugin') {
        setWatermark({ kind: 'plugin', id: cur.id, placement: p });
        return;
      }
      if (cur.kind === 'custom') {
        setWatermark({ kind: 'custom', watermark: { ...cur.watermark, placement: p } });
        void updateCustomWatermark(cur.watermark.id, { placement: p });
      }
    },
    [updateCustomWatermark],
  );

  /**
   * 水印拖拽使用 RN PanResponder，避免与 Reanimated + GestureDetector（相机 pinch）在原生层
   * 争用导致整页触摸失效（选水印后底部按钮全灭）。
   */
  const wmPanHandlers = useMemo(() => {
    if (!wmPreviewRect || !previewLayout || watermark.kind === 'none') return {};
    const rect = wmPreviewRect;
    const maxX = Math.max(1, previewLayout.w - rect.w);
    const maxY = Math.max(1, previewLayout.h - rect.h);
    return PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 8 || Math.abs(g.dy) > 8,
      onPanResponderGrant: () => {
        const cur = wmDragPxRef.current;
        wmPanGrantRef.current = {
          sx: cur?.x ?? rect.x,
          sy: cur?.y ?? rect.y,
        };
      },
      onPanResponderMove: (_, g) => {
        const { sx, sy } = wmPanGrantRef.current;
        const nx = Math.max(0, Math.min(maxX, sx + g.dx));
        const ny = Math.max(0, Math.min(maxY, sy + g.dy));
        setWmDragPx({ x: nx, y: ny });
      },
      onPanResponderRelease: (_, g) => {
        const { sx, sy } = wmPanGrantRef.current;
        const nx = Math.max(0, Math.min(maxX, sx + g.dx));
        const ny = Math.max(0, Math.min(maxY, sy + g.dy));
        const moved = Math.hypot(g.dx, g.dy);
        setWmDragPx(null);
        if (moved < 2) return;
        commitWatermarkPlacementIfNeeded(
          { x: maxX > 0 ? nx / maxX : 0.5, y: maxY > 0 ? ny / maxY : 0.85 },
          moved,
        );
      },
      onPanResponderTerminate: () => {
        setWmDragPx(null);
      },
    }).panHandlers;
  }, [wmPreviewRect, previewLayout, watermark.kind, commitWatermarkPlacementIfNeeded]);

  const onWatermarkDebugBrandPress = useCallback(() => {
    if (!__DEV__) return;
    const now = Date.now();
    const t = wmDebugTapRef.current;
    if (now - t.at > WM_DEBUG_TAP_RESET_MS) t.count = 0;
    t.count += 1;
    t.at = now;
    if (t.count >= 3) {
      t.count = 0;
      setWatermarkDebugPanel((v) => !v);
    }
  }, []);

  const closePickedGalleryPreview = useCallback(() => {
    setPickedGalleryPreviewUri(null);
  }, []);

  const onPickedGalleryImageError = useCallback(() => {
    Alert.alert(
      '无法显示照片',
      '可尝试在系统设置中授予完整相册访问权限，或使用开发版 (dev build) 测试。',
      [
        { text: '关闭', style: 'cancel', onPress: closePickedGalleryPreview },
        { text: '去设置', onPress: () => void Linking.openSettings() },
      ],
    );
  }, [closePickedGalleryPreview]);

  /**
   * 使用系统相册选择器（expo-image-picker），避免 Expo Go 下 MediaLibrary.getAssetsAsync
   * 批量枚举相册带来的数秒延迟。
   */
  const openGallery = useCallback(async () => {
    try {
      let libPerm = await ImagePicker.getMediaLibraryPermissionsAsync(false);
      if (!libPerm.granted) {
        libPerm = await ImagePicker.requestMediaLibraryPermissionsAsync(false);
      }
      if (!libPerm.granted) {
        Alert.alert('相册权限', '需要允许访问相册中的照片才能预览。', [
          { text: '取消', style: 'cancel' },
          { text: '去设置', onPress: () => void Linking.openSettings() },
        ]);
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 1,
        selectionLimit: 1,
      });
      if (result.canceled) return;
      const uri = result.assets[0]?.uri;
      if (uri) {
        setPickedGalleryPreviewUri(uri);
        setGalleryUri(uri);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      Alert.alert('相册', msg, [
        { text: '关闭', style: 'cancel' },
        { text: '去设置', onPress: () => void Linking.openSettings() },
      ]);
    }
  }, []);

  const advanceExportQueue = useCallback(() => {
    const next = exportQueueRef.current.shift();
    if (next) {
      setActiveExportJob(next);
    } else {
      exportProcessingRef.current = false;
      setActiveExportJob(null);
    }
  }, []);

  const scheduleExportJob = useCallback((job: ExportJob) => {
    exportQueueRef.current.push(job);
    if (!exportProcessingRef.current) {
      exportProcessingRef.current = true;
      const first = exportQueueRef.current.shift();
      if (first) setActiveExportJob(first);
    }
  }, []);

  const onFilmExported = useCallback(
    async (processedUri: string) => {
      try {
        const ok = await saveUriToLibrary(processedUri);
        // 写入相册后立刻用成片文件更新缩略图。若马上 getAssetsAsync，索引常未更新仍会拿到上一张。
        if (ok) setGalleryUri(processedUri);
      } finally {
        advanceExportQueue();
      }
    },
    [advanceExportQueue, saveUriToLibrary],
  );

  const onFilmError = useCallback(
    async (e: Error, fallbackUri: string) => {
      try {
        const ok = await saveUriToLibrary(fallbackUri);
        if (ok) {
          setGalleryUri(fallbackUri);
          Alert.alert(
            '已保存（原图）',
            '胶片矩阵处理失败，已保存未调色原图。详情：' + e.message,
          );
        }
      } finally {
        advanceExportQueue();
      }
    },
    [advanceExportQueue, saveUriToLibrary],
  );

  const resizeForPipeline = useCallback(async (uri: string, w: number, h: number) => {
    const longEdge = Math.max(w, h);
    const maxEdge = 1600;
    if (longEdge <= maxEdge) return { uri, width: w, height: h };
    const scale = maxEdge / longEdge;
    const nw = Math.round(w * scale);
    const nh = Math.round(h * scale);
    const r = await ImageManipulator.manipulateAsync(uri, [{ resize: { width: nw, height: nh } }], {
      compress: 0.92,
      format: ImageManipulator.SaveFormat.JPEG,
    });
    return { uri: r.uri, width: r.width, height: r.height };
  }, []);

  const takePhoto = useCallback(async () => {
    if (!camRef.current || !cameraReady) return;
    if (!cameraPermission?.granted) {
      const r = await requestCameraPermission();
      if (!r.granted) {
        Alert.alert('无相机权限', '请在系统设置中允许相机访问以使用拍照功能。');
        return;
      }
    }
    try {
      const raw = await camRef.current.takePictureAsync({ quality: 0.88 });
      if (!raw?.uri) {
        throw new Error('未能获取照片文件');
      }
      const sized = await resizeForPipeline(raw.uri, raw.width, raw.height);
      const matrix = combinedMatrix(preset, filter);
      scheduleExportJob({
        uri: sized.uri,
        width: sized.width,
        height: sized.height,
        matrix,
        fallbackUri: raw.uri,
        watermark,
      });
    } catch (e) {
      Alert.alert('拍照失败', e instanceof Error ? e.message : String(e));
    }
  }, [
    cameraPermission?.granted,
    cameraReady,
    filter,
    preset,
    requestCameraPermission,
    resizeForPipeline,
    scheduleExportJob,
    watermark,
  ]);

  const toggleRecord = useCallback(async () => {
    if (!camRef.current || !cameraReady) return;

    if (isRecording) {
      camRef.current.stopRecording();
      setIsRecording(false);
      try {
        const res = await recordingPromiseRef.current;
        recordingPromiseRef.current = null;
        if (res?.uri) {
          const ok = await saveUriToLibrary(res.uri);
          if (ok) {
            Alert.alert('已保存', '视频已保存到相册。');
            setGalleryUri(res.uri);
          }
        }
      } catch (e) {
        Alert.alert('录像保存失败', e instanceof Error ? e.message : String(e));
      }
      return;
    }

    if (!cameraPermission?.granted) {
      const r = await requestCameraPermission();
      if (!r.granted) {
        Alert.alert('无相机权限', '录像需要相机权限。');
        return;
      }
    }
    if (!micPermission?.granted) {
      const r = await requestMicPermission();
      if (!r.granted) {
        Alert.alert('无麦克风权限', '带声音的录像需要麦克风权限；也可在系统设置中开启。');
        return;
      }
    }

    try {
      const p = camRef.current.recordAsync({ maxDuration: 300 });
      recordingPromiseRef.current = p;
      setIsRecording(true);
    } catch (e) {
      setIsRecording(false);
      Alert.alert('无法开始录像', e instanceof Error ? e.message : String(e));
    }
  }, [
    cameraPermission?.granted,
    cameraReady,
    isRecording,
    micPermission?.granted,
    requestCameraPermission,
    requestMicPermission,
    saveUriToLibrary,
  ]);

  const shutterPress = useCallback(() => {
    if (mode === 'picture') void takePhoto();
    else void toggleRecord();
  }, [mode, takePhoto, toggleRecord]);

  const selectFilter = useCallback((i: number) => {
    setFilterIndex(i);
    setFilterSheetOpen(false);
  }, []);

  const selectFilmMode = useCallback((i: number) => {
    setFilmModeIndex(i);
    setFilmSheetOpen(false);
  }, []);

  const selectWatermark = useCallback((sel: WatermarkSelection) => {
    setWatermark(sel);
    setWatermarkSheetOpen(false);
  }, []);

  const permBanner =
    cameraPermission && !cameraPermission.granted ? (
      <View style={styles.banner}>
        <Text style={styles.bannerText}>需要相机权限才能预览与拍摄。</Text>
        <Pressable style={styles.bannerBtn} onPress={() => requestCameraPermission()}>
          <Text style={styles.bannerBtnText}>请求授权</Text>
        </Pressable>
      </View>
    ) : null;

  const renderFilmSheet = () => (
    <>
      <Text style={styles.sheetSectionTitle}>胶片</Text>
      <Text style={styles.sheetHint}>选择胶片模式（原相机无叠色；其它为预览示意，成片为矩阵处理）</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.sheetScroll}
      >
        {FILM_MODE_OPTIONS.map((p: RetroPreset, i: number) => (
          <SwatchTile
            key={p.id}
            colors={p.swatch}
            label={p.label}
            selected={i === filmModeIndex}
            onPress={() => selectFilmMode(i)}
          />
        ))}
      </ScrollView>
    </>
  );

  const renderWatermarkSheet = () => (
    <>
      <Text style={styles.sheetSectionTitle}>水印</Text>
      <Text style={styles.sheetHint}>插件水印 + 自定义水印（在右上角设置里上传/编辑）</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.sheetScroll}
      >
        {WATERMARK_OPTIONS.map((opt) => {
          const selected = watermark.kind === 'none'
            ? opt.id === 'none'
            : watermark.kind === 'plugin'
              ? watermark.id === opt.id
              : false;
          return (
            <WatermarkTile
              key={opt.id}
              label={opt.label}
              selected={selected}
              source={getWatermarkAssetSource(opt.id)}
              onPress={() =>
                selectWatermark(opt.id === 'none' ? { kind: 'none' } : { kind: 'plugin', id: opt.id as string, placement: undefined })
              }
            />
          );
        })}
        {customWatermarks.map((wm) => (
          <WatermarkTile
            key={wm.id}
            label={wm.name}
            selected={watermark.kind === 'custom' && watermark.watermark.id === wm.id}
            source={null}
            uri={wm.uri}
            onPress={() => selectWatermark({ kind: 'custom', watermark: wm })}
          />
        ))}
      </ScrollView>
    </>
  );

  const renderFilterSheet = () => (
    <>
      <Text style={styles.sheetSectionTitle}>滤镜</Text>
      <Text style={styles.sheetHint}>选择滤镜（预览叠色示意；成片为完整矩阵）</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.sheetScroll}
      >
        {FILTERS.map((f: FilmFilter, i: number) => (
          <SwatchTile
            key={f.id}
            colors={filterSwatch(f)}
            label={f.label}
            selected={i === filterIndex}
            onPress={() => selectFilter(i)}
          />
        ))}
      </ScrollView>
    </>
  );

  const flashHint = flashMode === 'off' ? '关' : '开';

  return (
    <SafeAreaView style={styles.root} edges={['top', 'left', 'right']}>
      <StatusBar style="light" />

      {activeExportJob ? (
        <FilmProcessor
          key={`${activeExportJob.uri}-${activeExportJob.matrix.join(',')}-${activeExportJob.watermark.kind === 'none' ? 'none' : activeExportJob.watermark.kind === 'plugin' ? activeExportJob.watermark.id : activeExportJob.watermark.watermark.id}`}
          uri={activeExportJob.uri}
          width={activeExportJob.width}
          height={activeExportJob.height}
          matrix={activeExportJob.matrix}
          watermark={activeExportJob.watermark}
          onExported={onFilmExported}
          onError={(err) => {
            void onFilmError(err, activeExportJob.fallbackUri);
          }}
        />
      ) : null}

      <Modal
        visible={filmSheetOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setFilmSheetOpen(false)}
      >
        <View style={styles.modalRoot}>
          <Pressable style={styles.modalBackdrop} onPress={() => setFilmSheetOpen(false)} />
          <View style={styles.sheetPanel}>
            <View style={styles.sheetHandle} />
            {renderFilmSheet()}
          </View>
        </View>
      </Modal>

      <Modal
        visible={filterSheetOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setFilterSheetOpen(false)}
      >
        <View style={styles.modalRoot}>
          <Pressable style={styles.modalBackdrop} onPress={() => setFilterSheetOpen(false)} />
          <View style={styles.sheetPanel}>
            <View style={styles.sheetHandle} />
            {renderFilterSheet()}
          </View>
        </View>
      </Modal>

      <Modal
        visible={watermarkSheetOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setWatermarkSheetOpen(false)}
      >
        <View style={styles.modalRoot}>
          <Pressable style={styles.modalBackdrop} onPress={() => setWatermarkSheetOpen(false)} />
          <View style={[styles.sheetPanel, styles.watermarkSheetPanel]}>
            <View style={styles.sheetHandle} />
            {renderWatermarkSheet()}
          </View>
        </View>
      </Modal>

      <Modal
        visible={pickedGalleryPreviewUri != null}
        animationType="fade"
        transparent
        statusBarTranslucent
        presentationStyle="overFullScreen"
        onRequestClose={closePickedGalleryPreview}
      >
        <View style={[styles.viewerModalRoot, { paddingTop: insets.top }]}>
          <View style={styles.viewerTopBar}>
            <Pressable
              onPress={closePickedGalleryPreview}
              style={styles.viewerCloseBtn}
              accessibilityLabel="关闭相册预览"
            >
              <Text style={styles.viewerCloseBtnText}>关闭</Text>
            </Pressable>
            <Text style={styles.viewerCount} accessibilityLiveRegion="polite">
              相册预览
            </Text>
            <View style={styles.viewerCloseBtnPlaceholder} />
          </View>
          {pickedGalleryPreviewUri ? (
            <View style={styles.viewerPage}>
              <Image
                testID="picked-gallery-preview-image"
                accessibilityLabel="已选照片预览"
                source={{ uri: pickedGalleryPreviewUri }}
                style={styles.viewerPageImage}
                resizeMode="contain"
                onError={onPickedGalleryImageError}
              />
            </View>
          ) : null}
          <View style={[styles.viewerFooterHint, { paddingBottom: Math.max(insets.bottom, 12) }]}>
            <Text style={styles.viewerCloseHintText}>在系统相册中选取；再次点击左下角可换一张</Text>
          </View>
        </View>
      </Modal>

      <View style={styles.retroHeader}>
        <Pressable
          style={styles.retroBrandBlock}
          onPress={onWatermarkDebugBrandPress}
          accessibilityLabel={__DEV__ ? '品牌（开发模式连点三次开水印调试）' : '品牌'}
        >
          <Text style={styles.retroBrandLine}>RETRO FILM</Text>
          <Text style={styles.retroBrandLineSmall}>CAMERA</Text>
        </Pressable>
        <View style={styles.retroHeaderRight}>
          <Pressable
            style={styles.retroGearBtn}
            accessibilityLabel="设置"
            onPress={() => setSettingsOpen(true)}
          >
            <Text style={styles.retroGearIcon}>⚙</Text>
          </Pressable>
        </View>
      </View>

      <Modal
        visible={settingsOpen}
        animationType="fade"
        transparent
        onRequestClose={() => setSettingsOpen(false)}
      >
        <View style={styles.modalRoot}>
          <Pressable style={styles.modalBackdrop} onPress={() => setSettingsOpen(false)} />
          <View style={[styles.sheetPanel, { maxHeight: '40%' }]}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetSectionTitle}>设置</Text>
            <Pressable
              testID="open-watermark-settings"
              style={styles.settingsRow}
              onPress={() => {
                setSettingsOpen(false);
                setWatermarkSettingsOpen(true);
              }}
            >
              <Text style={styles.settingsRowTitle}>水印设置</Text>
              <Text style={styles.settingsRowChevron}>›</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <WatermarkSettingsModal
        visible={watermarkSettingsOpen}
        onRequestClose={() => setWatermarkSettingsOpen(false)}
        onPickWatermark={(wm) => {
          setCustomWatermarks((prev) => {
            const has = prev.some((x) => x.id === wm.id);
            return has ? prev : [wm, ...prev];
          });
          setWatermark({ kind: 'custom', watermark: wm });
          setWatermarkSettingsOpen(false);
        }}
      />

      {permBanner}

      {__DEV__ && watermarkDebugPanel ? (
        <View style={styles.wmDebugPanel} pointerEvents="box-none">
          <Text style={styles.wmDebugTitle}>水印调试（连点 RETRO FILM 三次关闭）</Text>
          <Text style={styles.wmDebugLine} numberOfLines={3}>
            watermark:{' '}
            {watermark.kind === 'none'
              ? 'none'
              : watermark.kind === 'plugin'
                ? `plugin ${watermark.id}`
                : `custom ${watermark.watermark.id}`}
          </Text>
          <Text style={styles.wmDebugLine}>
            sheets film={String(filmSheetOpen)} filter={String(filterSheetOpen)} wm=
            {String(watermarkSheetOpen)} settingsWm={String(watermarkSettingsOpen)}
          </Text>
          <Text style={styles.wmDebugLine}>cameraReady={String(cameraReady)}</Text>
          <Text style={styles.wmDebugLine} numberOfLines={2}>
            displayWmRect: {displayWmRect ? JSON.stringify(displayWmRect) : 'null'}
          </Text>
          <Text style={styles.wmDebugLine}>
            previewLayout: {previewLayout ? `${previewLayout.w}x${previewLayout.h}` : 'null'}
          </Text>
        </View>
      ) : null}

      <View style={styles.previewFlex}>
        <View
          style={styles.previewCard}
          collapsable={false}
          onLayout={(e) => {
            const { width, height } = e.nativeEvent.layout;
            setPreviewLayout((prev) =>
              prev && prev.w === width && prev.h === height ? prev : { w: width, h: height },
            );
          }}
        >
          {cameraPermission?.granted ? (
            <GestureDetector gesture={pinchGesture}>
              <AnimatedCameraView
                ref={camRef}
                style={StyleSheet.absoluteFill}
                facing={facing}
                mode={mode}
                animatedProps={cameraAnimatedProps}
                flash={
                  mode === 'picture' && facing === 'back' ? flashMode : 'off'
                }
                enableTorch={
                  mode === 'picture' &&
                  facing === 'back' &&
                  flashMode === 'on'
                }
                mirror={facing === 'front'}
                onCameraReady={() => setCameraReady(true)}
                onMountError={(ev) => Alert.alert('相机错误', ev.message)}
              />
            </GestureDetector>
          ) : (
            <View style={styles.previewPlaceholder}>
              <Text style={styles.placeholderText}>相机未授权</Text>
            </View>
          )}
          <View
            pointerEvents="none"
            style={[
              previewTintLayerBase,
              {
                backgroundColor: preset.previewTint,
                opacity: preset.previewOpacity,
              },
            ]}
          />
          {filter.previewOverlay != null && filter.previewOverlay.opacity > 0 ? (
            <View
              pointerEvents="none"
              style={[
                previewTintLayerBase,
                {
                  backgroundColor: filter.previewOverlay.color,
                  opacity: filter.previewOverlay.opacity,
                },
              ]}
            />
          ) : null}
          {showGrid ? (
            <View style={styles.gridOverlay} pointerEvents="none">
              <View style={[styles.gridLineV, { left: '33.33%' }]} />
              <View style={[styles.gridLineV, { left: '66.66%' }]} />
              <View style={[styles.gridLineH, { top: '33.33%' }]} />
              <View style={[styles.gridLineH, { top: '66.66%' }]} />
            </View>
          ) : null}
          <View style={styles.vertBrandRail} pointerEvents="none">
            <Text style={styles.vertBrandText}>RETROCAM PRO</Text>
          </View>
          <View style={styles.previewHintBox} pointerEvents="none">
            <Text style={styles.previewHint}>
              成片保存至相册；预览为近似叠色（与矩阵成片仍有差异）
            </Text>
          </View>
          {isRecording ? (
            <View style={styles.recTimerWrap} pointerEvents="none">
              <View style={styles.recTimerPill}>
                <View style={styles.recDot} />
                <Text
                  testID="recording-duration"
                  style={styles.recTimerText}
                  accessibilityLiveRegion="polite"
                  accessibilityLabel={`录制中，时长 ${formatRecordingDuration(recordingElapsedSec)}`}
                >
                  {formatRecordingDuration(recordingElapsedSec)}
                </Text>
              </View>
            </View>
          ) : null}
          <View style={styles.filterBadge} pointerEvents="none">
            <Text style={styles.filterBadgeText}>
              {preset.label} · {filter.label}
            </Text>
          </View>
          {displayWmRect && watermark.kind !== 'none' ? (
            <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
              <View
                style={[
                  {
                    position: 'absolute',
                    left: displayWmRect.x,
                    top: displayWmRect.y,
                    width: displayWmRect.w,
                    height: displayWmRect.h,
                  },
                ]}
                pointerEvents="auto"
                {...wmPanHandlers}
              >
                <Image
                  source={
                    watermark.kind === 'plugin'
                      ? getWatermarkAssetSource(watermark.id)!
                      : { uri: watermark.watermark.uri }
                  }
                  style={[styles.watermarkPreviewImage, { opacity: wmRenderCfg.opacity }]}
                  resizeMode="stretch"
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                />
              </View>
            </View>
          ) : null}
          {!cameraReady && cameraPermission?.granted ? (
            <View style={styles.busyWrap}>
              <ActivityIndicator size="large" color="#fff" />
              <Text style={styles.busyTxt}>正在启动相机…</Text>
            </View>
          ) : null}
        </View>
      </View>

      <View style={styles.modeRow}>
        <Pressable
          style={[styles.modeChip, mode === 'picture' && styles.modeChipOn]}
          onPress={() => setMode('picture')}
        >
          <Text style={[styles.modeChipTxt, mode === 'picture' && styles.modeChipTxtOn]}>照片</Text>
        </Pressable>
        <Pressable
          style={[styles.modeChip, mode === 'video' && styles.modeChipOn]}
          onPress={() => setMode('video')}
        >
          <Text style={[styles.modeChipTxt, mode === 'video' && styles.modeChipTxtOn]}>录像</Text>
        </Pressable>
      </View>

      <View style={styles.featureStrip}>
        <Pressable
          testID="open-film-sheet"
          style={styles.featureToolCol}
          onPress={() => {
            setFilterSheetOpen(false);
            setWatermarkSheetOpen(false);
            setFilmSheetOpen(true);
          }}
          accessibilityLabel={`胶片模式，当前 ${preset.label}`}
        >
          <View style={[styles.featureCircle, filmSheetOpen && styles.featureCircleActive]}>
            <Ionicons name="film-outline" size={22} color={C.gold} />
          </View>
        </Pressable>
        <Pressable
          testID="open-filter-sheet"
          style={styles.featureToolCol}
          onPress={() => {
            setFilmSheetOpen(false);
            setWatermarkSheetOpen(false);
            setFilterSheetOpen(true);
          }}
          accessibilityLabel={`滤镜，当前 ${filter.label}`}
        >
          <View
            style={[styles.featureCircle, filterSheetOpen && styles.featureCircleActive]}
          >
            <Ionicons name="color-filter-outline" size={22} color={C.gold} />
          </View>
        </Pressable>
        <Pressable
          testID="open-watermark-sheet"
          style={styles.featureToolCol}
          onPress={() => {
            setFilmSheetOpen(false);
            setFilterSheetOpen(false);
            setWatermarkSheetOpen(true);
          }}
          accessibilityLabel={`水印`}
        >
          <View
            style={[styles.featureCircle, watermarkSheetOpen && styles.featureCircleActive]}
          >
            <Ionicons
              name="water-outline"
              size={22}
              color={watermark.kind === 'none' ? C.goldMuted : C.gold}
            />
          </View>
        </Pressable>
        <Pressable
          style={styles.featureToolCol}
          onPress={() => setShowGrid((g) => !g)}
          accessibilityLabel="构图网格"
        >
          <View style={[styles.featureCircle, showGrid && styles.featureCircleActive]}>
            <GridGlyph active={showGrid} />
          </View>
        </Pressable>
        <Pressable
          style={styles.featureToolCol}
          onPress={cycleFlash}
          accessibilityLabel={`闪光灯 ${flashHint}`}
        >
          <View style={[styles.featureCircle, flashMode !== 'off' && styles.featureCircleActive]}>
            <View style={styles.flashIconBox}>
              <Text
                style={[
                  styles.flashGlyph,
                  flashMode === 'off' ? styles.flashGlyphOff : styles.flashGlyphOn,
                ]}
              >
                ⚡
              </Text>
              {flashMode === 'off' ? <View style={styles.flashSlash} /> : null}
            </View>
          </View>
        </Pressable>
      </View>

      <View style={styles.goldDivider} />

      <View
        style={[
          styles.bottomBar,
          { paddingBottom: 22 + Math.max(insets.bottom, 12) },
        ]}
      >
        <View style={styles.bottomSide}>
          <Pressable
            testID="open-gallery"
            style={styles.bottomSidePress}
            onPress={() => void openGallery()}
            accessibilityLabel="相册"
          >
            <View style={styles.bottomSideCircle}>
              {galleryUri ? (
                <Image
                  source={{ uri: galleryUri }}
                  style={styles.galleryCircleImage}
                  resizeMode="cover"
                />
              ) : (
                <Ionicons name="images-outline" size={23} color={C.goldMuted} />
              )}
            </View>
          </Pressable>
        </View>
        <View style={styles.bottomCenter}>
          <Pressable
            style={[styles.shutter, isRecording && styles.shutterRec]}
            onPress={shutterPress}
            disabled={!cameraPermission?.granted}
            accessibilityLabel={mode === 'picture' ? '拍照' : '录像'}
          >
            <View style={[styles.shutterMetal, isRecording && styles.shutterMetalRec]}>
              <View style={[styles.shutterMetalCore, isRecording && styles.shutterMetalCoreRec]} />
            </View>
          </Pressable>
        </View>
        <View style={styles.bottomSide}>
          <Pressable
            style={styles.bottomSidePress}
            onPress={() => setFacing((f) => (f === 'back' ? 'front' : 'back'))}
            accessibilityLabel="翻转相机"
          >
            <View style={styles.bottomSideCircle}>
              <Ionicons name="camera-reverse" size={26} color={C.gold} />
            </View>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  modalBackdrop: { ...StyleSheet.absoluteFillObject },
  sheetPanel: {
    backgroundColor: C.sheet,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingBottom: 28,
    paddingHorizontal: 16,
    maxHeight: '48%',
  },
  settingsRow: {
    marginTop: 10,
    paddingVertical: 14,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.04)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  settingsRowTitle: { fontSize: 15, fontWeight: '800', color: '#2a2824' },
  settingsRowChevron: { fontSize: 18, fontWeight: '900', color: '#5c5850' },
  sheetHandle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.sheetLine,
    marginTop: 10,
    marginBottom: 14,
  },
  sheetSectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#2a2824',
    marginBottom: 4,
  },
  sheetHint: { fontSize: 12, color: '#7a756c', marginBottom: 12 },
  sheetScroll: { paddingRight: 8, gap: 4 },
  sheetTile: {
    width: 86,
    marginRight: 12,
    alignItems: 'center',
  },
  sheetSwatchOuter: {
    borderRadius: 14,
    padding: 3,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  sheetSwatchOuterOn: {
    borderColor: C.gold,
  },
  sheetSwatch: {
    width: 72,
    height: 72,
    borderRadius: 12,
    overflow: 'hidden',
    flexDirection: 'row',
  },
  sheetSwatchHalf: { flex: 1 },
  watermarkThumbBox: {
    width: 72,
    height: 72,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#15110d',
    alignItems: 'center',
    justifyContent: 'center',
  },
  watermarkThumbImage: {
    width: '100%',
    height: '100%',
  },
  sheetTileLabel: {
    marginTop: 8,
    fontSize: 12,
    color: '#5c5850',
    textAlign: 'center',
    maxWidth: 86,
  },
  sheetTileLabelOn: {
    color: '#1a1816',
    fontWeight: '700',
    backgroundColor: '#e8e2d6',
    overflow: 'hidden',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  retroHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingTop: 2,
    paddingBottom: 8,
  },
  retroBrandBlock: { flex: 1, alignSelf: 'stretch', justifyContent: 'center' },
  wmDebugPanel: {
    marginHorizontal: 10,
    marginBottom: 6,
    padding: 10,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.82)',
    borderWidth: 1,
    borderColor: 'rgba(201,169,98,0.5)',
  },
  wmDebugTitle: { color: C.gold, fontWeight: '800', fontSize: 12, marginBottom: 6 },
  wmDebugLine: { color: 'rgba(255,255,255,0.88)', fontSize: 10, fontFamily: 'monospace', marginBottom: 3 },
  retroBrandLine: {
    color: C.gold,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 2,
  },
  retroBrandLineSmall: {
    color: C.goldMuted,
    fontSize: 9,
    fontWeight: '600',
    letterSpacing: 3,
    marginTop: 2,
  },
  retroHeaderRight: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 4,
  },
  retroGearBtn: {
    padding: 6,
    marginRight: -4,
  },
  retroGearIcon: { color: C.gold, fontSize: 19 },
  banner: {
    marginHorizontal: 12,
    marginBottom: 8,
    padding: 12,
    borderRadius: 10,
    backgroundColor: '#2a2420',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  bannerText: { color: '#f5e6d3', flex: 1, fontSize: 13 },
  bannerBtn: { backgroundColor: C.gold, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  bannerBtnText: { color: '#1a1a1a', fontWeight: '700', fontSize: 13 },
  gridGlyph: {
    width: 24,
    height: 24,
    justifyContent: 'space-between',
  },
  gridGlyphRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    flex: 1,
  },
  gridGlyphCell: {
    width: 6,
    height: 6,
    borderRadius: 1.5,
  },
  gridGlyphCellOn: {
    borderWidth: 1,
    borderColor: C.gold,
    backgroundColor: 'rgba(212,175,55,0.18)',
  },
  gridGlyphCellOff: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
    backgroundColor: 'transparent',
  },
  featureStrip: {
    width: '100%',
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
    paddingTop: 2,
    paddingBottom: 6,
    minHeight: 58,
  },
  watermarkSheetPanel: {
    maxHeight: '62%',
  },
  watermarkList: {
    maxHeight: 320,
    marginTop: 4,
  },
  watermarkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0,0,0,0.08)',
  },
  watermarkRowOn: {
    backgroundColor: 'rgba(201,169,98,0.12)',
    borderRadius: 10,
  },
  watermarkRowText: { flex: 1, paddingRight: 8 },
  watermarkRowLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: '#2a2824',
  },
  featureToolCol: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureCircle: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: C.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  featureCircleActive: {
    borderColor: 'rgba(201,169,98,0.75)',
    backgroundColor: 'rgba(201,169,98,0.1)',
  },
  flashIconBox: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flashGlyph: { fontSize: 16 },
  flashGlyphOn: { color: C.gold },
  flashGlyphOff: { color: 'rgba(255,255,255,0.35)' },
  flashSlash: {
    position: 'absolute',
    width: 21,
    height: 2,
    backgroundColor: C.goldMuted,
    transform: [{ rotate: '-52deg' }],
    borderRadius: 1,
  },
  goldDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: C.line,
    marginHorizontal: 10,
    marginBottom: 6,
  },
  vertBrandRail: {
    position: 'absolute',
    left: 4,
    top: 0,
    bottom: 0,
    width: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  vertBrandText: {
    color: C.goldMuted,
    fontSize: 8,
    letterSpacing: 1.5,
    fontWeight: '700',
    transform: [{ rotate: '-90deg' }],
    width: 120,
    textAlign: 'center',
  },
  modeRow: {
    flexDirection: 'row',
    alignSelf: 'center',
    backgroundColor: C.surface,
    borderRadius: 999,
    padding: 3,
    marginBottom: 4,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  modeChip: {
    paddingHorizontal: 18,
    paddingVertical: 7,
    borderRadius: 999,
  },
  modeChipOn: { backgroundColor: 'rgba(212,175,55,0.2)' },
  modeChipTxt: { fontSize: 13, color: C.textDim, fontWeight: '500' },
  modeChipTxtOn: { color: C.gold, fontWeight: '700' },
  previewFlex: {
    flex: 1,
    marginHorizontal: 14,
    marginBottom: 4,
    minHeight: 120,
  },
  previewCard: {
    flex: 1,
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: '#000',
    isolation: 'isolate',
  },
  gridOverlay: { ...StyleSheet.absoluteFillObject },
  gridLineV: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 2,
    backgroundColor: 'rgba(255,255,255,0.5)',
  },
  gridLineH: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: 'rgba(255,255,255,0.5)',
  },
  previewPlaceholder: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#111',
  },
  placeholderText: { color: '#888', fontSize: 15 },
  previewHintBox: {
    position: 'absolute',
    top: 14,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  previewHint: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 13,
    letterSpacing: 0.5,
  },
  recTimerWrap: {
    position: 'absolute',
    top: 40,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  recTimerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  recDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#e04545',
  },
  recTimerText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    letterSpacing: 0.5,
  },
  filterBadge: {
    position: 'absolute',
    bottom: 50,
    left: 12,
    right: 12,
    alignItems: 'center',
  },
  filterBadgeText: {
    color: 'rgba(255,255,255,0.95)',
    fontSize: 11,
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 10,
    overflow: 'hidden',
  },
  watermarkPreviewImage: {
    width: '100%',
    height: '100%',
  },
  busyWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.4)',
    gap: 12,
  },
  busyTxt: { color: '#fff', fontSize: 14 },
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingTop: 4,
  },
  bottomSide: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 4 },
  bottomCenter: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  bottomSidePress: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 8,
  },
  bottomSideCircle: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: C.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(201,169,98,0.45)',
    overflow: 'hidden',
  },
  galleryCircleImage: {
    width: '100%',
    height: '100%',
  },
  shutter: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2a221c',
    borderWidth: 2,
    borderColor: '#4a3d32',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.45,
    shadowRadius: 4,
    elevation: 6,
  },
  shutterRec: {
    borderColor: '#822',
    backgroundColor: '#3d1818',
  },
  shutterMetal: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#b8924a',
    borderWidth: 3,
    borderTopColor: '#e8d5a8',
    borderLeftColor: '#d4bc78',
    borderRightColor: '#7a6238',
    borderBottomColor: '#4a3a28',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterMetalRec: {
    backgroundColor: '#c44',
    borderTopColor: '#e88',
    borderLeftColor: '#d66',
    borderRightColor: '#822',
    borderBottomColor: '#511',
  },
  shutterMetalCore: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#9a7a3e',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
  },
  shutterMetalCoreRec: {
    backgroundColor: '#a22',
    borderColor: 'rgba(255,255,255,0.15)',
  },
  viewerModalRoot: {
    flex: 1,
    backgroundColor: '#000',
  },
  viewerTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingBottom: 4,
  },
  viewerCloseBtn: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    minWidth: 64,
  },
  viewerCloseBtnPlaceholder: {
    minWidth: 64,
  },
  viewerCloseBtnText: {
    color: C.gold,
    fontSize: 16,
    fontWeight: '600',
  },
  viewerCount: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 15,
    fontVariant: ['tabular-nums'],
  },
  viewerPage: {
    flex: 1,
    justifyContent: 'center',
    backgroundColor: '#000',
  },
  viewerPageImage: {
    width: '100%',
    height: '100%',
  },
  viewerFooterHint: {
    alignItems: 'center',
    paddingTop: 6,
  },
  viewerCloseHintText: { color: 'rgba(255,255,255,0.5)', fontSize: 12 },
});
