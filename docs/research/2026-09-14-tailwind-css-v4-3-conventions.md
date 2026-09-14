# Tailwind CSS v4.3 Conventions

Source: https://chatgpt.com/share/6aa740fb-caa8-83eb-b924-374b0350cb7c

---

**User**

What are the official Tailwind CSS v4 conventions for organizing
     globals.css: @theme vs @theme inline, semantic color tokens with light and dark values,
     @utility vs @layer components, and nesting media queries inside :root? Cite tailwindcss.com
     docs for v4.3.

---

**ChatGPT**

I’ll anchor this specifically to Tailwind CSS **v4.3** documentation and separate what Tailwind officially recommends from patterns that are merely valid CSS.

---

**ChatGPT**

The key distinction is that v4 separates **Tailwind theme registration** from **runtime CSS theming**. That makes the light/dark-token pattern much cleaner than trying to redefine `@theme` under `.dark` or a media query.

---

**ChatGPT**

For **Tailwind CSS v4.3**, the cleanest mental model is:

> **`@theme` defines Tailwind’s design-system API; ordinary CSS variables hold runtime/theme-dependent values; `@theme inline` bridges those runtime variables into Tailwind utilities. `@utility` creates real Tailwind utilities; `@layer components` is ordinary component CSS in the components cascade layer.**

That distinction matches the official v4.3 docs. ([Tailwind CSS](https://tailwindcss.com/docs/theme?utm_source=chatgpt.com))

| Concern | Tailwind v4.3 convention |
|---|---|
| Fixed design token | `@theme` |
| Token referencing another CSS variable | `@theme inline` |
| Light/dark semantic value | normal CSS variable in `:root` + dark selector/media |
| Expose semantic value as `bg-*`, `text-*`, etc. | map it with `@theme inline` |
| New Tailwind-style utility | `@utility` |
| Reusable `.card`, `.btn`, third-party CSS | `@layer components` |
| `@theme` inside `:root`, `.dark`, or `@media` | **No** — `@theme` must be top-level |
| Normal CSS `@media` nested inside `:root` | Supported CSS nesting, but not required |

### 1. `@theme` vs `@theme inline`

Use plain **`@theme` when the value is the token itself**:

```css
@theme {
  --color-brand-500: oklch(0.62 0.2 250);
  --font-display: "Inter", sans-serif;
  --radius-card: 0.75rem;
}
```

Theme variables do more than ordinary custom properties: their namespaces tell Tailwind which utilities to generate. For example, a `--color-brand-500` theme variable gives you utilities such as `bg-brand-500` and `text-brand-500`. Tailwind explicitly says `@theme` must be defined at the top level, not inside a selector or media query. ([Tailwind CSS](https://tailwindcss.com/docs/theme?utm_source=chatgpt.com))

Use **`@theme inline` when a Tailwind theme variable references another CSS variable**:

```css
@theme inline {
  --color-background: var(--app-background);
}
```

With `inline`, a utility like `bg-background` effectively uses the referenced value directly rather than introducing another level of CSS-variable resolution. Tailwind specifically recommends the `inline` option when theme variables reference other variables because ordinary CSS custom-property resolution can otherwise produce surprising results. ([Tailwind CSS](https://tailwindcss.com/docs/theme?utm_source=chatgpt.com))

So this:

```css
@theme {
  --color-brand: #2563eb;
}
```

is normal.

This:

```css
@theme inline {
  --color-background: var(--app-background);
}
```

is the intended alias/bridge pattern.

### 2. Semantic colors with light and dark values

Tailwind's own colors documentation shows essentially this exact pattern:

```css
:root {
  --acme-canvas-color: /* light */;
}

[data-theme="dark"] {
  --acme-canvas-color: /* dark */;
}

@theme inline {
  --color-canvas: var(--acme-canvas-color);
}
```

The resulting Tailwind semantic utility is then `bg-canvas`, `text-canvas`, etc. ([Tailwind CSS](https://tailwindcss.com/docs/colors?utm_source=chatgpt.com))

For an application, I'd organize that idea like this:

```css
@import "tailwindcss";

:root {
  --app-background: oklch(0.99 0 0);
  --app-foreground: oklch(0.15 0 0);
  --app-surface: oklch(1 0 0);
  --app-muted: oklch(0.55 0 0);
}

[data-theme="dark"] {
  --app-background: oklch(0.15 0 0);
  --app-foreground: oklch(0.96 0 0);
  --app-surface: oklch(0.2 0 0);
  --app-muted: oklch(0.7 0 0);
}

@theme inline {
  --color-background: var(--app-background);
  --color-foreground: var(--app-foreground);
  --color-surface: var(--app-surface);
  --color-muted: var(--app-muted);
}
```

Now your markup stays semantic:

```html
<body class="bg-background text-foreground">
  <div class="bg-surface text-muted">
    ...
  </div>
</body>
```

This is generally preferable to defining things like `--color-background-light` and `--color-background-dark` as two separate Tailwind colors, because the semantic utility stays `bg-background` while the underlying runtime value changes.

Tailwind does **not prescribe particular semantic names** like `background`, `surface`, or `foreground`; the important convention is that Tailwind-facing colors use the `--color-*` namespace. ([Tailwind CSS](https://tailwindcss.com/docs/theme?utm_source=chatgpt.com))

### 3. Don't put light/dark `@theme` declarations under selectors

This is the important v4 rule.

Avoid:

```css
:root {
  @theme {
    --color-background: white;
  }
}

.dark {
  @theme {
    --color-background: black;
  }
}
```

and avoid:

```css
@media (prefers-color-scheme: dark) {
  @theme {
    --color-background: black;
  }
}
```

Tailwind explicitly requires theme variables to be **top-level and not nested under selectors or media queries**. ([Tailwind CSS](https://tailwindcss.com/docs/theme?utm_source=chatgpt.com))

Use normal CSS custom properties for the condition, then expose them through one top-level `@theme inline`.

### 4. `@utility` vs `@layer components`

These have different jobs in v4.

Use **`@utility` when you're extending Tailwind's utility API**:

```css
@utility content-auto {
  content-visibility: auto;
}
```

It becomes a genuine Tailwind utility and automatically works with variants:

```html
<div class="content-auto lg:content-auto hover:content-auto">
```

Custom utilities are automatically placed alongside Tailwind's built-in utilities. ([Tailwind CSS](https://tailwindcss.com/docs/adding-custom-styles?utm_source=chatgpt.com))

This is particularly important in v4 because Tailwind no longer hijacks native `@layer` declarations to register utilities. The upgrade guide specifically identifies `@utility` as the replacement for the old v3 practice of defining utility classes in `@layer utilities`/`@layer components`. ([Tailwind CSS](https://tailwindcss.com/docs/upgrade-guide?utm_source=chatgpt.com))

Use **`@layer components` for conventional reusable CSS classes**:

```css
@layer components {
  .card {
    background: var(--color-surface);
    border-radius: var(--radius-lg);
    padding: --spacing(6);
    box-shadow: var(--shadow-xl);
  }
}
```

Tailwind's v4 docs explicitly recommend the components layer for classes such as `.card`, `.btn`, and `.badge`, as well as styles for third-party components. Because the components layer comes before utilities, normal Tailwind utilities can override those styles. ([Tailwind CSS](https://tailwindcss.com/docs/adding-custom-styles?utm_source=chatgpt.com))

So the practical rule is:

**Want `hover:foo`, `lg:foo`, etc., with `foo` behaving like a first-class Tailwind utility? → `@utility`.**

**Want a conventional bundled component class like `.prose-widget`, `.card`, or third-party override? → `@layer components`.**

### 5. Media queries nested inside `:root`

Something like this is fine as **ordinary CSS**:

```css
:root {
  --app-background: white;

  @media (prefers-color-scheme: dark) {
    --app-background: black;
  }
}
```

Tailwind v4 uses Lightning CSS and explicitly supports modern CSS nesting, including nested rules rather than requiring Sass/PostCSS nesting plugins. ([Tailwind CSS](https://tailwindcss.com/docs/compatibility?utm_source=chatgpt.com))

But there are two qualifications.

First, that permission applies to **ordinary CSS**. You still cannot put `@theme` there.

Second, if your application supports a manual theme toggle, a selector is usually clearer:

```css
:root {
  --app-background: white;
}

[data-theme="dark"] {
  --app-background: black;
}
```

Tailwind officially documents manual dark mode using either a `.dark` selector or a `data-theme="dark"` selector via `@custom-variant`. The default `dark:` variant, on the other hand, follows `prefers-color-scheme`. ([Tailwind CSS](https://tailwindcss.com/docs/dark-mode?source=post_page-----ff2f04329e16---------------------------------------&utm_source=chatgpt.com))

For example, with a data attribute:

```css
@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *));
```

Then:

```html
<html data-theme="dark">
```

activates both your CSS-variable overrides and Tailwind's `dark:*` utilities. ([Tailwind CSS](https://tailwindcss.com/docs/dark-mode?source=post_page-----ff2f04329e16---------------------------------------&utm_source=chatgpt.com))

### A good v4.3 `globals.css` organization

Putting those conventions together:

```css
@import "tailwindcss";

/* Optional: selector-driven dark mode */
@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *));

/* Runtime/semantic values */
:root {
  --app-background: oklch(0.99 0 0);
  --app-foreground: oklch(0.15 0 0);
  --app-surface: oklch(1 0 0);
}

[data-theme="dark"] {
  --app-background: oklch(0.15 0 0);
  --app-foreground: oklch(0.96 0 0);
  --app-surface: oklch(0.2 0 0);
}

/* Static Tailwind design tokens */
@theme {
  --color-brand-500: oklch(0.62 0.2 250);
  --radius-card: 0.75rem;
}

/* Tailwind names backed by runtime variables */
@theme inline {
  --color-background: var(--app-background);
  --color-foreground: var(--app-foreground);
  --color-surface: var(--app-surface);
}

/* Element defaults */
@layer base {
  body {
    background: var(--color-background);
    color: var(--color-foreground);
  }
}

/* Conventional reusable component classes */
@layer components {
  .card {
    background: var(--color-surface);
    border-radius: var(--radius-card);
  }
}

/* First-class Tailwind utilities */
@utility scrollbar-hidden {
  &::-webkit-scrollbar {
    display: none;
  }
}
```

The ordering above is a **sensible organizational convention, not a mandated Tailwind file layout**. The hard rule from Tailwind is primarily that `@theme` is top-level; the semantic/runtime split and `@theme inline` pattern follow directly from Tailwind's documented variable-reference example. ([Tailwind CSS](https://tailwindcss.com/docs/theme?utm_source=chatgpt.com))

One useful shorthand is: **palette/primitives in `@theme`; mutable semantics in normal CSS variables; Tailwind aliases in `@theme inline`; structural defaults in `@layer base`; reusable CSS components in `@layer components`; framework-style primitives in `@utility`.**
