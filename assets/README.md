# Website image assets

All public website images must be committed under this directory. Cloudflare deploys the repository root as static assets, so an image at `assets/example.webp` is available at `/assets/example.webp`.

## Adding or replacing an image

1. Use a web-ready PNG, WebP, SVG, or JPEG and give it a lowercase, hyphenated filename.
2. Place the file in `assets/` (or an appropriate subdirectory) and commit it with the code that references it.
3. Reference it with a root-relative URL, such as `/assets/example.webp`; do not use a local computer path, a GitHub attachment URL, or a path without the `/assets/` directory.
4. Define its display size with CSS that preserves its aspect ratio (`background-size: contain` for CSS backgrounds, or proportional `width`/`height` for `<img>` elements). Do not force a wide logo into a square or circular container.
5. Verify the exact filename and casing. Static asset URLs are case-sensitive in deployment.

The footer currently uses the square `/assets/sg-motif.png` asset. `brand-logo.css` contains it within the existing 285 × 72 footer brand area without distortion and aligns it to the left. If a horizontal wordmark is introduced later, update the scoped footer CSS dimensions and positioning alongside the asset.
