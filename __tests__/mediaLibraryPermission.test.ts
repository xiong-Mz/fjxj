describe('getMediaLibraryAccessRequestOptions', () => {
  it('standalone Android requests photo granular permission', () => {
    jest.isolateModules(() => {
      jest.doMock('expo-constants', () => ({
        __esModule: true,
        default: { appOwnership: 'standalone' },
      }));
      jest.doMock('react-native', () => ({ Platform: { OS: 'android' } }));
      const { getMediaLibraryAccessRequestOptions } = require('../src/mediaLibraryPermission');
      expect(getMediaLibraryAccessRequestOptions()).toEqual({
        writeOnly: false,
        granularPermissions: ['photo'],
      });
    });
  });

  it('Expo Go on Android must not pass photo granular (native throws)', () => {
    jest.isolateModules(() => {
      jest.doMock('expo-constants', () => ({
        __esModule: true,
        default: { appOwnership: 'expo' },
      }));
      jest.doMock('react-native', () => ({ Platform: { OS: 'android' } }));
      const { getMediaLibraryAccessRequestOptions } = require('../src/mediaLibraryPermission');
      expect(getMediaLibraryAccessRequestOptions()).toEqual({ writeOnly: false });
    });
  });

  it('iOS never uses Android granular photo', () => {
    jest.isolateModules(() => {
      jest.doMock('expo-constants', () => ({
        __esModule: true,
        default: { appOwnership: 'expo' },
      }));
      jest.doMock('react-native', () => ({ Platform: { OS: 'ios' } }));
      const { getMediaLibraryAccessRequestOptions } = require('../src/mediaLibraryPermission');
      expect(getMediaLibraryAccessRequestOptions()).toEqual({ writeOnly: false });
    });
  });
});
