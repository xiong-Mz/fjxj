/** Skia 4×5 行主序：每行 [R,G,B,A] 系数 + 常数项 */

export const IDENTITY = [
  1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0,
] as const;

function to5x5(flat: readonly number[] | number[]): number[][] {
  const M: number[][] = [];
  for (let r = 0; r < 4; r++) {
    M[r] = [
      flat[r * 5],
      flat[r * 5 + 1],
      flat[r * 5 + 2],
      flat[r * 5 + 3],
      flat[r * 5 + 4],
    ];
  }
  M[4] = [0, 0, 0, 0, 1];
  return M;
}

/** 组合两个矩阵：先应用 b，再应用 a，即输出 = a × b × 像素（齐次坐标下 5×5） */
export function multiplyColorMatrices(a: number[], b: number[]): number[] {
  const A = to5x5(a);
  const B = to5x5(b);
  const R: number[][] = Array.from({ length: 5 }, () => Array(5).fill(0));
  for (let i = 0; i < 5; i++) {
    for (let j = 0; j < 5; j++) {
      for (let k = 0; k < 5; k++) {
        R[i][j] += A[i][k] * B[k][j];
      }
    }
  }
  const out: number[] = [];
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 5; c++) {
      out.push(R[r][c]);
    }
  }
  return out;
}

export type RetroPreset = {
  id: string;
  label: string;
  matrix: number[];
  /** 预览区半透明色调（成片仍以 matrix 为准） */
  previewTint: string;
  previewOpacity: number;
  /** 底部抽屉卡片双色（左→右） */
  swatch: [string, string];
};

/** 6 种相机模式：底层色调（Skia ColorMatrix），切换后成片大变样 */
export const PRESETS: RetroPreset[] = [
  {
    id: 'auto_film',
    label: '自动胶',
    matrix: [
      1.0, 0, 0, 0, 0, 0, 1.0, 0, 0, 0, 0, 0, 0.98, 0, 0, 0, 0, 0, 1.0, 0,
    ],
    previewTint: '#e8d4bc',
    previewOpacity: 0.13,
    swatch: ['#e8dcc8', '#c4a882'],
  },
  {
    id: 'japan_clear',
    label: '日系清',
    matrix: [
      0.98, 0, 0, 0, 0.01, 0, 1.02, 0, 0, 0.01, 0, 0, 1.08, 0, 0.03, 0, 0, 0, 1.0, 0,
    ],
    previewTint: '#c5daf0',
    previewOpacity: 0.13,
    swatch: ['#b8d4f0', '#f5f8fc'],
  },
  {
    id: 'warm_portrait',
    label: '暖奶油',
    matrix: [1.07, 0, 0, 0, 0.03, 0, 1.03, 0, 0, 0.02, 0, 0, 0.96, 0, -0.01, 0, 0, 0, 1, 0],
    previewTint: '#f0d0b8',
    previewOpacity: 0.14,
    swatch: ['#f0c8a8', '#fff5eb'],
  },
  {
    id: 'flash_ccd',
    label: '冷白闪',
    matrix: [0.97, 0, 0, 0, 0.01, 0, 1.01, 0, 0, 0.01, 0, 0, 1.1, 0, 0.04, 0, 0, 0, 1, 0],
    previewTint: '#b8cce8',
    previewOpacity: 0.13,
    swatch: ['#9eb8e8', '#f2f6ff'],
  },
  {
    id: 'hk_cine',
    label: '港风片',
    matrix: [1.09, 0, 0, 0, 0.03, 0, 0.97, 0, 0, -0.01, 0, 0, 0.88, 0, -0.03, 0, 0, 0, 1, 0],
    previewTint: '#2d4a58',
    previewOpacity: 0.12,
    swatch: ['#c97d4a', '#2a6a7a'],
  },
  {
    id: 'instax',
    label: '拍立得',
    matrix: [1.03, 0, 0, 0, 0.02, 0, 1.01, 0, 0, 0.01, 0, 0, 0.99, 0, 0, 0, 0, 0, 0.97, 0],
    previewTint: '#ddd8cc',
    previewOpacity: 0.12,
    swatch: ['#f8f4e8', '#d8d0c8'],
  },
];

export type FilmFilter = {
  id: string;
  label: string;
  matrix: number[];
  /** 滤镜抽屉卡片双色 */
  swatch?: [string, string];
  /**
   * 取景预览上的叠色（近似示意；成片以 matrix + Skia 为准）
   */
  previewOverlay?: { color: string; opacity: number };
};

/** 8 款滤镜：上层色彩，与相机矩阵相乘叠加 */
export const FILTERS: FilmFilter[] = [
  {
    id: 'cream',
    label: '奶油',
    matrix: [1.06, 0, 0, 0, 0.03, 0, 1.02, 0, 0, 0.02, 0, 0, 0.96, 0, -0.01, 0, 0, 0, 1, 0],
    swatch: ['#f5e0d0', '#fff8f0'],
    previewOverlay: { color: '#e8b8a0', opacity: 0.16 },
  },
  {
    id: 'orange_soda',
    label: '橘子汽',
    matrix: [1.1, 0, 0, 0, 0.04, 0, 1.04, 0, 0, 0.02, 0, 0, 0.92, 0, -0.02, 0, 0, 0, 1, 0],
    swatch: ['#ff9a4a', '#ffe8c8'],
    previewOverlay: { color: '#e88840', opacity: 0.16 },
  },
  {
    id: 'cold_white',
    label: '冷白',
    matrix: [0.98, 0, 0, 0, 0.01, 0, 1.02, 0, 0, 0.01, 0, 0, 1.1, 0, 0.03, 0, 0, 0, 1, 0],
    swatch: ['#a8c0e0', '#f0f6ff'],
    previewOverlay: { color: '#6a98d0', opacity: 0.16 },
  },
  {
    id: 'ice_blue',
    label: '冰蓝',
    matrix: [0.96, 0, 0, 0, -0.01, 0, 1.0, 0, 0, 0, 0, 0, 1.08, 0, 0.03, 0, 0, 0, 1, 0],
    swatch: ['#6a9ec8', '#d8ecff'],
    previewOverlay: { color: '#4a88c0', opacity: 0.17 },
  },
  {
    id: 'hk_style',
    label: '港风',
    matrix: [1.08, 0, 0, 0, 0.03, 0, 0.98, 0, 0, -0.01, 0, 0, 0.9, 0, -0.03, 0, 0, 0, 1, 0],
    swatch: ['#c97d4a', '#2a5a6a'],
    previewOverlay: { color: '#2a7070', opacity: 0.16 },
  },
  {
    id: 'film_roll',
    label: '胶卷',
    matrix: [1.03, 0, 0, 0, 0.02, 0, 1.0, 0, 0, 0.01, 0, 0, 0.97, 0, -0.01, 0, 0, 0, 1, 0],
    swatch: ['#c4b8a0', '#6a6050'],
    previewOverlay: { color: '#a89878', opacity: 0.15 },
  },
  {
    id: 'retro_dv',
    label: '复古风',
    matrix: [1.0, 0, 0, 0, 0.02, 0, 0.99, 0, 0, 0.01, 0, 0, 0.95, 0, -0.01, 0, 0, 0, 0.85, 0],
    swatch: ['#4a4858', '#9a9898'],
    previewOverlay: { color: '#585870', opacity: 0.16 },
  },
  {
    id: 'y2k',
    label: 'Y2K',
    matrix: [1.04, 0, 0, 0, 0.03, 0, 0.97, 0, 0, -0.01, 0, 0, 1.05, 0, 0.03, 0, 0, 0, 1, 0],
    swatch: ['#e898d8', '#a8c8ff'],
    previewOverlay: { color: '#b070d0', opacity: 0.16 },
  },
];

export function combinedMatrix(preset: RetroPreset, filter: FilmFilter): number[] {
  return multiplyColorMatrices(filter.matrix, preset.matrix);
}
