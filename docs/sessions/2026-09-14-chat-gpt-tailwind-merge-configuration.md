# Tailwind Merge Configuration

Source: https://chatgpt.com/share/6aa74102-5e30-83ed-8d33-a3152e6ef109

---

## Turn 1: User

_2026-09-14T00:33:04.630Z_

In a Tailwind v4 + React 19 codebase with custom theme tokens (for example
     text-muted, font-display, tracking-display), should components merge className with clsx alone
     or with tailwind-merge v3? Explain how tailwind-merge must be configured for custom tokens, and
     the risks of misclassifying them.

---

## Turn 2: ChatGPT

_2026-09-14T00:33:05.583Z_

I’ll ground this in the current Tailwind v4 / tailwind-merge v3 behavior, because the custom-token handling is exactly where seemingly “smart” merging can become unsafe.

---

## Turn 3: ChatGPT

_2026-09-14T00:33:27.541Z_

The key distinction is not React 19; it’s whether `className` is merely additive or is part of an override API. For reusable primitives, consumer overrides are usually intentional, so deterministic conflict resolution is valuable—but only if the merger understands your token semantics.

---

## Turn 4: ChatGPT

_2026-09-14T00:33:38.657Z_

For a reusable React component library where `className` is expected to override component defaults, I’d use **`tailwind-merge` v3, but only through a centrally configured wrapper**. Use `clsx` alone when `className` is merely additive and you do not promise override semantics.

The reason is subtle: `clsx` only concatenates strings. If a component renders `px-4` and the caller passes `px-8`, keeping both does **not** mean the later token in the HTML `class` attribute wins; CSS rule order determines the winner. `tailwind-merge` removes the earlier conflicting utility, making the override deterministic. The tailwind-merge project explicitly describes merging a component's defaults with a `className` prop as its primary use case. ([GitHub](https://github.com/dcastil/tailwind-merge/blob/main/docs/when-and-how-to-use-it.md?utm_source=chatgpt.com))

For example:

```ts
import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      font: ['display'],
      tracking: ['display'],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```

Then:

```tsx
<div className={cn('font-display tracking-display px-4', className)} />
```

### Configure from the **Tailwind token namespace**, not the class spelling

With Tailwind v4, theme variables generate utilities according to their namespace. For example, `--font-display` creates `font-display`, while `--tracking-display` creates `tracking-display`. Tailwind itself documents this namespace-to-utility relationship. ([Tailwind CSS](https://tailwindcss.com/docs/theme?utm_source=chatgpt.com))

`tailwind-merge` v3 deliberately mirrors those v4 namespaces:

```css
@theme {
  --color-muted: ...;
  --font-display: "Inter", sans-serif;
  --tracking-display: -0.03em;
  --text-heading: 3rem;
}
```

maps to:

```ts
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      // --font-display
      font: ['display'],

      // --tracking-display
      tracking: ['display'],

      // --text-heading
      text: ['heading'],

      // --color-muted does NOT normally need adding
    },
  },
})
```

In v3 the relevant keys are literally `color`, `font`, `text`, `font-weight`, `tracking`, `leading`, `spacing`, etc., matching Tailwind v4's namespaces. ([GitHub](https://github.com/dcastil/tailwind-merge/blob/main/docs/configuration.md?utm_source=chatgpt.com))

There is one useful exception: **custom colors are intentionally permissive out of the box**. So if:

```css
@theme {
  --color-muted: oklch(...);
}
```

then `text-muted`, `bg-muted`, `border-muted`, etc. generally need no extra tailwind-merge config:

```ts
twMerge('text-red-500 text-muted')
// -> 'text-muted'
```

The library specifically documents this behavior. ([GitHub](https://github.com/dcastil/tailwind-merge/blob/main/docs/configuration.md?utm_source=chatgpt.com))

But `text-muted` illustrates the main danger. If `muted` came from:

```css
@theme {
  --text-muted: 0.875rem;
}
```

then it is a **font size**, not a color, and should be registered as:

```ts
theme: {
  text: ['muted'],
}
```

The same visible prefix, `text-*`, represents both font-size and color utilities. tailwind-merge has to classify the utility correctly before it can decide what conflicts. Its documentation explicitly calls `text-*` ambiguous and notes that unknown ambiguous values can default to color interpretation. ([GitHub](https://github.com/dcastil/tailwind-merge/blob/main/docs/features.md?utm_source=chatgpt.com))

The same issue exists with `font-*`: Tailwind uses that prefix for both **font family** and **font weight**. `font-display` from `--font-display` belongs to the `font` theme scale; `font-brand-bold` from `--font-weight-brand-bold` belongs to `font-weight`. tailwind-merge also documents ambiguity between font family and font weight, especially with arbitrary values. ([GitHub](https://github.com/dcastil/tailwind-merge/blob/main/docs/limitations.md?utm_source=chatgpt.com))

### Why misclassification is worse than no merging

There are two failure modes.

A **false negative** means tailwind-merge does not realize two utilities conflict:

```ts
cn('tracking-display', 'tracking-normal')
// potentially both survive if custom tracking isn't understood
```

Now you're back to CSS cascade ordering instead of “caller wins.”

A **false positive** is more dangerous because tailwind-merge silently deletes a class that should coexist. Imagine mistakenly teaching it that `font-display` is a font-weight:

```tsx
className="font-display font-bold"
```

Those should coexist: one selects a family and one selects a weight. If they are put in the same conflict group, one can disappear.

Similarly, suppose `text-muted` is not actually a Tailwind color at all:

```css
@utility text-muted {
  opacity: 0.6;
}
```

Because tailwind-merge intentionally treats arbitrary `text-<name>` values permissively as colors, it may regard `text-muted` as conflicting with `text-red-500`, even though one changes opacity and the other changes `color`. That's why custom utilities that don't have standard Tailwind semantics should preferably use a non-colliding name such as `typography-muted`, or be modeled explicitly with custom class groups. The tailwind-merge docs recommend non-conflicting names for precisely this situation. ([GitHub](https://github.com/dcastil/tailwind-merge/blob/main/docs/limitations.md?utm_source=chatgpt.com))

So I would adopt this rule:

> **Application/component primitives:** `cn = configuredTwMerge(clsx(...))`, with tailwind-merge's theme configuration kept in sync with every nonstandard `@theme` namespace value that affects classification.  
> **Internal conditional composition where override behavior isn't needed:** `clsx` alone is simpler and safer.

And I would add unit tests around the design-system tokens, for example:

```ts
expect(cn('font-sans', 'font-display'))
  .toBe('font-display')

expect(cn('tracking-normal', 'tracking-display'))
  .toBe('tracking-display')

expect(cn('text-red-500', 'text-muted'))
  .toBe('text-muted') // if muted is --color-muted

expect(cn('text-sm', 'text-heading'))
  .toBe('text-heading') // if heading is --text-heading

expect(cn('font-display', 'font-bold'))
  .toBe('font-display font-bold')
```

Those tests are important because tailwind-merge is a **runtime model of Tailwind's semantics**, not Tailwind itself; it does not inspect your generated CSS or automatically read your `@theme` declarations. Its configuration is intentionally separate from Tailwind's build-time configuration. ([GitHub](https://github.com/dcastil/tailwind-merge/blob/main/docs/configuration.md?utm_source=chatgpt.com))
