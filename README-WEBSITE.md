# HikisTrack website

This folder is a static website. Upload its contents to any ordinary static web host, or run it locally from an HTTP server. Opening `index.html` directly is not supported because browsers block the game's Web Workers and WebAssembly from `file://` pages.

For a local copy, install Node.js and run:

```powershell
node serve.cjs
```

Then open <http://127.0.0.1:4173>.

The TAS Editor opens in a browser popup, so allow popups for the HikisTrack site. The game window must stay open while the editor is in use. BruteForce uses PolyTrack's browser simulation workers in the website build. The native Rust executable remains available in the desktop build because browsers cannot execute a bundled native binary.
