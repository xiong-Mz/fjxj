import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';

import type { CustomWatermark, WatermarkAnchor } from './watermarkTypes';
import {
  importPngToCustomWatermark,
  loadCustomWatermarks,
  removeCustomWatermark,
  saveCustomWatermarks,
} from './customWatermarkStore';

type Props = {
  visible: boolean;
  onRequestClose: () => void;
  onPickWatermark?: (wm: CustomWatermark) => void;
};

const C = {
  sheet: '#f2ebe2',
  sheetLine: '#ddd5c8',
  text: '#2a2824',
  hint: '#7a756c',
  gold: '#c9a962',
  danger: '#b23b3b',
  panel: '#231c17',
};

function clamp(n: number, a: number, b: number) {
  return Number.isFinite(n) ? Math.max(a, Math.min(b, n)) : a;
}

function roundTo(n: number, digits: number) {
  const p = Math.pow(10, digits);
  return Math.round(n * p) / p;
}

function formatScale(n: number) {
  const x = roundTo(n, 2);
  // 去掉多余的 0（比如 2.40 -> 2.4）
  return x.toFixed(2).replace(/\.?0+$/, '');
}

function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  testID,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'ghost' | 'danger';
  disabled?: boolean;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.btn,
        variant === 'primary' && styles.btnPrimary,
        variant === 'ghost' && styles.btnGhost,
        variant === 'danger' && styles.btnDanger,
        disabled && styles.btnDisabled,
        pressed && !disabled && styles.btnPressed,
      ]}
    >
      <Text
        style={[
          styles.btnText,
          variant === 'primary' && styles.btnTextPrimary,
          variant === 'danger' && styles.btnTextPrimary,
          variant === 'ghost' && styles.btnTextGhost,
          disabled && styles.btnTextDisabled,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function WatermarkSettingsModal({ visible, onRequestClose, onPickWatermark }: Props) {
  const [items, setItems] = useState<CustomWatermark[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = useMemo(
    () => items.find((x) => x.id === selectedId) ?? null,
    [items, selectedId],
  );

  useEffect(() => {
    if (!visible) return;
    let alive = true;
    void (async () => {
      const list = await loadCustomWatermarks();
      if (!alive) return;
      setItems(list);
      if (list.length > 0) setSelectedId((prev) => prev ?? list[0]!.id);
    })();
    return () => {
      alive = false;
    };
  }, [visible]);

  const persist = useCallback(
    async (next: CustomWatermark[]) => {
      setItems(next);
      await saveCustomWatermarks(next);
    },
    [setItems],
  );

  const pickPng = useCallback(async () => {
    try {
      const perm = await ImagePicker.getMediaLibraryPermissionsAsync(false);
      if (!perm.granted) {
        const req = await ImagePicker.requestMediaLibraryPermissionsAsync(false);
        if (!req.granted) {
          Alert.alert('相册权限', '需要相册权限才能选择 PNG 水印。');
          return;
        }
      }

      const r = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 1,
        selectionLimit: 1,
      });
      if (r.canceled) return;
      const uri = r.assets?.[0]?.uri;
      if (!uri) return;
      const wm = await importPngToCustomWatermark(uri);
      if (!wm) {
        Alert.alert('导入失败', '无法导入该图片，请重试。');
        return;
      }
      const next = [wm, ...items];
      await persist(next);
      setSelectedId(wm.id);
    } catch (e) {
      Alert.alert('上传失败', e instanceof Error ? e.message : String(e));
    }
  }, [items, persist]);

  const updateSelected = useCallback(
    async (patch: Partial<CustomWatermark>) => {
      if (!selected) return;
      const next = items.map((it) => {
        if (it.id !== selected.id) return it;
        const nextScale =
          patch.scale != null ? clamp(Number(patch.scale), 0.1, 100) : it.scale;
        return {
          ...it,
          ...patch,
          name: patch.name != null ? String(patch.name) : it.name,
          opacity: patch.opacity != null ? clamp(Number(patch.opacity), 0, 1) : it.opacity,
          scale: roundTo(nextScale, 2),
          anchor: (patch as any).anchor ?? it.anchor,
        };
      });
      await persist(next);
    },
    [items, persist, selected],
  );

  const [scaleText, setScaleText] = useState<string>('');
  useEffect(() => {
    if (!visible) return;
    if (!selected) return;
    setScaleText(formatScale(selected.scale));
  }, [selected?.id, selected?.scale, visible]);

  const commitScaleText = useCallback(async () => {
    if (!selected) return;
    const raw = scaleText.trim().replace(',', '.');
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      setScaleText(formatScale(selected.scale));
      return;
    }
    const v = roundTo(clamp(n, 0.1, 100), 2);
    setScaleText(formatScale(v));
    await updateSelected({ scale: v });
  }, [scaleText, selected, updateSelected]);

  const delSelected = useCallback(async () => {
    if (!selected) return;
    Alert.alert('删除水印', `确认删除“${selected.name}”？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            await removeCustomWatermark(selected.id);
            const next = items.filter((x) => x.id !== selected.id);
            await persist(next);
            setSelectedId(next[0]?.id ?? null);
          })();
        },
      },
    ]);
  }, [items, persist, selected]);

  const anchorOptions: { id: WatermarkAnchor; label: string }[] = useMemo(
    () => [
      { id: 'top_left', label: '左上' },
      { id: 'top_center', label: '中上' },
      { id: 'top_right', label: '右上' },
      { id: 'bottom_left', label: '左下' },
      { id: 'bottom_center', label: '中下' },
      { id: 'bottom_right', label: '右下' },
    ],
    [],
  );

  const close = useCallback(() => {
    // 关闭时也提交缩放输入，避免键盘未失焦导致未保存
    void commitScaleText().finally(() => onRequestClose());
  }, [commitScaleText, onRequestClose]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <View style={styles.modalRoot}>
        <Pressable style={styles.backdrop} onPress={close} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.headerRow}>
            <Text style={styles.title}>水印设置</Text>
            <Button label="完成" onPress={close} variant="ghost" />
          </View>
          <Text style={styles.hint}>支持上传 PNG；可重命名、缩放、调整透明度与固定位置（对每个水印单独保存）。</Text>

          <View style={styles.topActions}>
            <Button label="上传 PNG" onPress={() => void pickPng()} testID="wm-upload-png" />
          </View>

          <View style={styles.body}>
            <View style={styles.left}>
              <Text style={styles.sectionTitle}>我的水印</Text>
              <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
                {items.length === 0 ? (
                  <Text style={styles.emptyText}>还没有自定义水印，先上传一张 PNG。</Text>
                ) : null}
                {items.map((it) => {
                  const on = it.id === selectedId;
                  return (
                    <Pressable
                      key={it.id}
                      onPress={() => setSelectedId(it.id)}
                      style={[styles.row, on && styles.rowOn]}
                    >
                      <Image source={{ uri: it.uri }} style={styles.thumb} resizeMode="contain" />
                      <View style={styles.rowText}>
                        <Text style={styles.rowTitle} numberOfLines={1}>
                          {it.name}
                        </Text>
                        <Text style={styles.rowSub} numberOfLines={1}>
                          缩放 {it.scale.toFixed(2)} · 不透明度 {Math.round(it.opacity * 100)}%
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>

            <View style={styles.right}>
              <ScrollView
                style={styles.rightScroll}
                contentContainerStyle={styles.rightContent}
                keyboardShouldPersistTaps="handled"
              >
                <Text style={styles.sectionTitle}>编辑</Text>
                {selected ? (
                  <>
                  <View style={styles.field}>
                    <Text style={styles.fieldLabel}>名称</Text>
                    <TextInput
                      value={selected.name}
                      onChangeText={(t) => void updateSelected({ name: t })}
                      style={styles.input}
                      placeholder="水印名称"
                      placeholderTextColor="rgba(42,40,36,0.45)"
                    />
                  </View>

                  <View style={styles.controlsCol}>
                    <View style={styles.controlGroupFull}>
                      <Text style={styles.fieldLabel}>缩放（0.1 - 100）</Text>
                      <View style={styles.stepper}>
                        <Button
                          label="-"
                          variant="ghost"
                          onPress={() => void updateSelected({ scale: selected.scale - 0.1 })}
                        />
                        <TextInput
                          value={scaleText}
                          onChangeText={setScaleText}
                          onBlur={() => void commitScaleText()}
                          onSubmitEditing={() => void commitScaleText()}
                          keyboardType="decimal-pad"
                          style={styles.stepperInput}
                          returnKeyType="done"
                        />
                        <Button
                          label="+"
                          variant="ghost"
                          onPress={() => void updateSelected({ scale: selected.scale + 0.1 })}
                        />
                      </View>
                    </View>
                    <View style={styles.controlGroupFull}>
                      <Text style={styles.fieldLabel}>不透明度</Text>
                      <View style={styles.stepper}>
                        <Button
                          label="-"
                          variant="ghost"
                          onPress={() => void updateSelected({ opacity: selected.opacity - 0.05 })}
                        />
                        <Text style={styles.stepperValue}>{Math.round(selected.opacity * 100)}%</Text>
                        <Button
                          label="+"
                          variant="ghost"
                          onPress={() => void updateSelected({ opacity: selected.opacity + 0.05 })}
                        />
                      </View>
                    </View>
                  </View>

                  <Text style={styles.fieldLabel}>位置</Text>
                  <View style={styles.anchorGrid}>
                    <Pressable
                      onPress={() => {
                        if (!selected) return;
                        void updateSelected({
                          placement: selected.placement ?? { x: 0.5, y: 0.85 },
                        } as Partial<CustomWatermark>);
                      }}
                      style={[
                        styles.anchorChip,
                        selected.placement != null && styles.anchorChipOn,
                      ]}
                    >
                      <Text
                        style={[
                          styles.anchorChipText,
                          selected.placement != null && styles.anchorChipTextOn,
                        ]}
                      >
                        自由
                      </Text>
                    </Pressable>
                    {anchorOptions.map((opt) => {
                      const on = selected.anchor === opt.id;
                      return (
                        <Pressable
                          key={opt.id}
                          onPress={() =>
                            void updateSelected({ anchor: opt.id, placement: undefined } as Partial<CustomWatermark>)
                          }
                          style={[styles.anchorChip, on && styles.anchorChipOn]}
                        >
                          <Text style={[styles.anchorChipText, on && styles.anchorChipTextOn]}>
                            {opt.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  {selected.placement ? (
                    <Text style={styles.freeHint}>已开启自由位置：请回到相机取景中拖动水印到任意位置。</Text>
                  ) : null}

                  <View style={styles.editActions}>
                    <Button
                      label="在相机里选中"
                      onPress={() => onPickWatermark?.(selected)}
                      variant="primary"
                      testID="wm-pick-for-camera"
                    />
                    <Button label="删除" onPress={() => void delSelected()} variant="danger" />
                  </View>
                  </>
                ) : (
                  <Text style={styles.emptyEdit}>选择一个水印开始编辑。</Text>
                )}
              </ScrollView>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalRoot: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.55)' },
  backdrop: { ...StyleSheet.absoluteFillObject },
  sheet: {
    backgroundColor: C.sheet,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingHorizontal: 16,
    paddingBottom: 18,
    maxHeight: '86%',
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.sheetLine,
    marginTop: 10,
    marginBottom: 10,
  },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 18, fontWeight: '800', color: C.text },
  hint: { fontSize: 12, color: C.hint, marginTop: 4, marginBottom: 12 },
  topActions: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  body: { flexDirection: 'row', gap: 12, minHeight: 320 },
  left: { flex: 1, minWidth: 160 },
  right: { flex: 1.35, minWidth: 200 },
  rightScroll: { flex: 1 },
  rightContent: { paddingBottom: 18 },
  sectionTitle: { fontSize: 14, fontWeight: '800', color: C.text, marginBottom: 8 },
  list: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.08)',
    backgroundColor: 'rgba(255,255,255,0.65)',
  },
  listContent: { padding: 8, gap: 8 },
  emptyText: { fontSize: 12, color: C.hint, padding: 6 },
  row: {
    flexDirection: 'row',
    gap: 10,
    padding: 10,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.03)',
    alignItems: 'center',
  },
  rowOn: { backgroundColor: 'rgba(201,169,98,0.18)' },
  thumb: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: '#15110d',
  },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: 13, fontWeight: '800', color: C.text },
  rowSub: { fontSize: 11, color: C.hint, marginTop: 2 },
  field: { marginBottom: 10 },
  fieldLabel: { fontSize: 12, fontWeight: '700', color: C.text, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.12)',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: 'rgba(255,255,255,0.85)',
    color: C.text,
    fontWeight: '700',
  },
  controlsCol: { gap: 10, marginBottom: 10 },
  controlGroupFull: { minWidth: 0 },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.12)',
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.85)',
    paddingHorizontal: 6,
    paddingVertical: 6,
  },
  stepperValue: { fontSize: 12, fontWeight: '800', color: C.text, minWidth: 54, textAlign: 'center' },
  stepperInput: {
    minWidth: 64,
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '900',
    color: C.text,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.04)',
  },
  anchorGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 10,
  },
  anchorChip: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.10)',
  },
  anchorChipOn: {
    backgroundColor: 'rgba(201,169,98,0.22)',
    borderColor: 'rgba(201,169,98,0.9)',
  },
  anchorChipText: { fontSize: 12, fontWeight: '900', color: C.text },
  anchorChipTextOn: { color: '#1a1511' },
  freeHint: { fontSize: 12, color: C.hint, marginTop: -2, marginBottom: 10 },
  editActions: { flexDirection: 'row', gap: 10, marginTop: 6, alignItems: 'center' },
  emptyEdit: { fontSize: 12, color: C.hint, padding: 6 },
  btn: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  btnPrimary: { backgroundColor: C.gold },
  btnGhost: { backgroundColor: 'rgba(0,0,0,0.06)' },
  btnDanger: { backgroundColor: C.danger },
  btnDisabled: { opacity: 0.45 },
  btnPressed: { transform: [{ scale: 0.99 }] },
  btnText: { fontSize: 13, fontWeight: '900' },
  btnTextPrimary: { color: '#1a1511' },
  btnTextGhost: { color: C.text },
  btnTextDisabled: { color: 'rgba(0,0,0,0.45)' },
});

