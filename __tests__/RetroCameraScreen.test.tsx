import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library';

import { RetroCameraScreen } from '../src/RetroCameraScreen';

describe('RetroCameraScreen', () => {
  beforeEach(() => {
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('opens film sheet with 原相机 and film presets', () => {
    render(<RetroCameraScreen />);
    fireEvent.press(screen.getByTestId('open-film-sheet'));
    expect(screen.getByText('原相机')).toBeTruthy();
    expect(screen.getByText('自动胶')).toBeTruthy();
    expect(screen.getByText('日系清')).toBeTruthy();
  });

  it('opens filter sheet without film preset labels', () => {
    render(<RetroCameraScreen />);
    fireEvent.press(screen.getByTestId('open-filter-sheet'));
    expect(screen.getAllByText('奶油').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('橘子汽')).toBeTruthy();
    expect(screen.getByText('冷白')).toBeTruthy();
    expect(screen.getByText('复古风')).toBeTruthy();
    expect(screen.getByText('Y2K')).toBeTruthy();
    expect(screen.queryByText('自动胶')).toBeNull();
  });

  it('switches to video mode without countdown strip', () => {
    render(<RetroCameraScreen />);
    fireEvent.press(screen.getByText('录像'));
    expect(screen.queryByText('录像倒计时')).toBeNull();
    expect(screen.queryByText('3s')).toBeNull();
  });

  it('hides recording duration until actually recording', () => {
    render(<RetroCameraScreen />);
    fireEvent.press(screen.getByText('录像'));
    expect(screen.queryByTestId('recording-duration')).toBeNull();
  });

  it('renders mocked camera view when permission granted', () => {
    render(<RetroCameraScreen />);
    expect(screen.getByTestId('camera-view-mock')).toBeTruthy();
  });

  it('film and filter tools expose accessibility labels', () => {
    render(<RetroCameraScreen />);
    expect(screen.getByLabelText(/胶片模式/)).toBeTruthy();
    expect(screen.getByLabelText(/滤镜/)).toBeTruthy();
  });

  it('opens system image library when pressing gallery', async () => {
    render(<RetroCameraScreen />);
    fireEvent.press(screen.getByTestId('open-gallery'));

    await waitFor(() => {
      expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalled();
    });
    expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 1,
        selectionLimit: 1,
      }),
    );
  });

  it('shows in-app preview after user picks a photo', async () => {
    (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: 'file:///picked-from-library.jpg', width: 100, height: 100 }],
    });

    render(<RetroCameraScreen />);
    fireEvent.press(screen.getByTestId('open-gallery'));

    await waitFor(() => {
      expect(screen.getByTestId('picked-gallery-preview-image')).toBeTruthy();
    });
  });

  it('requests image picker media library permission when not yet granted', async () => {
    (ImagePicker.getMediaLibraryPermissionsAsync as jest.Mock).mockResolvedValueOnce({
      status: 'denied',
      expires: 'never',
      canAskAgain: true,
      granted: false,
    });
    (ImagePicker.requestMediaLibraryPermissionsAsync as jest.Mock).mockResolvedValueOnce({
      status: 'granted',
      expires: 'never',
      canAskAgain: true,
      granted: true,
      accessPrivileges: 'all',
    });
    (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: 'file:///after-perm.jpg', width: 1, height: 1 }],
    });

    render(<RetroCameraScreen />);
    fireEvent.press(screen.getByTestId('open-gallery'));

    await waitFor(() => {
      expect(ImagePicker.requestMediaLibraryPermissionsAsync).toHaveBeenCalledWith(false);
    });
  });
});
