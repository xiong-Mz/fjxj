import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import * as MediaLibrary from 'expo-media-library';

import { RetroCameraScreen } from '../src/RetroCameraScreen';

describe('RetroCameraScreen', () => {
  beforeEach(() => {
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('opens camera sheet with six preset labels', () => {
    render(<RetroCameraScreen />);
    fireEvent.press(screen.getByTestId('open-camera-sheet'));
    expect(screen.getByText('自动胶')).toBeTruthy();
    expect(screen.getByText('日系清')).toBeTruthy();
    expect(screen.getByText('暖奶油')).toBeTruthy();
    expect(screen.getByText('冷白闪')).toBeTruthy();
    expect(screen.getByText('港风片')).toBeTruthy();
    expect(screen.getByText('拍立得')).toBeTruthy();
  });

  it('opens filter sheet with 奶油、冷白 and Y2K', () => {
    render(<RetroCameraScreen />);
    fireEvent.press(screen.getByTestId('open-filter-sheet'));
    expect(screen.getAllByText('奶油').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('橘子汽')).toBeTruthy();
    expect(screen.getByText('冷白')).toBeTruthy();
    expect(screen.getByText('复古风')).toBeTruthy();
    expect(screen.getByText('Y2K')).toBeTruthy();
  });

  it('switches to video mode without countdown strip', () => {
    render(<RetroCameraScreen />);
    fireEvent.press(screen.getByText('录像'));
    expect(screen.queryByText('录像倒计时')).toBeNull();
    expect(screen.queryByText('3s')).toBeNull();
  });

  it('renders mocked camera view when permission granted', () => {
    render(<RetroCameraScreen />);
    expect(screen.getByTestId('camera-view-mock')).toBeTruthy();
  });

  it('top filter and camera controls expose accessibility labels (no on-screen captions)', () => {
    render(<RetroCameraScreen />);
    expect(screen.getByLabelText(/滤镜/)).toBeTruthy();
    expect(screen.getByLabelText(/相机风格/)).toBeTruthy();
  });

  it('resolves gallery image uri via getAssetInfoAsync when opening gallery', async () => {
    (MediaLibrary.getAssetsAsync as jest.Mock).mockResolvedValueOnce({
      assets: [
        {
          id: '1',
          uri: 'ph://mock',
          mediaType: 'photo',
          filename: 'a.jpg',
          width: 1,
          height: 1,
          creationTime: 1,
          modificationTime: 1,
          duration: 0,
        } as MediaLibrary.Asset,
      ],
      hasNextPage: false,
      endCursor: '',
      totalCount: 1,
    });

    render(<RetroCameraScreen />);
    fireEvent.press(screen.getByTestId('open-gallery'));

    await waitFor(() => {
      expect(MediaLibrary.getAssetInfoAsync).toHaveBeenCalled();
    });
  });

  it('opens gallery with multiple photos and requests a page of assets', async () => {
    const asset = (id: string, uri: string) =>
      ({
        id,
        uri,
        mediaType: 'photo',
        filename: `${id}.jpg`,
        width: 1,
        height: 1,
        creationTime: 1,
        modificationTime: 1,
        duration: 0,
      }) as MediaLibrary.Asset;

    const emptyPage = {
      assets: [] as MediaLibrary.Asset[],
      hasNextPage: false,
      endCursor: '',
      totalCount: 0,
    };
    const twoPage = {
      assets: [asset('1', 'content://one'), asset('2', 'content://two')],
      hasNextPage: false,
      endCursor: '1',
      totalCount: 2,
    };

    (MediaLibrary.getAssetsAsync as jest.Mock)
      .mockResolvedValueOnce(emptyPage)
      .mockResolvedValueOnce(twoPage);

    render(<RetroCameraScreen />);
    await waitFor(() => expect(MediaLibrary.getAssetsAsync).toHaveBeenCalled());

    fireEvent.press(screen.getByTestId('open-gallery'));

    await waitFor(() => {
      expect(screen.getByText('1 / 2')).toBeTruthy();
    });
    expect(MediaLibrary.getAssetsAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        first: 80,
        mediaType: MediaLibrary.MediaType.photo,
      }),
    );
  });

  it('open gallery requests media with writeOnly false (readable library)', async () => {
    render(<RetroCameraScreen />);
    await waitFor(() => expect(MediaLibrary.getPermissionsAsync).toHaveBeenCalled());

    (MediaLibrary.getPermissionsAsync as jest.Mock).mockClear();
    (MediaLibrary.requestPermissionsAsync as jest.Mock).mockClear();
    (MediaLibrary.getPermissionsAsync as jest.Mock).mockResolvedValue({
      status: 'denied',
      expires: 'never',
      canAskAgain: true,
      granted: false,
    });
    (MediaLibrary.requestPermissionsAsync as jest.Mock).mockResolvedValue({
      status: 'granted',
      expires: 'never',
      canAskAgain: true,
      granted: true,
      accessPrivileges: 'all',
    });
    (MediaLibrary.getAssetsAsync as jest.Mock).mockResolvedValue({
      assets: [{ uri: 'file:///mock-photo.jpg' } as MediaLibrary.Asset],
      hasNextPage: false,
      endCursor: '',
      totalCount: 1,
    });

    fireEvent.press(screen.getByTestId('open-gallery'));

    await waitFor(() => {
      expect(MediaLibrary.requestPermissionsAsync).toHaveBeenCalled();
    });
    expect(MediaLibrary.requestPermissionsAsync).toHaveBeenCalledWith(false, undefined);
  });
});
