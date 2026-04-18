# 复古相机（Retro Camera）

基于 **Expo SDK 52** 与 **React Native** 的复古胶片风格相机应用：实时取景、多套相机风格与滤镜、拍照后经 **Skia 色彩矩阵** 导出成片，并写入系统相册；支持短视频录制与相册内横向滑动浏览。

## 功能概览

- **拍照**：快门拍照 → 可选尺寸压缩 → `FilmProcessor` 应用组合色彩矩阵（相机预设 × 滤镜）→ 保存至相册（成功时静默完成，失败会提示）。
- **录像**：无倒计时，直接录制；需相机与麦克风权限；停止后保存至相册。
- **相机 / 滤镜**：底部抽屉选择 6 种相机风格与 8 种滤镜；选项展示名为最多 3 字；取景预览为叠色示意（`multiply` 混合 + 配置项），成片以矩阵为准。
- **相册**：拉取最近照片列表后**立即**打开全屏预览；`content` / `file` 等 URI 即时显示，`ph://` 等在单页内按需 `getAssetInfoAsync` 解析，避免一次性阻塞。
- **权限**：相机、麦克风、相册读写（见 `app.json` 中 `expo-camera` / `expo-media-library` 配置）。

## 技术栈

| 类别 | 技术 |
|------|------|
| 框架 | Expo ~52、React Native 0.76 |
| 相机 | expo-camera |
| 图像处理 | @shopify/react-native-skia（成片 ColorMatrix）、expo-image-manipulator |
| 媒体 | expo-media-library、expo-file-system |
| 测试 | Jest、jest-expo、@testing-library/react-native |

## 环境要求

- Node.js（建议 LTS）
- [Expo CLI](https://docs.expo.dev/get-started/installation/) / `npx expo`
- iOS：Xcode（真机或模拟器）；Android：Android Studio 与模拟器或真机  
- **Skia** 需原生环境；完整功能请在 **Development Build** 或 EAS 构建产物上验证，而非仅 Expo Go（视 Skia 与相机组合而定）。

## 本地开发

```bash
cd retro-camera
npm install
```

启动开发服务（默认 LAN，便于真机同网调试）：

```bash
npm start
# 或仅本机
npm run start:localhost
```

在模拟器/真机上运行：

```bash
npm run android
npm run ios
```

## 脚本说明

| 命令 | 说明 |
|------|------|
| `npm start` | `expo start --host lan` |
| `npm run start:localhost` | `expo start --host localhost` |
| `npm test` | Jest 单测 |
| `npm run test:watch` | 监听模式 |
| `npm run test:ci` | CI 用（串行、`--forceExit`） |

类型检查：

```bash
npx tsc --noEmit
```

## EAS 构建

项目根目录含 `eas.json`，示例 profile：`development`（Dev Client）、`preview` / `production`（Android APK 等）。构建前需登录 Expo 并关联 `app.json` 中的 `extra.eas.projectId`。

```bash
npx eas-cli build --profile preview --platform android
```

具体以 [EAS Build 文档](https://docs.expo.dev/build/introduction/) 为准。

## 目录结构（摘要）

```
retro-camera/
├── App.tsx                 # 入口，挂载 RetroCameraScreen
├── app.json                # Expo 配置与插件权限文案
├── eas.json                # EAS Build 配置
├── src/
│   ├── RetroCameraScreen.tsx   # 主界面：取景、模式、相册、导出队列
│   ├── FilmProcessor.tsx       # Skia 离屏导出 JPEG
│   ├── colorMatrix.ts          # 预设 / 滤镜矩阵与组合
│   ├── galleryAssetUri.ts      # 相册资源 URI 解析
│   └── mediaLibraryPermission.ts
├── __tests__/              # Jest 测试
└── assets/                 # 图标与启动图
```

## 测试与质量

- 单测会 **mock** `expo-camera`、`FilmProcessor`、`expo-media-library` 等，无需完整原生环境即可跑通。
- 提交前建议执行：`npx tsc --noEmit && npm test`。

## 许可证

私有项目（`package.json` 中 `"private": true`）。对外分发时请自行补充许可证文件。
