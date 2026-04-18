import Constants from 'expo-constants';
import { Platform } from 'react-native';
import type { GranularPermission } from 'expo-media-library';

export type MediaLibraryPermissionRequestOptions = {
  writeOnly: boolean;
  /** 不传则由原生使用默认列表（Expo Go Android 必须为 undefined，否则会抛 PermissionsException） */
  granularPermissions?: GranularPermission[];
};

/**
 * - 独立应用 / Dev Build：Android 13+ 使用 photo 粒度，才能读相册与 getAssetsAsync。
 * - Expo Go（Android）：不能传 photo/video 粒度，否则原生 `maybeThrowIfExpoGo` 直接抛错；
 *   需使用默认权限列表（与官方模块在 Expo Go 下的行为一致），否则相册无法打开。
 * @see expo-media-library android MediaLibraryModule.maybeThrowIfExpoGo
 */
export function getMediaLibraryAccessRequestOptions(): MediaLibraryPermissionRequestOptions {
  const isExpoGo = Constants.appOwnership === 'expo';

  if (Platform.OS === 'android') {
    if (isExpoGo) {
      return { writeOnly: false };
    }
    return { writeOnly: false, granularPermissions: ['photo'] };
  }

  return { writeOnly: false };
}
