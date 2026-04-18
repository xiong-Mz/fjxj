import * as MediaLibrary from 'expo-media-library';

import { resolveAssetDisplayUri } from '../src/galleryAssetUri';

const minimalAsset = {
  id: 'a1',
  uri: 'ph://preview',
  mediaType: 'photo' as const,
  filename: 'x.jpg',
  width: 100,
  height: 100,
  creationTime: 1,
  modificationTime: 1,
  duration: 0,
};

describe('resolveAssetDisplayUri', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('uses content URI directly without calling getAssetInfoAsync', async () => {
    const spy = jest.spyOn(MediaLibrary, 'getAssetInfoAsync');
    const asset = {
      ...minimalAsset,
      uri: 'content://media/external/images/media/123',
    } as MediaLibrary.Asset;

    await expect(resolveAssetDisplayUri(asset)).resolves.toBe('content://media/external/images/media/123');
    expect(spy).not.toHaveBeenCalled();
  });

  it('returns localUri when getAssetInfoAsync succeeds', async () => {
    jest.spyOn(MediaLibrary, 'getAssetInfoAsync').mockResolvedValue({
      ...minimalAsset,
      localUri: 'file:///resolved-path.jpg',
    } as MediaLibrary.AssetInfo);

    await expect(resolveAssetDisplayUri(minimalAsset as MediaLibrary.Asset)).resolves.toBe(
      'file:///resolved-path.jpg',
    );
  });

  it('falls back to asset.uri when getAssetInfoAsync fails', async () => {
    jest.spyOn(MediaLibrary, 'getAssetInfoAsync').mockRejectedValue(new Error('boom'));

    await expect(resolveAssetDisplayUri(minimalAsset as MediaLibrary.Asset)).resolves.toBe(
      'ph://preview',
    );
  });
});
