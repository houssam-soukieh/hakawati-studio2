// Visual styles the user picks for a story. `brief` goes to the director (style bible) and to every artist call,
// so the whole film keeps one look. Palettes are only a starting point: the director may adjust them to the story.

export const STYLES = {
  photoreal: {
    label: 'Cinematic photoreal', labelAr: 'سينمائي واقعي', emoji: '📷',
    brief: 'Photorealistic live-action film look: real people and places, motivated cinematic lighting (key light, rim light, practical lights), shallow depth of field, anamorphic framing, subtle film grain, colour-graded (teal shadows, warm highlights). Each shot is a single still frame; motion comes from the camera and light.',
    image: 'cinematic film still, photorealistic, 35mm lens, shallow depth of field, volumetric light, rim light, highly detailed skin and fabric texture, colour graded, film grain',
    palette: { bg: '#0B1016', sky1: '#16303D', sky2: '#C7853F', ink: '#F3F1EC', accent: '#4FD1E8', accent2: '#E8A74F', shadow: '#05080C' },
  },
  cinematic: {
    label: 'Flat cinematic', labelAr: 'سينمائي مسطّح', emoji: '🎬',
    brief: 'Flat cinematic vector illustration: bold simple shapes, soft linear/radial gradients for sky and light, long soft shadows, strong silhouettes, atmospheric perspective (far layers paler and bluer), dramatic lighting with glow (feGaussianBlur), limited harmonious palette. No outlines.',
    image: 'flat vector illustration, bold simple shapes, soft gradients, long soft shadows, strong silhouettes, atmospheric perspective, cinematic lighting',
    palette: { bg: '#0E1A2B', sky1: '#1D3557', sky2: '#E07A5F', ink: '#F1FAEE', accent: '#F2CC8F', accent2: '#81B29A', shadow: '#0B1320' },
  },
  paper: {
    label: 'Paper cut-out', labelAr: 'قصاصات ورق', emoji: '✂️',
    brief: 'Layered paper cut-out diorama: every shape is a flat paper layer with a soft drop shadow (feDropShadow dy 4-8, 25% black) so layers float above each other, slightly irregular hand-cut edges (paths, not perfect circles), warm craft colours, subtle paper grain (feTurbulence at very low opacity). Motion feels like puppets on sticks: gentle bobbing and sliding.',
    image: 'layered paper cut-out diorama, handmade craft paper layers with soft drop shadows, warm studio light, tilt-shift',
    palette: { bg: '#F4E9D8', sky1: '#A8DADC', sky2: '#F1FAEE', ink: '#3D2C2E', accent: '#E63946', accent2: '#457B9D', shadow: '#2B2024' },
  },
  shadow: {
    label: 'Shadow play', labelAr: 'خيال الظل', emoji: '🏮',
    brief: 'Arabic shadow-play (khayal al-zill, Karagoz) look: characters and props are pure black or deep-brown silhouettes with tiny cut-out holes for eyes and ornament, standing in front of a glowing warm translucent screen (radial gradient amber → orange → deep red at the edges, a lamp hotspot), Islamic geometric or arabesque frame border, flickering lamp light (opacity/brightness flicker). Puppets move with jointed, hinged motion (rotate limbs around joints) and slight jitter.',
    image: 'shadow puppet theatre, black jointed puppet silhouettes in front of a glowing amber translucent screen, oil lamp hotspot, arabesque frame',
    palette: { bg: '#2A0E05', sky1: '#FFC46B', sky2: '#C2410C', ink: '#120804', accent: '#FFE8B0', accent2: '#7C2D12', shadow: '#000000' },
  },
  storybook: {
    label: 'Picture book', labelAr: 'كتاب أطفال', emoji: '📖',
    brief: 'Warm children\'s picture-book: rounded friendly shapes, big expressive eyes, pastel palette with one saturated accent, soft gradients, little decorative details (stars, flowers, dotted paths), cosy lighting. Characters squash-and-stretch and bounce playfully.',
    image: "children's picture book illustration, gouache and watercolour, soft pastel colours, rounded friendly shapes, cosy light",
    palette: { bg: '#FFF4E6', sky1: '#BDE0FE', sky2: '#FFD6E0', ink: '#3A3042', accent: '#FF8FAB', accent2: '#8ECAE6', shadow: '#5C4D6B' },
  },
  neon: {
    label: 'Neon lines', labelAr: 'خطوط نيون', emoji: '💡',
    brief: 'Neon line-art on a near-black background: everything drawn with glowing strokes (stroke-width 3-6, round caps, feGaussianBlur glow duplicated under each stroke), almost no fills, cyan/magenta/amber palette, lines DRAW themselves on (stroke-dasharray + stroke-dashoffset animation), subtle scanlines and flicker.',
    image: 'neon line art glowing on a near-black background, cyan magenta and amber light trails, synthwave, bloom',
    palette: { bg: '#05060F', sky1: '#0B1030', sky2: '#1A0B2E', ink: '#E8F7FF', accent: '#00F0FF', accent2: '#FF2BD6', shadow: '#000000' },
  },
  miniature: {
    label: 'Miniature', labelAr: 'منمنمات', emoji: '🕌',
    brief: 'Persian/Arab miniature painting look (al-Wasiti, Maqamat): flat decorative perspective (stacked planes, no vanishing point), rich lapis blue, gold, vermilion and turquoise, ornamental borders, patterned carpets and tiles, stylised trees and rocks with outline strokes in dark brown, figures in elegant robes with gentle gestures, gold sky or night sky with stylised stars.',
    image: 'Persian miniature painting, gold leaf, lapis lazuli and vermilion, flat decorative perspective, ornamental border, fine brushwork',
    palette: { bg: '#1B2A4A', sky1: '#D4AF37', sky2: '#F3E5AB', ink: '#2B1B0E', accent: '#C0392B', accent2: '#1ABC9C', shadow: '#120C06' },
  },
  explainer: {
    label: 'Explainer', labelAr: 'إنفوجرافيك شارح', emoji: '📊',
    brief: 'Clean modern explainer / infographic: geometric icons, isometric or flat diagrams, arrows and connectors that draw on, numbers that count up, charts that grow, generous negative space, a tidy grid, friendly flat characters with simple limbs. Motion is crisp: ease-out pops, slides and scale-ins, staggered.',
    image: 'clean isometric 3d illustration, soft studio lighting, minimal, smooth matte materials',
    palette: { bg: '#0F172A', sky1: '#1E293B', sky2: '#334155', ink: '#F8FAFC', accent: '#38BDF8', accent2: '#FBBF24', shadow: '#020617' },
  },
};

export const CAMERAS = ['static', 'push-in', 'pull-out', 'pan-left', 'pan-right', 'tilt-up', 'tilt-down', 'drift'];
export const TRANSITIONS = ['cut', 'fade', 'fade-black', 'wipe-left', 'wipe-right', 'slide-left', 'slide-right', 'circle-open', 'zoom-in', 'smooth'];
export const SHOT_TYPES = ['establishing', 'wide', 'medium', 'close', 'extreme-close', 'insert', 'over-shoulder', 'pov'];

export const ASPECTS = {
  '16:9': { w: 1280, h: 720 },
  '9:16': { w: 720, h: 1280 },
  '1:1': { w: 1080, h: 1080 },
};
export const QUALITY = { '720p': 720, '1080p': 1080 };
/** Native SDXL sizes per frame shape (the player crops with object-fit: cover). */
export const IMAGE_SIZES = { '16:9': { w: 1344, h: 768 }, '9:16': { w: 768, h: 1344 }, '1:1': { w: 1024, h: 1024 } };

/** Output pixel size for an aspect + quality (the short side = quality). */
export function outputSize(aspect, quality) {
  const a = ASPECTS[aspect] ?? ASPECTS['16:9'];
  const short = QUALITY[quality] ?? 720;
  const k = short / Math.min(a.w, a.h);
  const even = v => Math.round(v * k / 2) * 2;
  return { w: even(a.w), h: even(a.h) };
}
