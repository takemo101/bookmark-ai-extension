# Chrome Web Store assets

Generated for Bookmark AI Extension v0.1.x publication.

## Upload candidates

- `store-icon-128.png` — Chrome Web Store item icon.
- `screenshot-library-1280x800.png` — screenshot candidate for the listing.
- `promo-small-440x280.png` — small promotional tile candidate.
- `promo-marquee-1400x560.png` — marquee / large promotional tile candidate if requested by the store listing flow.

The extension package itself uses the compact runtime icons under
`public/icons/`, which are optimized for small Chrome toolbar/action sizes,
referenced from `manifest.config.ts`, and copied into `dist/icons/` during
`vite build`.

## Visual direction

Warm Library: warm paper surfaces, muted brown ink, a bookmark ribbon, and a
small AI sparkle. Avoid generic neon AI gradients so the listing matches the
public site and extension UI.
