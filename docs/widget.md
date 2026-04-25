# Building a Widget in Seelen UI

A **widget** is a small web app (HTML + CSS + JS) that runs inside an isolated Seelen UI webview window. You can use any framework (React, Svelte, Vue, vanilla JS) or none at all.

---

## 1. Folder Structure

```
my-widget/
├── metadata.yml   ← resource definition (references all other files)
├── index.html     ← HTML body content (no <html>/<head>/<body> needed)
├── index.js       ← bundled JavaScript
├── index.css      ← bundled CSS
└── i18n/          ← translations (optional)
    ├── display_name.yml
    └── description.yml
```

---

## 2. The `metadata.yml` File

This is the entry point. Every widget needs one:

```yaml
id: "@yourname/my-widget"

metadata:
  displayName: My Widget
  description: A short description.
  tags:
    - clock
    - minimal

# Icon shown in settings (must be a valid react-icons name)
icon: PiClockFill

# Window behavior preset: None | Desktop | Overlay | Popup
preset: Overlay

# Instance mode: Single | Multiple | ReplicaByMonitor
instances: Single

# If true, widget window isn't created until explicitly triggered
lazy: false

# Source files (required) — paths relative to metadata.yml
html: !include index.html
js: !include index.js
css: !include index.css

# User-configurable settings (optional)
settings: []
```

**Required fields:** `id`, `html`, `js`, `css`. Everything else is optional.

---

## 3. The HTML Entry Point

The HTML is **injected directly into the `<body>`** of the widget's webview. You don't write `<html>`, `<head>`, or `<body>` tags — just a mount point:

```html
<!-- index.html -->
<div id="root"></div>
```

No `<link>` or `<script>` tags are needed — CSS and JS are injected by the widget loader based on `metadata.yml`.

---

## 4. Window Behavior (Presets)

The `preset` field controls how the widget window behaves:

| Preset     | Behavior |
|---|---|
| `None` | Full manual control — nothing applied automatically |
| `Desktop` | Always behind other windows, no title bar, remembers position/size |
| `Overlay` | Always on top, no title bar |
| `Popup` | Always on top, no title bar, auto-hides on focus loss, shown/hidden by triggers only |

The `instances` field controls how many copies can run:

| Value | Behavior |
|---|---|
| `Single` | Only one instance (default) |
| `Multiple` | User can create as many as they want |
| `ReplicaByMonitor` | One instance per connected monitor |

---

## 5. User-Configurable Settings

Define settings in `metadata.yml` so users can configure your widget from the Seelen UI settings panel.

### Common Fields (all types)

```yaml
key: my-setting          # Unique identifier (required)
label: My Setting        # Label shown in settings panel (required)
description: Some help.  # Extra text under the label (optional)
tip: A tooltip.          # Tooltip on icon next to label (optional)
allowSetByMonitor: false # If true, user can set different values per monitor
dependencies:            # Keys that must be truthy for this setting to be active
  - some-other-key
```

### Setting Types

**Switch (boolean toggle):**

```yaml
- type: switch
  key: show-seconds
  label: Show seconds
  defaultValue: true
```

**Select (dropdown or inline buttons):**

```yaml
# Dropdown (default)
- type: select
  key: clock-format
  label: Time format
  defaultValue: "12h"
  options:
    - value: "12h"
      label: 12-hour
    - value: "24h"
      label: 24-hour

# Inline buttons
- type: select
  key: position
  label: Position
  defaultValue: left
  subtype: Inline
  options:
    - value: left
      label: Left
    - value: center
      label: Center
    - value: right
      label: Right
```

Each option can also have an `icon` (a react-icons name).

**Text input:**

```yaml
- type: text
  key: greeting
  label: Greeting message
  defaultValue: "Hello"
  maxLength: 100

- type: text
  key: custom-css
  label: Custom CSS
  defaultValue: ""
  multiline: true
```

**Number input:**

```yaml
- type: number
  key: refresh-rate
  label: Refresh rate (ms)
  defaultValue: 1000
  min: 100
  max: 60000
  step: 100
```

**Range (slider):**

```yaml
- type: range
  key: opacity
  label: Opacity
  defaultValue: 100
  min: 10
  max: 100
  step: 5
```

**Color picker:**

```yaml
- type: color
  key: accent-color
  label: Accent color
  defaultValue: "#6c63ff"
  allowAlpha: true
```

**Grouping settings:**

```yaml
settings:
  - type: switch
    key: enabled-clock
    label: Show clock

  - group:
      label: Appearance
      items:
        - type: color
          key: text-color
          label: Text color
          defaultValue: "#ffffff"

        - type: range
          key: font-size
          label: Font size
          defaultValue: 14
          min: 10
          max: 32
          step: 1
```

> **Reserved keys:** `enabled` and `$instances` are reserved by Seelen UI and cannot be used as setting keys.

---

## 6. CSS Rules

**Use plain global class names — never CSS Modules.** Themes inject CSS into your widget's webview and target elements by class name. If your build tool hashes class names, theme authors can't target them.

```css
/* ✅ Good — stable, targetable by themes */
.my-widget-toolbar {
  display: flex;
}
.my-widget-btn {
  border-radius: 6px;
}
```

```css
/* ❌ Avoid — hashed names break theming */
.toolbar_xK92a { ... }
```

---

## 7. Plugins (Optional Extensibility)

Plugins are declaration files that target your widget by ID and provide data. Your widget decides what plugin data means and how to use it. The built-in toolbar (`@seelen/fancy-toolbar`) is the canonical example — all its buttons (clock, battery, network, volume) are independent plugins.

If you want to support plugins:
1. Define a plugin schema (document what fields you expect)
2. Load plugins targeting your widget ID at runtime
3. Apply the plugin data however your widget needs

A plugin targeting your widget looks like:

```yaml
id: "@someone/clock-button"
target: "@yourname/my-widget"
plugin:
  someField: someValue
```

The `plugin` field is free-form — any valid YAML. Your widget receives it as-is.

---

## 8. Development Workflow

**Load your widget for testing:**

```bash
seelen-ui resource load widget ./my-widget
```

**Unload it:**

```bash
seelen-ui resource unload widget ./my-widget
```

The resource registers immediately — no app restart needed. Seelen UI must be running.

**Debug with DevTools:** Focus your widget window, then press **Ctrl + Shift + I** to open DevTools for that specific webview. Inspect DOM, tweak styles, run JS, and profile performance.

---

## 9. i18n / Translations (Optional)

Support multiple languages in your metadata:

```yaml
metadata:
  displayName:
    en: My Widget
    es: Mi Widget
    de: Mein Widget
  description:
    en: A short description.
    es: Una descripción corta.
```

If you provide a language map, you **must always include `en`**. Unlisted languages fall back to English.

Use `!extend` to pull translations from separate files:

```yaml
# metadata.yml
metadata:
  displayName: !extend i18n/display_name.yml
  description: !extend i18n/description.yml
```

```yaml
# i18n/display_name.yml
en: My Widget
es: Mi Widget
de: Mein Widget
```

You can also use the CLI to auto-translate:

```bash
seelen-ui resource translate i18n/display_name.yml
```

---

## 10. Extended YAML: `!include` and `!extend`

Resource files use two custom YAML tags:

| Tag | Use it for |
|---|---|
| `!include` | Embed a file as text (CSS, SCSS, JS, HTML) |
| `!extend` | Embed a YAML file as a YAML value (translations, settings) |

Paths are relative to the folder where `metadata.yml` lives. `.scss` and `.sass` files are automatically compiled to CSS.

---

## Summary Checklist

1. **Create a folder** with `metadata.yml`, `index.html`, `index.js`, `index.css`
2. **Write `metadata.yml`** with `id`, `html`/`js`/`css` via `!include`, plus optional settings
3. **Write HTML** with just a mount point (`<div id="root"></div>`)
4. **Write CSS** using stable global class names (no CSS Modules)
5. **Bundle your JS** (or use vanilla JS)
6. **Load with CLI** (`seelen-ui resource load widget ./my-widget`)
7. **Debug** with Ctrl+Shift+I in the widget webview
8. **Add i18n** translations if desired
