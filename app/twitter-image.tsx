// Reuse the OpenGraph image for the Twitter/X card (summary_large_image).
// `runtime` must be declared locally — Next can't statically parse a re-export.
export const runtime = 'nodejs';
export { default, alt, size, contentType } from './opengraph-image';
