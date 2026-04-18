/* eslint-disable @typescript-eslint/no-require-imports */

jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));

jest.mock('react-native-gesture-handler', () => {
  const { View } = require('react-native');
  return {
    GestureHandlerRootView: View,
    TapGestureHandler: View,
    PanGestureHandler: View,
    Swipeable: View,
  };
});

jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  const { View } = require('react-native');
  const inset = { top: 0, right: 0, bottom: 0, left: 0 };
  return {
    SafeAreaProvider: ({ children }) => React.createElement(React.Fragment, null, children),
    SafeAreaView: ({ children, ...props }) => React.createElement(View, props, children),
    useSafeAreaInsets: () => inset,
  };
});

jest.mock('./src/FilmProcessor', () => ({
  FilmProcessor: () => null,
}));

jest.mock('expo-camera', () => {
  const React = require('react');
  const { View } = require('react-native');
  const Cam = React.forwardRef((props, ref) =>
    React.createElement(View, { ...props, ref, testID: 'camera-view-mock' }),
  );
  Cam.displayName = 'CameraView';
  const granted = { granted: true, status: 'granted', expires: 'never', canAskAgain: true };
  return {
    CameraView: Cam,
    useCameraPermissions: jest.fn(() => [granted, jest.fn(async () => granted), jest.fn()]),
    useMicrophonePermissions: jest.fn(() => [granted, jest.fn(async () => granted), jest.fn()]),
  };
});

jest.mock('expo-media-library', () => ({
  MediaType: { photo: 'photo', video: 'video', audio: 'audio', unknown: 'unknown' },
  SortBy: {
    default: 'default',
    mediaType: 'mediaType',
    width: 'width',
    height: 'height',
    creationTime: 'creationTime',
    modificationTime: 'modificationTime',
    duration: 'duration',
  },
  getPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'granted', accessPrivileges: 'all' })),
  requestPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'granted', accessPrivileges: 'all' })),
  saveToLibraryAsync: jest.fn(() => Promise.resolve(undefined)),
  getAssetsAsync: jest.fn(() =>
    Promise.resolve({ assets: [], hasNextPage: false, endCursor: '', totalCount: 0 }),
  ),
  getAssetInfoAsync: jest.fn(() =>
    Promise.resolve({
      uri: 'content://mock-asset',
      localUri: 'file:///mock-resolved-gallery.jpg',
    }),
  ),
}));

jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: jest.fn((uri) => Promise.resolve({ uri, width: 800, height: 600 })),
  SaveFormat: { JPEG: 'jpeg', PNG: 'png', WEBP: 'webp' },
}));

jest.mock('expo-status-bar', () => ({
  StatusBar: () => null,
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    appOwnership: 'standalone',
    expoVersion: '52.0.0',
  },
}));
