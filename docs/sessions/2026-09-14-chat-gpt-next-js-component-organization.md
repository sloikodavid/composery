# Next.js Component Organization

Source: https://chatgpt.com/share/6aa740e7-e99c-83eb-b521-a437fe438ea0

---

## Turn 1: User

_2026-09-14T00:33:14.737Z_

What do the official Next.js 16 App Router docs recommend for organizing
     shared components (colocation, private folders, src/components grouping)? When is a folder with
     a single file considered premature?

---

## Turn 2: ChatGPT

_2026-09-14T00:33:15.829Z_

I’ll ground this in the current official Next.js 16 App Router docs, then separate what they explicitly recommend from the “single-file folder” judgment, which is more of an architectural heuristic.

---

## Turn 3: ChatGPT

_2026-09-14T00:33:21.845Z_

The **official Next.js 16 App Router docs do not prescribe one canonical component structure**. They explicitly say Next.js is “unopinionated” about project organization and recommend choosing a strategy that works for your team and applying it consistently. ([Next.js](https://nextjs.org/docs/app/getting-started/project-structure))

The docs effectively support three patterns:

| Pattern | Example | Best fit |
|---|---|---|
| **Colocate with routes/features** | `app/dashboard/_components/Table.tsx` | Component belongs primarily to one route/feature |
| **Shared folder inside `app`** | `app/components/Button.tsx` | App-wide/shared UI while keeping application code under `app` |
| **Shared folder outside `app`** | `src/components/Button.tsx` | Keep `app` focused on routing and application modules elsewhere |

The docs explicitly show both “project files outside of `app`” and “top-level folders inside `app`” as legitimate strategies, plus a hybrid where global code lives centrally while route-specific code is colocated. They also stress that `components`, `lib`, `ui`, `hooks`, etc. are just naming conventions with **no special framework meaning**. ([Next.js](https://nextjs.org/docs/app/getting-started/project-structure))

### Colocation is first-class in App Router

An important App Router detail is that putting a normal component next to a route does **not** make it routable:

```text
app/
  dashboard/
    page.tsx
    Chart.tsx
    filters.ts
```

Only a `page.tsx` or `route.ts` exposes a route. So `Chart.tsx` and `filters.ts` are safe to colocate. That's specifically why the docs say project files can safely live inside route segments. ([Next.js](https://nextjs.org/docs/app/getting-started/project-structure))

That makes a good default:

```text
src/
  app/
    dashboard/
      page.tsx
      _components/
        Chart.tsx
```

or even, for something tiny:

```text
src/
  app/
    dashboard/
      page.tsx
      Chart.tsx
```

### `_components` means “implementation detail,” not “shared components”

Private folders such as:

```text
app/dashboard/_components/
app/dashboard/_lib/
```

are explicitly excluded from routing. But Next.js says they're **not required for colocation**, because ordinary colocated files are already safe. Their advantages are organizational: clearly separating UI from routing, grouping internals, improving editor organization, and avoiding potential future naming conflicts with Next.js conventions. ([Next.js](https://nextjs.org/docs/app/getting-started/project-structure))

So I'd interpret them semantically:

```text
app/dashboard/_components/
```

means roughly:

> “These components belong to the dashboard implementation.”

It doesn't mean:

> “This is where every React component must go.”

### `src/components` is perfectly valid, but isn't *the* Next.js recommendation

`src` itself is an optional Next.js convention. Its purpose is simply to separate application source code from root-level configuration. ([Next.js](https://nextjs.org/docs/app/getting-started/project-structure))

Therefore this is entirely idiomatic:

```text
src/
  app/
  components/
  lib/
```

But so is:

```text
src/
  app/
    _components/
    _lib/
```

And so is a hybrid:

```text
src/
  components/          # genuinely global/shared
    Button.tsx
    Modal.tsx

  app/
    dashboard/
      _components/     # dashboard-specific
        RevenueChart.tsx

    settings/
      _components/     # settings-specific
        ProfileForm.tsx
```

The last version is closest to the docs' **“split project files by feature or route”** example: globally shared code centrally, specific code close to the routes using it. ([Next.js](https://nextjs.org/docs/app/getting-started/project-structure))

### When is a one-file folder premature?

This part is **not a Next.js rule**; the docs don't say “never make a folder containing one file.”

A useful rule is: **a directory should represent a meaningful boundary, not merely duplicate a filename.**

This:

```text
components/
  Logo/
    Logo.tsx
```

is usually premature if that's literally all the folder does. Compare:

```text
components/
  Logo.tsx
```

You gained another navigation level without gaining organization.

The folder starts earning its existence when there are related artifacts:

```text
components/
  DataTable/
    DataTable.tsx
    DataTableHeader.tsx
    DataTableRow.tsx
    useDataTable.ts
    types.ts
    DataTable.test.tsx
```

Or when the folder itself represents a feature/private boundary:

```text
app/
  checkout/
    _components/
      PaymentForm.tsx
```

Even though `_components` might initially contain only `PaymentForm.tsx`, the folder communicates something useful: **private checkout UI lives here**, separately from routing files.

So my practical Next.js 16 rule would be:

> **Colocate first. Promote when reuse appears. Create directories when they represent a real grouping or boundary.**

For example, start with:

```text
app/orders/OrderSummary.tsx
```

If it grows:

```text
app/orders/_components/
  OrderSummary.tsx
  OrderRow.tsx
  OrderStatus.tsx
```

If `OrderSummary` later becomes genuinely cross-feature:

```text
src/components/
  OrderSummary.tsx
```

That avoids prematurely dumping everything into a giant global `components/` directory while also avoiding Java-style `Component/Component.tsx` nesting for every leaf component.

The official Project Structure page, updated July 21, 2026, is the key reference here. [Next.js 16 — Project structure and organization](https://nextjs.org/docs/app/getting-started/project-structure?utm_source=chatgpt.com)
