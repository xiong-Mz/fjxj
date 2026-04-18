import * as MediaLibrary from 'expo-media-library';

export function isLikelyDirectImageUri(uri: string): boolean {
  if (!uri) return false;
  if (uri.startsWith('file:')) return true;
  if (uri.startsWith('content:')) return true;
  if (uri.startsWith('http://') || uri.startsWith('https://')) return true;
  return false;
}

/** 无需异步即可给 Image 使用的 URI；否则为空，需走 {@link resolveAssetDisplayUri} */
export function getQuickDisplayUri(asset: MediaLibrary.Asset): string {
  const raw = asset.uri ?? '';
  return isLikelyDirectImageUri(raw) ? raw : '';
}

/**
 * 优先使用已可直接给 RN Image 加载的 URI；否则再请求 getAssetInfoAsync（如 iOS ph://）。
 */
export async function resolveAssetDisplayUri(asset: MediaLibrary.Asset): Promise<string> {
  const raw = asset.uri ?? '';
  if (isLikelyDirectImageUri(raw)) {
    return raw;
  }
  try {
    const info = await MediaLibrary.getAssetInfoAsync(asset, {
      shouldDownloadFromNetwork: true,
    });
    if (info.localUri) return info.localUri;
    if (info.uri) return info.uri;
  } catch {
    /* 使用 raw */
  }
  return raw;
}
