/**
 * Built-in cover gradients for trips. Stored in `trips.cover_gradient` as the
 * `id` string ('gradient_1'..'gradient_8'). The `css` field is used for the
 * full-size cover render; `preview` is the smaller swatch used inside the
 * picker. Names are i18n-agnostic English labels — UI strings live in locale
 * files.
 */
export const TRIP_GRADIENTS = [
  {
    id: 'gradient_1',
    name: 'Aurora',
    css: 'linear-gradient(135deg, #667eea 0%, #764ba2 50%, #6B8DD6 100%)',
    preview: 'linear-gradient(135deg, #667eea, #764ba2)',
  },
  {
    id: 'gradient_2',
    name: 'Sunset',
    css: 'linear-gradient(135deg, #f093fb 0%, #f5576c 50%, #fda085 100%)',
    preview: 'linear-gradient(135deg, #f093fb, #f5576c)',
  },
  {
    id: 'gradient_3',
    name: 'Ocean',
    css: 'linear-gradient(135deg, #0F2027 0%, #203A43 50%, #2C5364 100%)',
    preview: 'linear-gradient(135deg, #203A43, #2C5364)',
  },
  {
    id: 'gradient_4',
    name: 'Forest',
    css: 'linear-gradient(135deg, #134E5E 0%, #71B280 100%)',
    preview: 'linear-gradient(135deg, #134E5E, #71B280)',
  },
  {
    id: 'gradient_5',
    name: 'Desert',
    css: 'linear-gradient(135deg, #f7971e 0%, #ffd200 100%)',
    preview: 'linear-gradient(135deg, #f7971e, #ffd200)',
  },
  {
    id: 'gradient_6',
    name: 'Lavender',
    css: 'linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)',
    preview: 'linear-gradient(135deg, #a18cd1, #fbc2eb)',
  },
  {
    id: 'gradient_7',
    name: 'Arctic',
    css: 'linear-gradient(135deg, #e0f7fa 0%, #80deea 50%, #00acc1 100%)',
    preview: 'linear-gradient(135deg, #80deea, #00acc1)',
  },
  {
    id: 'gradient_8',
    name: 'Midnight',
    css: 'linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%)',
    preview: 'linear-gradient(135deg, #302b63, #24243e)',
  },
];

export function getGradientById(id) {
  if (!id) return null;
  return TRIP_GRADIENTS.find((g) => g.id === id) || null;
}
