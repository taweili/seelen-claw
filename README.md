# seelen-hello

A **Hello World clock widget** for [Seelen UI](https://github.com/seelen-ui/seelen-ui) — demonstrating the widget API with a live 12-hour clock and greeting.

![hello world](screenshots/widget.png)
*(screenshot placeholder — replace with actual screenshot after first run)*

---

## What it does

A minimal, always-on-top overlay widget that shows:

- **"hello world"** greeting
- **Live clock** in 12-hour format with seconds (e.g. `3:45:30 PM`)

Built as a vanilla JS web app running inside a Seelen UI webview, using the `@seelen-ui/lib` widget API for auto-sizing, DPI normalization, and window lifecycle.

---

## Quick start

### Prerequisites

- **Node.js** 18+
- **Seelen UI** installed and running

### Install & build

```bash
npm install
npm run build
```

This bundles `src/index.js` with esbuild and copies HTML/CSS/YAML assets to `dist/`.

### Load into Seelen UI

```bash
npm run load
```

The widget appears as an always-on-top overlay. Press **Ctrl + Shift + I** on the widget window to open DevTools.

### Development mode

```bash
npm run dev
```

Watches `src/` for changes and rebuilds automatically. Reload the widget in Seelen UI after each rebuild (or unload/reload with `npm run unload && npm run load`).

---

## Project structure

```
seelen-hello/
├── src/
│   ├── metadata.yml    ← Seelen widget definition (ID, preset, includes)
│   ├── index.html      ← Mount point injected into webview
│   ├── index.js        ← Widget logic (clock + Seelen API init)
│   └── index.css       ← Widget styles
├── build.mjs           ← esbuild bundler + asset copier
├── package.json
└── README.md
```

### Key files

| File | Purpose |
|---|---|
| `src/metadata.yml` | Widget entry point — defines `id: @taweili/hello-world`, `preset: Overlay`, `instances: Single`, and includes HTML/JS/CSS via `!include` |
| `src/index.js` | Imports `Widget` from `@seelen-ui/lib`, formats time with `Intl.DateTimeFormat`, updates DOM every second, calls `widget.init()` and `widget.ready()` |
| `build.mjs` | Copies non-JS assets to `dist/`, bundles `index.js` as IIFE via esbuild (target: chrome100) |

---

## Widget API usage

The widget uses three `@seelen-ui/lib` APIs:

```js
import { Widget } from "@seelen-ui/lib";

const widget = Widget.getCurrent();

await widget.init({
  autoSizeByContent: document.querySelector(".hw-root"),
  autoSizeFitOnScreen: true,
  normalizeDevicePixelRatio: true,
});

await widget.ready({ show: true });
```

- **`autoSizeByContent`** — sizes the webview window to fit the `.hw-root` element
- **`autoSizeFitOnScreen`** — clamps size to screen bounds
- **`normalizeDevicePixelRatio`** — ensures crisp rendering on high-DPI displays
- **`widget.ready({ show: true })`** — signals Seelen UI that the widget is ready and should be shown

---

## NPM scripts

| Script | Description |
|---|---|
| `npm run build` | Bundle JS + copy assets to `dist/` |
| `npm run dev` | Watch mode — rebuild on file changes |
| `npm run load` | Load widget into Seelen UI (`seelen-ui resource load widget ./dist`) |
| `npm run unload` | Unload widget from Seelen UI (`seelen-ui resource unload widget ./dist`) |

---

## License

[GNU General Public License v3.0](LICENSE.md)
