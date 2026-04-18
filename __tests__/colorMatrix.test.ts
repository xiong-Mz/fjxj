import {
  FILTERS,
  FILM_MODE_OPTIONS,
  IDENTITY,
  ORIGINAL_PRESET,
  PRESETS,
  combinedMatrix,
  multiplyColorMatrices,
} from '../src/colorMatrix';

/** 将 Skia 4×5 矩阵作用于 [r,g,b,a]（0~1 或任意实数） */
function applyMatrix(
  m: number[],
  rgba: readonly [number, number, number, number],
): [number, number, number, number] {
  const [r, g, b, a] = rgba;
  const R = m[0] * r + m[1] * g + m[2] * b + m[3] * a + m[4];
  const G = m[5] * r + m[6] * g + m[7] * b + m[8] * a + m[9];
  const B = m[10] * r + m[11] * g + m[12] * b + m[13] * a + m[14];
  const A = m[15] * r + m[16] * g + m[17] * b + m[18] * a + m[19];
  return [R, G, B, A];
}

function expectClose(
  a: readonly number[],
  b: readonly number[],
  eps = 1e-4,
) {
  expect(a.length).toBe(b.length);
  for (let i = 0; i < a.length; i++) {
    expect(Math.abs(a[i] - b[i])).toBeLessThan(eps);
  }
}

describe('multiplyColorMatrices', () => {
  it('identity is neutral on the left', () => {
    const hk = FILTERS.find((f) => f.id === 'hk_style')!.matrix;
    const p = multiplyColorMatrices([...IDENTITY], hk);
    expectClose(p, hk);
  });

  it('identity is neutral on the right', () => {
    const hk = FILTERS.find((f) => f.id === 'hk_style')!.matrix;
    const p = multiplyColorMatrices(hk, [...IDENTITY]);
    expectClose(p, hk);
  });

  it('implements composition: apply(A*B) equals apply(A)∘apply(B)', () => {
    const cream = FILTERS.find((f) => f.id === 'cream')!.matrix;
    const ice = FILTERS.find((f) => f.id === 'ice_blue')!.matrix;
    const ab = multiplyColorMatrices(cream, ice);
    const samples: [number, number, number, number][] = [
      [0.1, 0.2, 0.3, 1],
      [0.9, 0.4, 0.1, 1],
      [0, 0, 0, 1],
      [1, 1, 1, 0.5],
    ];
    for (const rgb of samples) {
      const viaAB = applyMatrix(ab, rgb);
      const viaBThenA = applyMatrix(cream, applyMatrix(ice, rgb));
      expectClose(viaAB, viaBThenA, 1e-3);
    }
  });

  it('returns 20 coefficients', () => {
    const m = multiplyColorMatrices(FILTERS[1].matrix, PRESETS[0].matrix);
    expect(m).toHaveLength(20);
  });
});

describe('combinedMatrix', () => {
  it('matches multiplyColorMatrices(filter, preset)', () => {
    const preset = PRESETS[2];
    const filter = FILTERS[4];
    const c = combinedMatrix(preset, filter);
    const m = multiplyColorMatrices(filter.matrix, preset.matrix);
    expectClose(c, m);
  });

  it('differs between presets for the same filter', () => {
    const filter = FILTERS.find((f) => f.id === 'film_roll')!;
    const a = combinedMatrix(PRESETS[0], filter);
    const b = combinedMatrix(PRESETS[1], filter);
    const diff = a.some((v, i) => Math.abs(v - b[i]) > 1e-6);
    expect(diff).toBe(true);
  });

  it('differs between filters for the same preset', () => {
    const preset = PRESETS[0];
    const a = combinedMatrix(preset, FILTERS[0]);
    const b = combinedMatrix(preset, FILTERS[7]);
    const diff = a.some((v, i) => Math.abs(v - b[i]) > 1e-6);
    expect(diff).toBe(true);
  });

  it('原相机 preset yields same matrix as filter alone', () => {
    const filter = FILTERS[3];
    const c = combinedMatrix(ORIGINAL_PRESET, filter);
    expectClose(c, filter.matrix);
  });
});

describe('SPEC data: PRESETS / FILTERS', () => {
  it('has 6 presets with unique ids', () => {
    expect(PRESETS.length).toBe(6);
    const ids = new Set(PRESETS.map((p) => p.id));
    expect(ids.size).toBe(PRESETS.length);
  });

  it('has 8 filters with unique ids', () => {
    expect(FILTERS.length).toBe(8);
    const ids = new Set(FILTERS.map((f) => f.id));
    expect(ids.size).toBe(FILTERS.length);
  });

  it('default preset is 自动胶', () => {
    expect(PRESETS[0].id).toBe('auto_film');
    expect(PRESETS[0].label).toBe('自动胶');
  });

  it('film mode list starts with 原相机 then all presets', () => {
    expect(FILM_MODE_OPTIONS[0]).toBe(ORIGINAL_PRESET);
    expect(FILM_MODE_OPTIONS.length).toBe(1 + PRESETS.length);
    expect(FILM_MODE_OPTIONS[1]).toBe(PRESETS[0]);
  });

  it('preset and filter labels are at most 3 characters', () => {
    for (const p of FILM_MODE_OPTIONS) {
      expect([...p.label].length).toBeLessThanOrEqual(3);
    }
    for (const f of FILTERS) {
      expect([...f.label].length).toBeLessThanOrEqual(3);
    }
  });

  it('each matrix has length 20', () => {
    expect(ORIGINAL_PRESET.matrix).toHaveLength(20);
    for (const p of PRESETS) {
      expect(p.matrix).toHaveLength(20);
    }
    for (const f of FILTERS) {
      expect(f.matrix).toHaveLength(20);
    }
  });

  it('preview metadata is present on presets', () => {
    for (const p of PRESETS) {
      expect(p.previewTint).toMatch(/^#/);
      expect(p.previewOpacity).toBeGreaterThanOrEqual(0);
      expect(p.previewOpacity).toBeLessThanOrEqual(1);
    }
  });
});

describe('港风 filter', () => {
  it('maps white toward warmer R than B (青橙倾向)', () => {
    const hk = FILTERS.find((f) => f.id === 'hk_style')!.matrix;
    const [R, G, B] = applyMatrix(hk, [1, 1, 1, 1]);
    expect(R).toBeGreaterThan(G);
    expect(G).toBeGreaterThan(B);
  });
});
