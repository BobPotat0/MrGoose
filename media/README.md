# Mr Goose water idle

- Source: `../electron/assets/goose-water-idle.svg` (continuous loop; respects reduced motion).
- Export: `mr-goose-water-idle.mp4` — H.264, 1280 × 720, 60 fps, 10.8 seconds, no audio.
- Uses the original mascot geometry and palette, with a fixed waterline covering the bottom pixel row.

The startup panel renders the animation inline in `electron/startup.html` and `electron/startup.css` to avoid external-SVG rendering artifacts. Keep the standalone SVG and inline geometry/timing in sync. Startup uses the SVG animation rather than video playback.

The MP4 contains the character and water only. All 648 exported frames were checked for successful decoding.
