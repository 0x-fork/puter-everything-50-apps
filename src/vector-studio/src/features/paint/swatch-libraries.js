/**
 * Built-in swatch libraries (original palettes) that the Swatches panel's
 * library menu opens. Each entry: { id, name, swatches: [{ name, paint }] }.
 */
const solid = (name, color) => ({ name, paint: { type: 'solid', color } });
const lin = (name, angle, ...stops) => ({
  name,
  paint: { type: 'linear', angle, stops: stops.map(([offset, color]) => ({ offset, color, opacity: 1 })) },
});
const rad = (name, ...stops) => ({
  name,
  paint: { type: 'radial', angle: 0, stops: stops.map(([offset, color]) => ({ offset, color, opacity: 1 })) },
});

export const SWATCH_LIBRARIES = [
  {
    id: 'earth',
    name: 'Earth Tones',
    swatches: [
      solid('Clay', '#a0522d'), solid('Terracotta', '#c66b3d'), solid('Rust', '#8b3a1a'), solid('Ochre', '#c8962e'),
      solid('Sandstone', '#d8b98a'), solid('Umber', '#635147'), solid('Moss', '#6b7d3a'), solid('Olive Grove', '#55613a'),
      solid('Fern', '#4f7942'), solid('Bark', '#4a3728'), solid('Slate Rock', '#5f6b73'), solid('River Stone', '#8a8d84'),
    ],
  },
  {
    id: 'pastels',
    name: 'Pastels',
    swatches: [
      solid('Blush', '#f8c8d0'), solid('Peach Cream', '#ffd8b8'), solid('Butter', '#fff2b3'), solid('Mint', '#c7f0d8'),
      solid('Seafoam', '#b8ebe4'), solid('Baby Blue', '#bfdcf5'), solid('Periwinkle', '#c9c9f2'), solid('Lilac', '#dcc6f0'),
      solid('Rose Quartz', '#f2c6de'), solid('Pistachio', '#d9ecb8'),
    ],
  },
  {
    id: 'neutrals',
    name: 'Neutrals',
    swatches: [
      solid('Paper', '#faf8f3'), solid('Linen', '#efe9df'), solid('Oat', '#ddd3c2'), solid('Stone', '#c2b9ab'),
      solid('Greige', '#a39b8f'), solid('Taupe', '#857a6e'), solid('Charcoal', '#3f3d3a'), solid('Ink', '#1e1f22'),
      solid('Cool Gray', '#9aa1a9'), solid('Fog', '#d6dadf'),
    ],
  },
  {
    id: 'brights',
    name: 'Brights',
    swatches: [
      solid('Signal Red', '#ff2d3c'), solid('Tangerine', '#ff7a00'), solid('Sunflower', '#ffd400'), solid('Electric Lime', '#a6ff00'),
      solid('Vivid Green', '#00d26a'), solid('Aqua Pop', '#00e0d0'), solid('Bright Azure', '#0095ff'), solid('Ultramarine', '#3a3aff'),
      solid('Hot Violet', '#9b30ff'), solid('Fuchsia Pop', '#ff2ed1'),
    ],
  },
  {
    id: 'skin',
    name: 'Skin Tones',
    swatches: [
      solid('Tone 1', '#f6dcc8'), solid('Tone 2', '#efc8aa'), solid('Tone 3', '#e2b08c'), solid('Tone 4', '#d09a72'),
      solid('Tone 5', '#b97f58'), solid('Tone 6', '#9c6644'), solid('Tone 7', '#7d4f33'), solid('Tone 8', '#5e3a26'),
      solid('Tone 9', '#46291b'), solid('Tone 10', '#2f1c13'),
    ],
  },
  {
    id: 'metals',
    name: 'Metals',
    swatches: [
      lin('Gold Leaf', 0, [0, '#8a6623'], [0.3, '#f6e27a'], [0.55, '#c9a13b'], [0.8, '#f8eaa0'], [1, '#8a6623']),
      lin('Silver Sheen', 0, [0, '#8e9196'], [0.35, '#f2f3f5'], [0.6, '#a9adb3'], [1, '#e1e3e6']),
      lin('Copper Tone', 0, [0, '#7a3a1a'], [0.4, '#e0915c'], [0.7, '#b0592e'], [1, '#f0b48a']),
      lin('Bronze Cast', 0, [0, '#5b3d1e'], [0.45, '#c8975a'], [1, '#6e4a26']),
      lin('Brushed Steel', 90, [0, '#5d646c'], [0.5, '#c9ced4'], [1, '#6c737b']),
      rad('Chrome Ball', [0, '#ffffff'], [0.45, '#b9bec5'], [1, '#30343a']),
    ],
  },
];
