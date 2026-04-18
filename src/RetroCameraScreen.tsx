import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type ViewStyle,
  type ViewToken,
} from 'react-native';
import {
  CameraView,
  type FlashMode,
  useCameraPermissions,
  useMicrophonePermissions,
} from 'expo-camera';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImageManipulator from 'expo-image-manipulator';
import * as MediaLibrary from 'expo-media-library';
import { StatusBar } from 'expo-status-bar';

import { FILTERS, PRESETS, combinedMatrix, type FilmFilter, type RetroPreset } from './colorMatrix';
import { FilmProcessor } from './FilmProcessor';
import { getQuickDisplayUri, resolveAssetDisplayUri } from './galleryAssetUri';
import { getMediaLibraryAccessRequestOptions } from './mediaLibraryPermission';
/** 相册预览一次拉取最近照片数量（新→旧） */
const GALLERY_PAGE_SIZE = 80;

/** RN 实验属性：与下层相机用 multiply 混合，减轻半透明浅色 normal 叠层的「发白、发糊」 */
const previewMultiplyLayerBase = {
  ...StyleSheet.absoluteFillObject,
  experimental_mixBlendMode: 'multiply',
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

function GallerySlide({
  asset,
  pageWidth,
  onImageError,
}: {
  asset: MediaLibrary.Asset;
  pageWidth: number;
  onImageError: () => void;
}) {
  const quick = useMemo(() => getQuickDisplayUri(asset), [asset.id, asset.uri]);
  const [uri, setUri] = useState(quick);

  useEffect(() => {
    setUri(quick);
  }, [quick]);

  useEffect(() => {
    if (quick) return;
    let cancelled = false;
    void (async () => {
      const u = await resolveAssetDisplayUri(asset);
      if (!cancelled && u) setUri(u);
    })();
    return () => {
      cancelled = true;
    };
  }, [asset, quick]);

  if (!uri) {
    return (
      <View style={[styles.viewerPage, { width: pageWidth }]}>
        <ActivityIndicator color={C.gold} style={styles.viewerSlideLoading} />
      </View>
    );
  }

  return (
    <View style={[styles.viewerPage, { width: pageWidth }]}>
      <Image
        source={{ uri }}
        style={styles.viewerPageImage}
        resizeMode="contain"
        onError={onImageError}
      />
    </View>
  );
}

type SheetKind = 'camera' | 'filter' | null;

type ExportJob = {
  uri: string;
  width: number;
  height: number;
  matrix: number[];
  fallbackUri: string;
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
  const { width: windowWidth } = useWindowDimensions();

  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [micPermission, requestMicPermission] = useMicrophonePermissions();

  const [cameraReady, setCameraReady] = useState(false);
  const [facing, setFacing] = useState<'back' | 'front'>('back');
  const [mode, setMode] = useState<'picture' | 'video'>('picture');
  const [presetIndex, setPresetIndex] = useState(0);
  const [filterIndex, setFilterIndex] = useState(0);
  const [sheet, setSheet] = useState<SheetKind>(null);
  const [flashMode, setFlashMode] = useState<FlashMode>('off');
  const [showGrid, setShowGrid] = useState(false);
  const [galleryUri, setGalleryUri] = useState<string | null>(null);
  const [galleryViewerAssets, setGalleryViewerAssets] = useState<MediaLibrary.Asset[] | null>(
    null,
  );
  const [galleryViewerIndex, setGalleryViewerIndex] = useState(0);

  const [activeExportJob, setActiveExportJob] = useState<ExportJob | null>(null);
  const exportQueueRef = useRef<ExportJob[]>([]);
  const exportProcessingRef = useRef(false);

  const [isRecording, setIsRecording] = useState(false);
  const recordingPromiseRef = useRef<Promise<{ uri: string } | undefined> | null>(
    null,
  );

  const preset = PRESETS[presetIndex];
  const filter = FILTERS[filterIndex];

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

  const cycleFlash = useCallback(() => {
    setFlashMode((f) => (f === 'off' ? 'on' : 'off'));
  }, []);

  const onGalleryViewableRef = useRef((info: { viewableItems: ViewToken[] }) => {
    const idx = info.viewableItems[0]?.index;
    if (typeof idx === 'number') setGalleryViewerIndex(idx);
  });

  const viewabilityConfigGallery = useRef({
    itemVisiblePercentThreshold: 55,
  }).current;

  const closeGalleryViewer = useCallback(() => {
    setGalleryViewerAssets(null);
    setGalleryViewerIndex(0);
  }, []);

  const onGallerySlideImageError = useCallback(() => {
    Alert.alert(
      '无法显示照片',
      '可尝试在系统设置中授予完整相册访问权限，或使用开发版 (dev build) 测试。',
      [
        { text: '关闭', style: 'cancel', onPress: closeGalleryViewer },
        { text: '去设置', onPress: () => void Linking.openSettings() },
      ],
    );
  }, [closeGalleryViewer]);

  const openGallery = useCallback(async () => {
    const ok = await ensureMediaPermission();
    if (!ok) {
      Alert.alert('相册权限', '需要允许访问相册中的照片才能预览。', [
        { text: '取消', style: 'cancel' },
        { text: '去设置', onPress: () => void Linking.openSettings() },
      ]);
      return;
    }
    try {
      const page = await MediaLibrary.getAssetsAsync({
        first: GALLERY_PAGE_SIZE,
        mediaType: MediaLibrary.MediaType.photo,
        sortBy: MediaLibrary.SortBy.creationTime,
      });
      if (page.assets.length === 0) {
        Alert.alert('相册', '还没有照片，先拍一张吧。');
        return;
      }
      setGalleryViewerIndex(0);
      setGalleryViewerAssets(page.assets);
      const first = page.assets[0];
      const thumb = getQuickDisplayUri(first);
      if (thumb) {
        setGalleryUri(thumb);
      } else {
        void resolveAssetDisplayUri(first).then((u) => {
          if (u) setGalleryUri(u);
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      Alert.alert('相册', msg, [
        { text: '关闭', style: 'cancel' },
        { text: '去设置', onPress: () => void Linking.openSettings() },
      ]);
    }
  }, [ensureMediaPermission]);

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
        await saveUriToLibrary(processedUri);
        await refreshGalleryThumb();
      } finally {
        advanceExportQueue();
      }
    },
    [advanceExportQueue, refreshGalleryThumb, saveUriToLibrary],
  );

  const onFilmError = useCallback(
    async (e: Error, fallbackUri: string) => {
      try {
        const ok = await saveUriToLibrary(fallbackUri);
        if (ok) {
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
            await refreshGalleryThumb();
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
      Alert.alert('无法开始录像', e instanceof Error ? e.message : String(e));
    }
  }, [
    cameraPermission?.granted,
    cameraReady,
    isRecording,
    micPermission?.granted,
    requestCameraPermission,
    requestMicPermission,
    refreshGalleryThumb,
    saveUriToLibrary,
  ]);

  const shutterPress = useCallback(() => {
    if (mode === 'picture') void takePhoto();
    else void toggleRecord();
  }, [mode, takePhoto, toggleRecord]);

  const selectPreset = useCallback((i: number) => {
    setPresetIndex(i);
    setSheet(null);
  }, []);

  const selectFilter = useCallback((i: number) => {
    setFilterIndex(i);
    setSheet(null);
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

  const renderSheet = (kind: 'camera' | 'filter') => (
    <>
      <Text style={styles.sheetSectionTitle}>{kind === 'camera' ? '相机' : '滤镜'}</Text>
      <Text style={styles.sheetHint}>
        {kind === 'camera'
          ? '选择相机风格（预览叠色示意；成片为完整矩阵）'
          : '选择滤镜（预览叠色示意；成片为完整矩阵）'}
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.sheetScroll}
      >
        {kind === 'camera'
          ? PRESETS.map((p: RetroPreset, i: number) => (
              <SwatchTile
                key={p.id}
                colors={p.swatch}
                label={p.label}
                selected={i === presetIndex}
                onPress={() => selectPreset(i)}
              />
            ))
          : FILTERS.map((f: FilmFilter, i: number) => (
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
          key={`${activeExportJob.uri}-${activeExportJob.matrix.join(',')}`}
          uri={activeExportJob.uri}
          width={activeExportJob.width}
          height={activeExportJob.height}
          matrix={activeExportJob.matrix}
          onExported={onFilmExported}
          onError={(err) => {
            void onFilmError(err, activeExportJob.fallbackUri);
          }}
        />
      ) : null}

      <Modal
        visible={sheet !== null}
        animationType="slide"
        transparent
        onRequestClose={() => setSheet(null)}
      >
        <View style={styles.modalRoot}>
          <Pressable style={styles.modalBackdrop} onPress={() => setSheet(null)} />
          <View style={styles.sheetPanel}>
            <View style={styles.sheetHandle} />
            {sheet ? renderSheet(sheet) : null}
          </View>
        </View>
      </Modal>

      <Modal
        visible={galleryViewerAssets != null && galleryViewerAssets.length > 0}
        animationType="fade"
        transparent
        statusBarTranslucent
        presentationStyle="overFullScreen"
        onRequestClose={closeGalleryViewer}
      >
        <View style={[styles.viewerModalRoot, { paddingTop: insets.top }]}>
          <View style={styles.viewerTopBar}>
            <Pressable
              onPress={closeGalleryViewer}
              style={styles.viewerCloseBtn}
              accessibilityLabel="关闭相册预览"
            >
              <Text style={styles.viewerCloseBtnText}>关闭</Text>
            </Pressable>
            <Text style={styles.viewerCount} accessibilityLiveRegion="polite">
              {galleryViewerAssets != null && galleryViewerAssets.length > 0
                ? `${galleryViewerIndex + 1} / ${galleryViewerAssets.length}`
                : ''}
            </Text>
            <View style={styles.viewerCloseBtnPlaceholder} />
          </View>
          <FlatList
            style={styles.viewerList}
            data={galleryViewerAssets ?? []}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            keyExtractor={(item, index) => `${item.id}-${index}`}
            renderItem={({ item }) => (
              <GallerySlide
                asset={item}
                pageWidth={windowWidth}
                onImageError={onGallerySlideImageError}
              />
            )}
            onViewableItemsChanged={onGalleryViewableRef.current}
            viewabilityConfig={viewabilityConfigGallery}
            getItemLayout={(_, index) => ({
              length: windowWidth,
              offset: windowWidth * index,
              index,
            })}
            initialNumToRender={2}
            maxToRenderPerBatch={3}
            windowSize={3}
          />
          <View style={[styles.viewerFooterHint, { paddingBottom: Math.max(insets.bottom, 12) }]}>
            <Text style={styles.viewerCloseHintText}>左右滑动查看其他照片</Text>
          </View>
        </View>
      </Modal>

      <View style={styles.retroHeader}>
        <View style={styles.retroBrandBlock}>
          <Text style={styles.retroBrandLine}>RETRO FILM</Text>
          <Text style={styles.retroBrandLineSmall}>CAMERA</Text>
        </View>
        <View style={styles.retroExpBox}>
          <Text style={styles.retroExpText}>
            <Text style={styles.retroExpDot}>● </Text>
            000 EXP
          </Text>
        </View>
        <View style={styles.retroHeaderRight}>
          <Pressable
            style={styles.retroGearBtn}
            accessibilityLabel="设置"
            onPress={() => Alert.alert('设置', '更多选项将在后续版本开放。')}
          >
            <Text style={styles.retroGearIcon}>⚙</Text>
          </Pressable>
        </View>
      </View>

      {permBanner}

      <View style={styles.previewFlex}>
        <View style={styles.previewCard} collapsable={false}>
          {cameraPermission?.granted ? (
            <CameraView
              ref={camRef}
              style={StyleSheet.absoluteFill}
              facing={facing}
              mode={mode}
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
          ) : (
            <View style={styles.previewPlaceholder}>
              <Text style={styles.placeholderText}>相机未授权</Text>
            </View>
          )}
          <View
            pointerEvents="none"
            style={[
              previewMultiplyLayerBase,
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
                previewMultiplyLayerBase,
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
            <Text style={styles.previewHint}>成片保存至相册；预览为叠色示意</Text>
          </View>
          <View style={styles.filterBadge} pointerEvents="none">
            <Text style={styles.filterBadgeText}>
              {preset.label} · {filter.label}
            </Text>
          </View>
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
          testID="open-camera-sheet"
          style={styles.featureToolCol}
          onPress={() => setSheet('camera')}
          accessibilityLabel={`相机风格，当前 ${preset.label}`}
        >
          <View
            style={[styles.featureCircle, sheet === 'camera' && styles.featureCircleActive]}
          >
            <View style={styles.topToolCamGlyph}>
              <View style={styles.topToolCamLens} />
              <View style={styles.topToolCamBody} />
            </View>
          </View>
          <View style={styles.featureCaptionSpacer} />
        </Pressable>
        <Pressable
          testID="open-filter-sheet"
          style={styles.featureToolCol}
          onPress={() => setSheet('filter')}
          accessibilityLabel={`滤镜，当前 ${filter.label}`}
        >
          <View style={[styles.featureCircle, sheet === 'filter' && styles.featureCircleActive]}>
            <View style={styles.topToolSwatch}>
              <View style={[styles.topToolSwatchHalf, { backgroundColor: filterSwatch(filter)[0] }]} />
              <View style={[styles.topToolSwatchHalf, { backgroundColor: filterSwatch(filter)[1] }]} />
            </View>
          </View>
          <View style={styles.featureCaptionSpacer} />
        </Pressable>
        <Pressable
          style={styles.featureToolCol}
          onPress={() => setShowGrid((g) => !g)}
          accessibilityLabel="构图网格"
        >
          <View style={[styles.featureCircle, showGrid && styles.featureCircleActive]}>
            <GridGlyph active={showGrid} />
          </View>
          <Text style={styles.featureCaption}>九宫格</Text>
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
          <Text style={styles.featureCaption}>闪光</Text>
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
            style={styles.galleryStackPress}
            onPress={() => void openGallery()}
            accessibilityLabel="相册"
          >
            <View style={styles.galleryStackStage}>
              <View style={[styles.galleryStackSheet, styles.galleryStackSheetBack]} />
              <View style={[styles.galleryStackSheet, styles.galleryStackSheetMid]} />
              <View style={[styles.galleryStackSheet, styles.galleryStackSheetFront]}>
                {galleryUri ? (
                  <Image source={{ uri: galleryUri }} style={styles.galleryStackImg} />
                ) : (
                  <View style={styles.galleryStackEmpty}>
                    <Text style={styles.galleryStackEmptyTxt}>+</Text>
                  </View>
                )}
                <View style={styles.galleryPlayCorner}>
                  <Text style={styles.galleryPlayGlyph}>▶</Text>
                </View>
              </View>
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
          <Text style={styles.shutterLabel}>SHUTTER</Text>
        </View>
        <View style={styles.bottomSide}>
          <Pressable
            style={styles.flipBtn}
            onPress={() => setFacing((f) => (f === 'back' ? 'front' : 'back'))}
            accessibilityLabel="翻转相机"
          >
            <View style={styles.flipIcon}>
              <Text style={styles.flipIconGlyph}>↻</Text>
              <View style={styles.flipCamDot} />
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
  retroBrandBlock: { flex: 1.1 },
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
  retroExpBox: {
    borderWidth: 1,
    borderColor: C.goldMuted,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  retroExpText: {
    color: C.gold,
    fontSize: 11,
    fontVariant: ['tabular-nums'],
    letterSpacing: 0.5,
    fontWeight: '600',
  },
  retroExpDot: { color: '#c45c5c' },
  retroHeaderRight: {
    flex: 1.1,
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
    width: 27,
    height: 27,
    justifyContent: 'space-between',
  },
  gridGlyphRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    flex: 1,
  },
  gridGlyphCell: {
    width: 7,
    height: 7,
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
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 8,
  },
  featureToolCol: {
    alignItems: 'center',
    width: 72,
  },
  featureCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
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
  featureCaption: {
    marginTop: 5,
    fontSize: 10,
    color: C.goldMuted,
    fontWeight: '500',
    letterSpacing: 0.5,
  },
  featureCaptionSpacer: { height: 19 },
  flashIconBox: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flashGlyph: { fontSize: 20 },
  flashGlyphOn: { color: C.gold },
  flashGlyphOff: { color: 'rgba(255,255,255,0.35)' },
  flashSlash: {
    position: 'absolute',
    width: 22,
    height: 2,
    backgroundColor: C.goldMuted,
    transform: [{ rotate: '-52deg' }],
    borderRadius: 1,
  },
  goldDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: C.line,
    marginHorizontal: 24,
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
  topToolCamGlyph: {
    position: 'relative',
    width: 26,
    height: 22,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  topToolCamLens: {
    position: 'absolute',
    top: 0,
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: C.gold,
    backgroundColor: 'rgba(212,175,55,0.12)',
  },
  topToolCamBody: {
    width: 22,
    height: 11,
    borderBottomLeftRadius: 3,
    borderBottomRightRadius: 3,
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
    borderWidth: 1.5,
    borderColor: C.gold,
    marginTop: 8,
  },
  topToolSwatch: {
    width: 28,
    height: 28,
    borderRadius: 9,
    overflow: 'hidden',
    flexDirection: 'row',
  },
  topToolSwatchHalf: { flex: 1 },
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
    width: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  gridLineH: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.35)',
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
  galleryStackPress: {
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
  galleryStackStage: {
    width: 56,
    height: 52,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  galleryStackSheet: {
    position: 'absolute',
    width: 44,
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.goldMuted,
    backgroundColor: C.panel,
  },
  galleryStackSheetBack: {
    transform: [{ translateX: -6 }, { translateY: -10 }, { rotate: '-8deg' }],
    opacity: 0.4,
  },
  galleryStackSheetMid: {
    transform: [{ translateX: 5 }, { translateY: -5 }, { rotate: '6deg' }],
    opacity: 0.62,
  },
  galleryStackSheetFront: {
    transform: [{ translateY: 2 }],
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.surface,
  },
  galleryStackImg: { width: '100%', height: '100%' },
  galleryStackEmpty: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1f1a16',
  },
  galleryStackEmptyTxt: { color: C.goldMuted, fontSize: 22, fontWeight: '300' },
  galleryPlayCorner: {
    position: 'absolute',
    right: 3,
    bottom: 3,
    width: 15,
    height: 15,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(201,169,98,0.35)',
  },
  galleryPlayGlyph: { color: C.goldBright, fontSize: 7, marginLeft: 1 },
  shutter: {
    width: 84,
    height: 84,
    borderRadius: 42,
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
    width: 66,
    height: 66,
    borderRadius: 33,
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
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#9a7a3e',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
  },
  shutterMetalCoreRec: {
    backgroundColor: '#a22',
    borderColor: 'rgba(255,255,255,0.15)',
  },
  shutterLabel: {
    marginTop: 6,
    fontSize: 9,
    letterSpacing: 2,
    fontWeight: '700',
    color: C.goldMuted,
  },
  flipBtn: { alignItems: 'center', justifyContent: 'center', paddingBottom: 8 },
  flipIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: C.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  flipIconGlyph: {
    fontSize: 26,
    color: C.gold,
    fontWeight: '300',
    marginTop: -2,
  },
  flipCamDot: {
    position: 'absolute',
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: C.gold,
    opacity: 0.85,
    bottom: 12,
    right: 12,
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
  viewerList: { flex: 1 },
  viewerPage: {
    flex: 1,
    justifyContent: 'center',
    backgroundColor: '#000',
  },
  viewerSlideLoading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
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
