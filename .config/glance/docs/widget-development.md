# Widget Development Guide

Reference for creating new Glance widgets. Covers the Go backend, HTML templates, CSS conventions, and JS integration.

Source: `/tmp/glance` (cloned from https://github.com/glanceapp/glance).

---

## File Checklist

| File | Required | Notes |
|---|---|---|
| `internal/glance/widget-{name}.go` | Yes | Go struct, lifecycle methods |
| `internal/glance/templates/{name}.html` | Yes | Widget template |
| `internal/glance/static/css/widget-{name}.css` | If needed | Widget-specific styles only |
| Entry in `widget.go` `newWidget` switch | Yes | Registers the type string |
| `@import` in `static/css/widgets.css` | If CSS file added | |

---

## Go Struct

```go
var myWidgetTemplate = mustParseTemplate("my-widget.html", "widget-base.html")

type myWidget struct {
    widgetBase `yaml:",inline"`
    // Config fields — populated from YAML
    Limit int `yaml:"limit"`
    // Runtime fields — never from YAML
    Items []myItem `yaml:"-"`
}

func (widget *myWidget) initialize() error {
    widget.withTitle("Default Title").withCacheDuration(1 * time.Hour)
    if widget.Limit <= 0 {
        widget.Limit = 25
    }
    return nil
}

func (widget *myWidget) update(ctx context.Context) {
    items, err := fetchItems()
    if !widget.canContinueUpdateAfterHandlingErr(err) {
        return
    }
    widget.Items = items
}

func (widget *myWidget) Render() template.HTML {
    return widget.renderTemplate(widget, myWidgetTemplate)
}
```

Register in `widget.go`:
```go
case "my-widget":
    w = &myWidget{}
```

### Cache Types

| Method | Behavior |
|---|---|
| `withCacheDuration(d)` | Refresh every `d` (e.g. `1 * time.Hour`) |
| `withCacheDuration(-1)` | Never cache — always fetch |
| `withCacheOnTheHour()` | Refresh at the top of each hour |
| _(none)_ | `cacheTypeInfinite` — fetch once, never again |

### Error Handling

Use the two sentinel errors and always gate on `canContinueUpdateAfterHandlingErr`:

```go
func (widget *myWidget) update(ctx context.Context) {
    items, err := fetchItems()
    if !widget.canContinueUpdateAfterHandlingErr(err) {
        // Full error — widget shows error state, update stops
        return
    }
    // err may be errPartialContent here — widget shows notice dot
    widget.Items = items
}
```

| Error | Widget state | Retry |
|---|---|---|
| `errNoContent` | Full error UI, no content | Exponential backoff (1², 2², …, 5² min) |
| `errPartialContent` | Notice dot in header, content renders | Exponential backoff |
| `nil` | Normal | Next scheduled update |

Wrap errors appropriately:
```go
if failed == len(requests) {
    return nil, errNoContent
}
if failed > 0 {
    return entries, fmt.Errorf("%w: missing %d sources", errPartialContent, failed)
}
```

---

## HTML Template

Every template extends `widget-base.html`, which renders the outer shell (header, error state, content wrapper). Never rebuild that structure.

**Minimal template:**
```html
{{ template "widget-base.html" . }}

{{ define "widget-content" }}
<!-- widget body here -->
{{ end }}
```

**Frameless variant** (no background/border on the content area):
```html
{{ template "widget-base.html" . }}

{{ define "widget-content-classes" }}widget-content-frameless{{ end }}

{{ define "widget-content" }}
<!-- content renders without the widget frame -->
{{ end }}
```

Used by `group` and `custom-api` widgets.

### Template Functions

Available in all widget templates:

| Function | Example output |
|---|---|
| `formatApproxNumber` | `{{ .Count \| formatApproxNumber }}` → `3.2k`, `1.4m` |
| `formatNumber` | `{{ .Value \| formatNumber }}` → `1,234` |
| `dynamicRelativeTimeAttrs` | `{{ dynamicRelativeTimeAttrs .Time }}` → `data-dynamic-relative-time="..."` |
| `safeURL` | `{{ .URL \| safeURL }}` |
| `safeHTML` | `{{ .HTML \| safeHTML }}` |
| `safeCSS` | `{{ .CSS \| safeCSS }}` |
| `absInt` | `{{ .Value \| absInt }}` |
| `formatPrice` | `{{ .Price \| formatPrice }}` → `1,234.56` |
| `formatServerMegabytes` | `{{ .MB \| formatServerMegabytes }}` → `4.2 <span>GB</span>` |

---

## Content Patterns

### List Widget (RSS, releases, forum posts)

```html
<ul class="list list-gap-14 collapsible-container" data-collapse-after="{{ .CollapseAfter }}">
    {{ range .Items }}
    <li>
        <a class="size-title-dynamic color-primary-if-not-visited" href="{{ .Link }}" target="_blank" rel="noreferrer">{{ .Title }}</a>
        <ul class="list-horizontal-text">
            <li {{ dynamicRelativeTimeAttrs .PublishedAt }}></li>
            <li>{{ .Score | formatApproxNumber }} points</li>
            <li>{{ .CommentCount | formatApproxNumber }} comments</li>
        </ul>
    </li>
    {{ else }}
    <li>No items found.</li>
    {{ end }}
</ul>
```

### Stat Widget (progress bars, server stats)

```html
<div class="flex items-end size-h5">
    <div>CPU</div>
    <div class="color-highlight margin-left-auto text-very-compact">
        {{ .Value }} <span class="color-base">%</span>
    </div>
</div>
<div class="progress-bar">
    <div class="progress-value{{ if ge .Value 85 }} progress-value-notice{{ end }}"
         style="--percent: {{ .Value }}"></div>
</div>
```

Stacked progress bar (e.g. 1m + 15m CPU averages):
```html
<div class="progress-bar progress-bar-combined">
    <div class="progress-value" style="--percent: {{ .Load1 }}"></div>
    <div class="progress-value" style="--percent: {{ .Load15 }}"></div>
</div>
```

### Label/Value Row with Dotted Separator

```html
<div class="flex">
    <div class="size-h5">LABEL</div>
    <div class="value-separator"></div>
    <div class="color-highlight text-very-compact">value <span class="color-base size-h5">unit</span></div>
</div>
```

### Card Layouts

```html
<!-- Horizontal scrolling -->
<div class="cards-horizontal">
    <div class="card">...</div>
</div>

<!-- Responsive grid -->
<div class="cards-grid">
    <div class="card">...</div>
</div>
```

Both have built-in container query breakpoints that adjust `--cards-per-row` from 6 down to 2.

### Thumbnails

```html
<div class="thumbnail-container">
    <img class="thumbnail" src="{{ .ImageURL }}" alt="" loading="lazy">
</div>
```

Wrap the parent in `.thumbnail-parent` to get the hover-to-reveal-color effect:
```html
<div class="flex gap-10 thumbnail-parent">
    <div class="thumbnail-container">
        <img class="thumbnail" src="..." alt="" loading="lazy">
    </div>
    <div>...</div>
</div>
```

### Tags / Attachments

```html
<ul class="attachments">
    {{ range .Tags }}
    <li>{{ . }}</li>
    {{ end }}
</ul>
```

### Popover

```html
<div data-popover-type="html" data-popover-position="above">
    <div data-popover-html>
        <div class="flex">
            <div class="size-h5">Detail</div>
            <div class="value-separator"></div>
            <div class="color-highlight">value</div>
        </div>
    </div>
    <!-- trigger element -->
    <div>hover me</div>
</div>
```

`data-popover-position` accepts `above` or `below` (default).

### Dynamic Columns (auto-responsive)

```html
<ul class="dynamic-columns list-gap-20 list-with-separator">
    <li>...</li>
    <li>...</li>
    <li>...</li>
</ul>
```

Automatically sets 1–5 columns based on child count, collapses to 1 column below 600px container width.

---

## Text Hierarchy

| Role | Size class | Color class |
|---|---|---|
| Item title / primary link | `.size-title-dynamic` or `.size-h3` | `.color-primary-if-not-visited` |
| Section heading | `.size-h3` | `.color-highlight` |
| Body text | `.size-base` (default) | `.color-paragraph` |
| Metadata row (time, counts) | inherited | default (`.color-base`) |
| Stat labels | `.size-h5` | default |
| Stat values | — | `.color-highlight` |
| Units next to values | `.size-h5` | `.color-base` |
| Subdued / secondary info | — | `.color-subdue` |
| Errors / warnings | — | `.color-negative` |
| Success / positive | — | `.color-positive` |

`.size-title-dynamic` resolves to `--font-size-h4` in small columns and `--font-size-h3` in full-width columns.

---

## CSS Conventions

### When to add a widget CSS file

Only add `widget-{name}.css` for layout or visual rules that cannot be expressed with existing utility classes. Do not add it just to set colors or font sizes.

### Responsive: container queries only

Widget CSS must use container queries, not media queries:

```css
/* Correct */
@container widget (max-width: 599px) {
    .my-widget-thing { flex-direction: column; }
}

/* Wrong */
@media (max-width: 600px) {
    .my-widget-thing { flex-direction: column; }
}
```

`.widget-content` already has `container-type: inline-size; container-name: widget` — no extra setup needed.

### Standard breakpoints used across widgets

| Container width | Typical adjustment |
|---|---|
| `< 600px` | Single column, stack horizontally-laid-out items |
| `600px – 849px` | 2 columns |
| `850px – 1249px` | 3 columns |
| `1250px – 1499px` | 4 columns |
| `≥ 1500px` | 5 columns |

### Never hardcode colors or sizes

```css
/* Wrong */
.my-element { color: #aaa; font-size: 13px; }

/* Correct */
.my-element { color: var(--color-text-subdue); font-size: var(--font-size-base); }
```

**Color tokens:** `--color-primary`, `--color-positive`, `--color-negative`, `--color-background`, `--color-widget-background`, `--color-widget-background-highlight`, `--color-separator`, `--color-widget-content-border`, `--color-popover-background`, `--color-popover-border`, `--color-progress-border`, `--color-progress-value`, `--color-text-highlight`, `--color-text-paragraph`, `--color-text-base`, `--color-text-base-muted`, `--color-text-subdue`.

**Size tokens:** `--font-size-h1` through `--font-size-h6`, `--font-size-base`, `--widget-gap`, `--widget-content-vertical-padding`, `--widget-content-horizontal-padding`, `--border-radius`.

---

## Utility Class Reference

### Flex

```
.flex  .flex-1  .flex-wrap  .flex-nowrap  .flex-column
.items-center  .items-start  .items-end  .self-center
.justify-between  .justify-center  .justify-end  .justify-evenly  .justify-stretch
.grow  .shrink  .shrink-0
```

### Spacing

```
.gap-5  .gap-7  .gap-10  .gap-12  .gap-15  .gap-20  .gap-25  .gap-35  .gap-45  .gap-55
.margin-top-{3,5,7,10,15,20,25,35,40}  .margin-top-auto
.margin-bottom-{3,5,7,10,15}  .margin-bottom-auto  .margin-bottom-widget
.margin-block-{3,5,7,8,10,15}  .margin-left-auto
.padding-widget  .padding-block-widget  .padding-inline-widget  .padding-block-5
```

### Text

```
.text-truncate                  ← single line, ellipsis
.text-truncate-2-lines          ← clamp to 2 lines
.text-truncate-3-lines          ← clamp to 3 lines
.text-left  .text-right  .text-center
.uppercase  .break-all
.text-compact                   ← word-spacing: -0.18em
.text-very-compact              ← word-spacing: -0.35em (for numbers with units)
.text-elevate                   ← margin-top: -0.2em (optical alignment)
```

### Display / Layout

```
.block  .inline-block  .relative  .overflow-hidden
.min-width-0    ← required on flex children containing truncatable text
.max-width-100
.pointer-events-none  .select-none
```

### Misc

```
.rounded                ← border-radius: var(--border-radius)
.cursor-help
.rtl                    ← direction: rtl
.visually-hidden        ← accessible hide (screen readers only)
.hide-scrollbars
.flat-icon              ← auto-inverts SVG icons in dark mode
.ui-icon                ← 2.3rem × 2.3rem block icon
```

### List gaps

`.list` sets the base; combine with a gap modifier:

```
.list-gap-2   (0.2rem total)
.list-gap-4   (0.4rem)
.list-gap-8   (0.8rem)
.list-gap-10  (1rem)
.list-gap-14  (1.4rem)   ← standard for text lists
.list-gap-20  (2rem)
.list-gap-24  (2.4rem)
.list-gap-34  (3.4rem)
```

---

## Rules

- All external links: `target="_blank" rel="noreferrer"`
- All images: `loading="lazy"`
- Flex children with truncatable text: add `.min-width-0`
- Metadata rows: use `.list-horizontal-text` (auto bullet separators via CSS `::after`)
- Compute data in Go's `update()`, not in templates — templates should only format and render
- Do not add JS outside of `page.js`'s `setupPage()` flow; use `data-*` attributes as the JS/HTML interface
- Check `utils.css` before writing any new CSS utility — it likely already exists
