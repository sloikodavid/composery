# Biome config parity guidance

Source: https://chatgpt.com/share/6aa68609-d3ec-83ed-b720-07d564926977

---

**User**

Give me the ideal Biome 2.5.13 config for Next.js 16 + React 19
  (React Compiler) + Convex + Tailwind 4 + shadcn, with NO ESLint.
  1. A full biome.json: vcs, files.includes (ignore
  convex/_generated, .next, next-env.d.ts, shadcn ui?), formatter
  (tabs, lineWidth, LF), javascript/json/css settings,
  `css.parser.tailwindDirectives`, assist organizeImports (and
  custom group ordering), linter domains (next, react, test,
  project?) and what each enables.
  2. Parity gap: compare Biome's rules against eslint-config-next
  (core-web-vitals), eslint-plugin-react-hooks v6+ (including the
  React Compiler rules), eslint-plugin-jsx-a11y,
  @convex-dev/eslint-plugin, and typescript-eslint type-aware rules.
  List what is NOT covered and whether it matters (e.g.
  no-floating-promises: does Biome's type-aware `noFloatingPromises`
  exist and work?).
  3. Recommended non-default rules to turn on (nursery included,
  with stability caveats): useSortedClasses for Tailwind,
  noFloatingPromises, noMisusedPromises, useExhaustiveDependencies
  config with React Compiler, noBarrelFile, noNamespaceImport,
  useImportType, noDefaultExport with overrides for Next's required
  default exports, useFilenamingConvention (kebab-case vs snake_case
  with Next's reserved filenames).
  4. `overrides` for app/ route files, convex/ files, tests, and
  shadcn components/ui.
  5. Why `biome check` exits 0 on warnings, and whether
  `--error-on-warnings`, rule levels, or `--diagnostic-level` is the
  canonical fix.
  6. Editor setup: VS Code (.vscode/settings.json and
  extensions.json) with format on save and code actions, and how to
  stop the TS/ESLint extensions from conflicting.
  7. Git hooks: lefthook vs simple-git-hooks vs none, and Biome's
  `--staged` / `--changed` flags.

---

**ChatGPT**

I’ll verify this against the current Biome 2.5.13 schema/docs plus the current Next 16, React Hooks/Compiler, Convex, and shadcn guidance, then I’ll give you a copy-paste config and a parity matrix. The main thing I’ll be careful about is distinguishing rules Biome truly supports from similarly named ESLint rules that still require type-aware or framework-specific analysis.

---

**ChatGPT**

One important update: Biome 2.5.13 **does now have real type-aware linting** for rules such as `noFloatingPromises`; those rules activate Biome’s scanner/type-inference engine. So the old blanket advice that “Biome cannot replace typescript-eslint’s promise rules” is outdated—but parity is still incomplete, especially around React Compiler and Convex-specific semantics.

---

**ChatGPT**

The other big distinction is framework parity: Biome’s **Next domain is useful but not equivalent to `eslint-config-next/core-web-vitals`**. Current Next’s plugin still has rules Biome doesn’t map, while Biome’s new `useReactCompiler` rule actually invokes React Compiler in lint mode and closes much of the React Compiler source-code gap without ESLint.

---

**ChatGPT**

Yes — for a **Next.js 16 + React 19/React Compiler + Convex + Tailwind 4 + shadcn** project, I would use Biome as the sole formatter/linter, plus `tsc --noEmit` for compiler-level type checking. You can get quite close to the useful parts of the ESLint stack, but **not 100% parity**: the meaningful remaining holes are primarily Convex-specific rules, some Next-specific rules, and part of typescript-eslint's larger type-aware rule set.

## 1. Recommended `biome.json`

This is the config I would start with:

```json
{
	"$schema": "https://biomejs.dev/schemas/2.5.13/schema.json",

	"vcs": {
		"enabled": true,
		"clientKind": "git",
		"useIgnoreFile": true,
		"defaultBranch": "main"
	},

	"files": {
		"ignoreUnknown": true,
		"includes": [
			"**",
			"!!**/.next",
			"!!**/out",
			"!!**/dist",
			"!!**/build",
			"!next-env.d.ts",
			"!convex/_generated"
		]
	},

	"formatter": {
		"enabled": true,
		"indentStyle": "tab",
		"lineEnding": "lf",
		"lineWidth": 100
	},

	"javascript": {
		"formatter": {
			"enabled": true,
			"quoteStyle": "double",
			"jsxQuoteStyle": "double",
			"semicolons": "always",
			"trailingCommas": "all",
			"arrowParentheses": "always"
		}
	},

	"json": {
		"formatter": {
			"enabled": true,
			"trailingCommas": "none"
		}
	},

	"css": {
		"parser": {
			"tailwindDirectives": true
		},
		"formatter": {
			"enabled": true
		},
		"linter": {
			"enabled": true
		}
	},

	"linter": {
		"enabled": true,

		"domains": {
			"next": "recommended",
			"react": "recommended",
			"project": "recommended"
		},

		"rules": {
			"preset": "recommended",

			"correctness": {
				"noBeforeInteractiveScriptOutsideDocument": "error",
				"noNextAsyncClientComponent": "error",
				"useExhaustiveDependencies": "error"
			},

			"performance": {
				"noBarrelFile": "error",
				"noNamespaceImport": "warn",
				"noSyncScripts": "error"
			},

			"style": {
				"noDefaultExport": "error",
				"useFilenamingConvention": {
					"level": "error",
					"options": {
						"filenameCases": ["kebab-case"]
					}
				},
				"useImportType": {
					"level": "error",
					"options": {
						"style": "separatedType"
					}
				}
			},

			"nursery": {
				"noComponentHookFactories": "error",
				"noFloatingPromises": "error",
				"noMisusedPromises": "error",

				"useReactCompiler": {
					"level": "error",
					"options": {
						"compilationMode": "infer"
					}
				},

				"useSortedClasses": {
					"level": "info",
					"options": {
						"functions": ["cn", "clsx", "cva"]
					}
				}
			}
		}
	},

	"assist": {
		"enabled": true,
		"actions": {
			"source": {
				"organizeImports": {
					"level": "on",
					"options": {
						"sortBareImports": false,
						"groups": [
							["react", "react/**", "next", "next/**"],
							":BLANK_LINE:",
							[
								":NODE:",
								":PACKAGE_WITH_PROTOCOL:",
								":PACKAGE:",
								"!:STYLE:"
							],
							":BLANK_LINE:",
							[":ALIAS:", "!:STYLE:"],
							":BLANK_LINE:",
							[":PATH:", "!:STYLE:"],
							":BLANK_LINE:",
							":STYLE:"
						]
					}
				}
			}
		}
	},

	"overrides": [
		{
			"includes": [
				"**/*.test.js",
				"**/*.test.jsx",
				"**/*.test.ts",
				"**/*.test.tsx",
				"**/*.spec.js",
				"**/*.spec.jsx",
				"**/*.spec.ts",
				"**/*.spec.tsx",
				"**/__tests__/**",
				"tests/**"
			],
			"linter": {
				"domains": {
					"next": "recommended",
					"react": "recommended",
					"project": "recommended",
					"test": "recommended"
				},
				"rules": {
					"performance": {
						"noBarrelFile": "off"
					},
					"style": {
						"noDefaultExport": "off"
					}
				}
			}
		},

		{
			"includes": [
				"app/**/page.js",
				"app/**/page.jsx",
				"app/**/page.ts",
				"app/**/page.tsx",
				"app/**/layout.js",
				"app/**/layout.jsx",
				"app/**/layout.ts",
				"app/**/layout.tsx",
				"app/**/template.js",
				"app/**/template.jsx",
				"app/**/template.ts",
				"app/**/template.tsx",
				"app/**/loading.js",
				"app/**/loading.jsx",
				"app/**/loading.ts",
				"app/**/loading.tsx",
				"app/**/error.js",
				"app/**/error.jsx",
				"app/**/error.ts",
				"app/**/error.tsx",
				"app/**/global-error.js",
				"app/**/global-error.jsx",
				"app/**/global-error.ts",
				"app/**/global-error.tsx",
				"app/**/not-found.js",
				"app/**/not-found.jsx",
				"app/**/not-found.ts",
				"app/**/not-found.tsx",
				"app/**/default.js",
				"app/**/default.jsx",
				"app/**/default.ts",
				"app/**/default.tsx",
				"app/**/forbidden.js",
				"app/**/forbidden.jsx",
				"app/**/forbidden.ts",
				"app/**/forbidden.tsx",
				"app/**/unauthorized.js",
				"app/**/unauthorized.jsx",
				"app/**/unauthorized.ts",
				"app/**/unauthorized.tsx",
				"app/**/robots.js",
				"app/**/robots.ts",
				"app/**/sitemap.js",
				"app/**/sitemap.ts",
				"app/**/manifest.js",
				"app/**/manifest.ts",
				"app/**/icon.js",
				"app/**/icon.ts",
				"app/**/icon.tsx",
				"app/**/apple-icon.js",
				"app/**/apple-icon.ts",
				"app/**/apple-icon.tsx",
				"app/**/opengraph-image.js",
				"app/**/opengraph-image.ts",
				"app/**/opengraph-image.tsx",
				"app/**/twitter-image.js",
				"app/**/twitter-image.ts",
				"app/**/twitter-image.tsx"
			],
			"linter": {
				"rules": {
					"style": {
						"noDefaultExport": "off"
					}
				}
			}
		},

		{
			"includes": ["convex/**"],
			"linter": {
				"domains": {
					"next": "none",
					"react": "none",
					"project": "recommended"
				},
				"rules": {
					"correctness": {
						"noBeforeInteractiveScriptOutsideDocument": "off",
						"noNextAsyncClientComponent": "off"
					},
					"performance": {
						"noSyncScripts": "off"
					},
					"style": {
						"noDefaultExport": "off"
					},
					"nursery": {
						"noComponentHookFactories": "off",
						"useReactCompiler": "off"
					}
				}
			}
		},

		{
			"includes": ["components/ui/**"],
			"linter": {
				"rules": {
					"performance": {
						"noNamespaceImport": "off"
					}
				}
			}
		},

		{
			"includes": [
				"**/*.config.js",
				"**/*.config.mjs",
				"**/*.config.cjs",
				"**/*.config.ts",
				"proxy.js",
				"proxy.ts",
				"middleware.js",
				"middleware.ts"
			],
			"linter": {
				"rules": {
					"style": {
						"noDefaultExport": "off"
					}
				}
			}
		}
	]
}
```

Two subtleties in that file matter.

First, `.next`, `dist`, `build`, and `out` use Biome's **force-ignore** form, `!!`, because they are build output and should not even be scanned. `convex/_generated` uses an ordinary `!` ignore: Biome recommends ordinary ignores for generated source because its scanner can still extract types/module information when an included file imports it. ([Biome](https://biomejs.dev/reference/configuration/))

Second, I would **not ignore `components/ui`**. shadcn components are deliberately source code you own, rather than an opaque dependency. Format and lint them normally. The one exception I'd make is `noNamespaceImport`, because generated Radix-based shadcn components commonly use namespace-style imports and rewriting all of those adds little value.

Also note that Biome applies **only the first matching override**, so ordering is significant. If your project has, for example, Convex tests under `convex/**/*.test.ts`, you may want a dedicated first override combining the Convex and test settings. ([Biome](https://biomejs.dev/reference/configuration/))

### Why these domains?

`next: "recommended"` enables Biome's stable recommended Next rules: hook correctness plus things such as `useInlineScriptId`, `noImgElement`, `noUnwantedPolyfillio`, `useGoogleFontPreconnect`, and the `next/head` / `next/document` checks. The domain contains some additional non-recommended rules, which is why the config explicitly turns on `noNextAsyncClientComponent`, `noBeforeInteractiveScriptOutsideDocument`, and `noSyncScripts`. ([Biome](https://biomejs.dev/linter/domains/))

`react: "recommended"` supplies React-specific rules including hooks, JSX keys, dangerous HTML, array-index keys, etc. The React Compiler itself is still a nursery rule and therefore is explicitly enabled. ([Biome](https://biomejs.dev/linter/domains/))

`project: "recommended"` activates cross-file/module-graph analysis. Its currently recommended rule is fairly conservative (`noPrivateImports`), but enabling project analysis also gives Biome the scanner infrastructure needed for more sophisticated project analysis. ([Biome](https://biomejs.dev/linter/domains/))

I would **not globally enable `test`**. Put it in the test override so that `describe`, `it`, `expect`, hooks, etc. are recognized only there; its recommended rules include focused-test/export/duplicate-hook checks. ([Biome](https://biomejs.dev/linter/domains/))

Nor would I enable `"tailwind": "all"` or `"types": "all"` just because you're using those technologies. The interesting type rules are enabled individually below, and the Tailwind domain currently contains experimental policy rules that aren't equivalent to “Tailwind support.”

### Import ordering

Biome's import organizer now supports actual custom groups, aliases, path groups, blank lines, styles, type matchers, and source patterns. ([Biome](https://biomejs.dev/assist/actions/organize-imports/javascript/))

My ordering is:

```text
react / next
<blank>
node / external packages
<blank>
@/ aliases
<blank>
relative paths
<blank>
styles
```

I deliberately leave:

```json
"sortBareImports": false
```

because bare imports are potentially side-effectful. I would rather leave:

```ts
import "./globals.css";
import "./polyfills";
```

where the author deliberately put them than have a stylistic sorter change execution/CSS ordering. Biome itself defaults to not sorting bare imports for that reason. ([Biome](https://biomejs.dev/assist/actions/organize-imports/javascript/))

---

## 2. How close is this to the ESLint stack?

Here is the practical parity picture.

| ESLint source | Biome 2.5.13 parity | Important gaps |
|---|---|---|
| `eslint-config-next/core-web-vitals` | **Good but incomplete** | Several `@next/next` rules have no Biome counterpart |
| `eslint-plugin-react-hooks` fundamentals | **Very good** | `rules-of-hooks` and `exhaustive-deps` covered |
| React Compiler ESLint rules | **Good aggregate coverage, not 1:1** | Compiler diagnostics grouped under `useReactCompiler`; config/gating validation differs |
| `eslint-plugin-jsx-a11y` | **Very good** | Not every option/custom-component semantic is identical |
| `@convex-dev/eslint-plugin` | **Poor / effectively none** | Biggest unavoidable gap |
| `typescript-eslint` type-aware rules | **Partial and rapidly improving** | Real type inference exists, but nowhere near the complete strict-type-checked set |

### `eslint-config-next/core-web-vitals`

Biome's Next domain already directly implements several `@next/next` rules, including `no-img-element`, inline script IDs, unwanted polyfills, `next/head`/`document` checks, Google-font handling, async client components, and synchronous scripts. ([Biome](https://biomejs.dev/linter/domains/))

There are still Next ESLint rules without equivalent Biome diagnostics, notably things in the family of:

```text
no-html-link-for-pages
no-css-tags
no-location-assign-relative-destination
no-page-custom-font
no-styled-jsx-in-document
no-title-in-document-head
no-duplicate-head
no-script-component-in-head
no-assign-module-variable
next-script-for-ga
no-typos
```

The one I care most about is **`no-html-link-for-pages`**: using a raw `<a>` for internal navigation rather than Next's `Link` remains a useful framework-specific check. A number of the others target legacy Pages Router / `_document` / `next/head` patterns and are considerably less important in a greenfield App Router application.

Also, Next's Core Web Vitals preset historically elevates both `no-html-link-for-pages` and `no-sync-scripts`; Biome can cover `noSyncScripts`—and the config above explicitly makes it an error—but not the former. ([Biome](https://biomejs.dev/linter/rules/no-sync-scripts/javascript/))

This is worth knowing because Next 16 treats linting as a separate toolchain concern rather than something `next build` should be relied upon to run. Run Biome yourself in CI.

### React Hooks v6+ and the React Compiler

The fundamental pair is covered directly:

```text
react-hooks/rules-of-hooks       → useHookAtTopLevel
react-hooks/exhaustive-deps      → useExhaustiveDependencies
```

`useExhaustiveDependencies` is explicitly sourced from `react-hooks/exhaustive-deps`, is recommended, and knows about React's stable values including `useState`, `useReducer`, `useTransition`, `useRef`, and `useEffectEvent`. It also supports configuration for custom hooks/stable results. ([Biome](https://biomejs.dev/linter/rules/use-exhaustive-dependencies/javascript/))

**Do not disable exhaustive-deps because you use React Compiler.** They address related but distinct correctness issues. Incorrect Effect/memo dependencies remain incorrect React code.

For the newer React Compiler era, React's ESLint plugin exposes individual diagnostics such as `immutability`, `purity`, `refs`, `static-components`, `unsupported-syntax`, `preserve-manual-memoization`, `incompatible-library`, `set-state-in-render`, `set-state-in-effect`, `globals`, etc. ([React](https://react.dev/reference/eslint-plugin-react-hooks))

Biome 2.5.13 doesn't expose a perfect 1:1 switch for every one. Instead:

```json
"useReactCompiler": {
	"level": "error",
	"options": {
		"compilationMode": "infer"
	}
}
```

actually **runs React Compiler in lint mode and reports its actionable compiler diagnostics**. That's substantially better than attempting to recreate compiler semantics with handwritten lint rules. It requires React 19+ and is currently a nursery rule. ([Biome](https://biomejs.dev/linter/rules/use-react-compiler/javascript/))

Biome also has a dedicated nursery `noComponentHookFactories`, corresponding to the compiler-era `component-hook-factories` rule.

What you lose versus `eslint-plugin-react-hooks` is mostly **granularity and configuration checking**. In ESLint you can independently enable/severity-control `purity`, `refs`, `immutability`, etc. Biome groups actual compiler diagnostics behind `useReactCompiler`. Rules specifically concerned with validating compiler **configuration** or **gating configuration** don't have the same direct Biome equivalent.

For an actual React Compiler-enabled Next app, I consider that acceptable.

### `eslint-plugin-jsx-a11y`

Biome's accessibility coverage is strong. Its source mapping includes equivalents/inspired implementations for `alt-text`, `anchor-is-valid`, `anchor-has-content`, ARIA properties/types/roles, `click-events-have-key-events`, autocomplete, labels, headings, iframe titles, HTML language, media captions, and many more. ([Biome](https://biomejs.dev/linter/html/sources/))

The gap is more about **configuration richness**, especially custom component/polymorphic mappings, than about missing the core accessibility checks. Biome itself cautions that mapped rules do not necessarily expose all options of their ESLint originals. ([Biome](https://biomejs.dev/linter/html/sources/))

For Next + shadcn, I would happily use Biome's accessibility set without running `jsx-a11y` separately.

### `@convex-dev/eslint-plugin`: the real gap

There is **no equivalent Convex domain/plugin in Biome**.

The current Convex plugin's recommended set contains:

| Convex rule | Biome replacement? | How much I care |
|---|---:|---|
| `require-argument-validators` | No | **High** |
| `explicit-table-ids` | No | **High** |
| `no-filter-in-query` | No | **High once data grows** |
| `no-schema-import-cycle` | No direct Convex equivalent | **High** |
| `no-top-of-hour-crons` | No | Medium |
| `no-old-registered-function-syntax` | No | Low after migration |
| `import-wrong-runtime` | No | High if using Node runtime modules |
| `no-collect-in-query` | No | Medium/high for scalability |

Those are the plugin's current rules. ([Convex](https://docs.convex.dev/eslint))

So if **NO ESLint is absolute**, accept this as a conscious gap rather than trying to claim full parity.

For Convex I would compensate with strict code-review conventions, Convex's type checks/runtime validation, and their migration/codemod tooling where applicable. `explicit-table-ids`, argument validators, `.withIndex()` instead of indiscriminate `.filter()`, avoiding unbounded `.collect()`, and Node/runtime boundaries are worth putting in your team's coding standards.

I would **not keep ESLint installed solely for Convex** unless this is a large Convex codebase where those checks materially reduce incidents. That would undermine the simplicity you're trying to get from an all-Biome setup.

### typescript-eslint: `noFloatingPromises` really exists now

Yes. This has materially changed in Biome 2.x.

Biome's `noFloatingPromises` is:

```text
lint/nursery/noFloatingPromises
types domain
Same as @typescript-eslint/no-floating-promises
```

and enabling it activates Biome's project scanner and **type inference engine**. It can determine Promise-valued calls through inferred types; it isn't just looking for functions literally declared `async` in the same file. ([Biome](https://biomejs.dev/linter/rules/no-floating-promises/javascript/))

The same is true of:

```text
noMisusedPromises
```

which is explicitly sourced from `@typescript-eslint/no-misused-promises` and activates type inference. ([Biome](https://biomejs.dev/linter/rules/no-misused-promises/javascript/))

So:

> “Biome can't do type-aware linting”

is now stale advice.

What is still true is:

> “Biome does not yet reproduce all of typescript-eslint's `strictTypeChecked` ecosystem.”

Among the notable remaining gaps are much of typescript-eslint's broader `no-unsafe-*` family, such as unsafe assignment/call/member access/argument/return policies, plus assorted more specialized semantic rules. Biome has growing type-aware coverage such as unnecessary conditions, awaitable checks, nullish-coalescing analysis, regexp analysis, unsafe `+` operands, and promise rules, but it is still a smaller set. ([Biome](https://biomejs.dev/blog/biome-v2-4/))

You should therefore still run:

```bash
tsc --noEmit
```

But `tsc` is **not** a substitute for `noFloatingPromises`: TypeScript deliberately permits you to discard a Promise in many contexts.

---

## 3. Rules I would deliberately add/change

### `noFloatingPromises: error`

Absolutely yes for this stack.

```json
"noFloatingPromises": "error"
```

It catches one of the highest-value classes of TypeScript async bugs. It is nursery because Biome's type-inference implementation is still evolving, not because the underlying policy is dubious. ([Biome](https://biomejs.dev/linter/rules/no-floating-promises/javascript/))

### `noMisusedPromises: error`

Also yes:

```json
"noMisusedPromises": "error"
```

It catches promises supplied where a synchronous value/callback is expected. The implementation is also nursery/type-aware. ([Biome](https://biomejs.dev/linter/rules/no-misused-promises/javascript/))

I would promote both to error in a new project and tolerate the occasional suppression if the type inference hits an edge case.

### `useReactCompiler: error`

For a project that has deliberately adopted React Compiler:

```json
"useReactCompiler": {
	"level": "error",
	"options": {
		"compilationMode": "infer"
	}
}
```

`infer` is the right default: it checks functions following component/hook conventions rather than applying React semantics indiscriminately to utility functions. ([Biome](https://biomejs.dev/linter/rules/use-react-compiler/javascript/))

On an existing migration with hundreds of diagnostics, start it as `warn`; for a new codebase, I would make it `error`.

### `useExhaustiveDependencies: error`

Keep it.

There's no special “React Compiler off” setting you should use. The compiler makes good dependency information **more**, not less, relevant. Biome's implementation is already React-19-aware, including `useEffectEvent`. ([Biome](https://biomejs.dev/linter/rules/use-exhaustive-dependencies/javascript/))

I would leave its optional:

```json
"reportMissingDependenciesArray": false
```

at the default. `useEffect(fn)` is semantically valid and forcing `[]` everywhere would change meaning.

Only configure `hooks` if you actually own a custom dependency-array hook.

### `useSortedClasses`: yes, but `info`

I would turn it on, but **not make it CI-blocking yet**:

```json
"useSortedClasses": {
	"level": "info",
	"options": {
		"functions": ["cn", "clsx", "cva"]
	}
}
```

Biome's rule is nursery, its fix is marked unsafe, and the implementation is still partial. In particular its Tailwind handling doesn't yet fully replicate Tailwind's own configuration/variant behavior; the docs explicitly call out limitations around responsive variant sorting and custom utilities/variants. ([Biome](https://biomejs.dev/linter/rules/use-sorted-classes/javascript/))

That matters more with **Tailwind 4**, where CSS-defined customization is increasingly important.

So my policy would be:

```text
Biome formats everything automatically.
Sorted Tailwind classes are advisory.
Apply the unsafe class-sort fix intentionally when desired.
```

Once the rule graduates and understands your Tailwind 4 setup well enough, promote it to `warn` or `error`.

### `noBarrelFile: error`

I like this for a Next application:

```json
"noBarrelFile": "error"
```

It pushes code toward direct imports and avoids accidental mega-module graphs. Biome classifies it as a performance rule and deliberately excludes type-only barrel behavior in cases where runtime bundling isn't implicated. ([Biome](https://next.biomejs.dev/linter/rules/no-barrel-file/javascript/))

If your project deliberately exposes package public APIs through `index.ts`, override those package-entry files instead of globally dropping the rule.

### `noNamespaceImport: warn`

Useful but less categorical:

```json
"noNamespaceImport": "warn"
```

Biome's rationale is tree-shaking efficiency. ([Biome](https://biomejs.dev/linter/rules/no-namespace-import/javascript/))

Modern bundlers can often tree-shake namespace imports just fine, and libraries like Radix use patterns where namespace imports are perfectly reasonable. That's why I disable it for `components/ui`.

### `useImportType: error`

Interestingly, this is **already a recommended Biome rule**. The non-default part of my recommendation is raising its severity and choosing:

```json
"style": "separatedType"
```

so:

```ts
import type { User } from "./types";
```

wins over:

```ts
import { type User } from "./types";
```

Biome recommends pairing enforced type-only imports with TypeScript's `verbatimModuleSyntax`, and also documents the VS Code `typescript.preferences.preferTypeOnlyAutoImports` setting. ([Biome](https://biomejs.dev/linter/rules/use-import-type/javascript/))

I'd therefore put this in `tsconfig.json` if your existing TS configuration doesn't already inherit it:

```json
{
	"compilerOptions": {
		"verbatimModuleSyntax": true
	}
}
```

### `noDefaultExport: error` with framework overrides

I like named exports as the normal application policy because refactoring/import discovery is better, and Biome has a direct non-recommended `noDefaultExport` rule. ([Biome](https://biomejs.dev/linter/rules/no-default-export/javascript/))

But don't fight Next over its file conventions. `page.tsx`, `layout.tsx`, error/loading/default boundaries, metadata generators, configs, and similar framework entry points should be exempt.

`route.ts` is deliberately **not** exempt in my config because App Router handlers normally expose named `GET`, `POST`, etc.

Convex gets an exemption mainly for `schema.ts` and framework entry-point conventions.

### `useFilenamingConvention`: choose kebab-case

For this ecosystem I prefer:

```json
"filenameCases": ["kebab-case"]
```

over `snake_case`.

It naturally matches Next's reserved names:

```text
page.tsx
layout.tsx
global-error.tsx
not-found.tsx
opengraph-image.tsx
instrumentation-client.ts
```

Biome treats a filename like `foo.test.ts` as name `foo` plus extensions `.test.ts`; lowercase extensions remain permitted. ([Biome](https://biomejs.dev/linter/rules/use-filenaming-convention/javascript/))

Dynamic route syntax such as:

```text
[slug]/
[...slug]/
(group)/
@modal/
```

is a **directory naming convention**, so the JS/TS filename rule doesn't cause trouble there.

I see no reason to permit both kebab and snake case in a new Next/shadcn project. Pick one; kebab case matches the ecosystem better.

---

## 4. Overrides: why those four

### Next route files

The `noDefaultExport` exception is the primary one. Don't globally weaken React or accessibility linting just because a file is a framework entry point.

### `convex/**`

I turn off the `next` and `react` domains there because Convex server modules shouldn't be subjected to frontend framework assumptions simply because `react` and `next` are dependencies in the root package.

The **type-aware promise rules remain active**, which is desirable for Convex async functions.

I also disable React Compiler-specific checks and default-export policy there.

One caveat: because Biome uses first-match override semantics, if you keep tests under `convex/`, decide whether you want the test override or Convex override to take priority. For a sufficiently large codebase I'd add a dedicated `convex/**/*.test.ts` override combining both.

### Tests

Enable:

```json
"test": "recommended"
```

only in tests.

I relax `noDefaultExport` and `noBarrelFile` there because fixture/test organization shouldn't be forced into production module-performance conventions.

### `components/ui`

Do **not** ignore shadcn.

Only:

```json
"noNamespaceImport": "off"
```

is in my baseline exception. Everything valuable—React Compiler checks, hooks, accessibility, formatting, TypeScript safety—should still apply.

If you strongly prefer generated shadcn source to stay byte-for-byte close to upstream, you could additionally disable `useSortedClasses` there. I normally wouldn't; shadcn's philosophy is that the component source becomes your code.

---

## 5. Why `biome check` succeeds with warnings

Biome severity has actual CLI semantics.

A warning is intentionally **non-fatal by default**. So:

```text
0 errors
5 warnings
```

means `biome check` can exit `0`.

Biome provides:

```bash
--error-on-warnings
```

specifically to turn warnings into a non-zero process result. ([Biome](https://biomejs.dev/reference/cli/))

The distinctions are:

| Mechanism | What it does |
|---|---|
| Rule `"error"` | This particular violation is intrinsically CI-failing |
| Rule `"warn"` | Show it but normally don't fail |
| Rule `"info"` | Advisory |
| `--error-on-warnings` | CI policy: any emitted warning makes the command fail |
| `--diagnostic-level=error` | **Display filter only**; does not promote warnings to errors |

So **do not use `--diagnostic-level=error` to make CI stricter**. That actually hides warning/info diagnostics from output. ([Biome](https://biomejs.dev/reference/cli/))

I recommend:

```json
{
	"scripts": {
		"lint": "biome check .",
		"lint:fix": "biome check --write .",
		"lint:ci": "biome ci --error-on-warnings .",
		"typecheck": "tsc --noEmit"
	}
}
```

That gives you two layers:

```text
Rule severity = how strongly you believe in that rule.
--error-on-warnings = whether CI tolerates warnings.
```

This is why I deliberately made experimental Tailwind sorting `info`: even strict CI with `--error-on-warnings` won't fail on it.

For stable rules where you genuinely never want a violation, prefer `"error"` instead of relying solely on `--error-on-warnings`.

---

## 6. VS Code setup

`.vscode/settings.json`:

```json
{
	"editor.formatOnSave": true,

	"editor.codeActionsOnSave": {
		"source.fixAll.biome": "explicit",
		"source.organizeImports.biome": "explicit"
	},

	"[javascript]": {
		"editor.defaultFormatter": "biomejs.biome"
	},
	"[javascriptreact]": {
		"editor.defaultFormatter": "biomejs.biome"
	},
	"[typescript]": {
		"editor.defaultFormatter": "biomejs.biome"
	},
	"[typescriptreact]": {
		"editor.defaultFormatter": "biomejs.biome"
	},
	"[json]": {
		"editor.defaultFormatter": "biomejs.biome"
	},
	"[jsonc]": {
		"editor.defaultFormatter": "biomejs.biome"
	},
	"[css]": {
		"editor.defaultFormatter": "biomejs.biome"
	},

	"javascript.format.enable": false,
	"typescript.format.enable": false,

	"typescript.preferences.preferTypeOnlyAutoImports": true,

	"eslint.enable": false
}
```

Biome officially exposes both `source.fixAll.biome` and `source.organizeImports.biome`; fix-all-on-save applies **safe fixes only**, which is exactly what you want. `useSortedClasses`, for example, won't silently rewrite classes because its current fix is unsafe. ([Biome](https://biomejs.dev/reference/vscode/))

`.vscode/extensions.json`:

```json
{
	"recommendations": [
		"biomejs.biome"
	],
	"unwantedRecommendations": [
		"dbaeumer.vscode-eslint"
	]
}
```

The important distinction with TypeScript is: **do not disable the TypeScript language service**.

You still want VS Code's built-in TS/JS language features for:

```text
type errors
IntelliSense
Go to Definition
rename/refactoring
automatic imports
```

You only want to disable its **formatter** and avoid its generic organize-imports code action competing with Biome.

If nobody on your team has the ESLint extension installed, `"eslint.enable": false` is unnecessary. I still like checking it into an explicitly ESLint-free project because people commonly have the extension globally installed.

---

## 7. Git hooks: Lefthook vs simple-git-hooks vs none

My preference order for this project is:

**Lefthook** if this is a real team/product repo; **no hook** if you want minimum machinery; `simple-git-hooks` if you want the absolute smallest Node-only middle ground.

Biome itself already solves the hard part:

```bash
biome check --staged
```

checks exactly the files in the Git index and is explicitly intended for local pre-commit use. ([Biome](https://biomejs.dev/guides/integrate-in-vcs/))

So you do **not** need `lint-staged`.

### Lefthook

I would use a check-only precommit:

```yaml
pre-commit:
  commands:
    biome:
      run: pnpm biome check --staged --error-on-warnings
```

I prefer **not** auto-fixing in a precommit hook. Fix-on-save already handles safe fixes, and automatically modifying/restaging a partially staged file can unexpectedly add changes the developer intentionally left unstaged.

If you specifically want auto-fix:

```yaml
pre-commit:
  commands:
    biome:
      run: pnpm biome check --write --staged
      stage_fixed: true
```

but understand the partial-staging tradeoff.

### simple-git-hooks

If that's your only hook:

```json
{
	"simple-git-hooks": {
		"pre-commit": "pnpm biome check --staged --error-on-warnings"
	}
}
```

It's perfectly adequate. Lefthook becomes more attractive once you're running parallel format/type/test commands or have a larger monorepo.

### `--changed` is different

Don't interchange these:

```bash
biome check --staged
```

means **what is currently staged in the Git index**.

```bash
biome ci --changed
```

means **committed changes compared with `vcs.defaultBranch` / `--since`**. Staged and unstaged modifications aren't included. Biome explicitly intends `--changed` primarily for CI. ([Biome](https://biomejs.dev/reference/cli/))

There is another important caveat: changed-file linting cannot necessarily catch a problem in an unchanged downstream file whose imported type/API was altered by a changed file. Biome explicitly documents this. ([Biome](https://biomejs.dev/guides/integrate-in-vcs/))

For a normal-sized app, my CI command is therefore simply:

```bash
pnpm biome ci --error-on-warnings .
pnpm tsc --noEmit
```

Full-project Biome is fast enough that I'd choose correctness over clever incremental linting.

For a genuinely huge monorepo you can move to:

```bash
pnpm biome ci --changed --since=origin/main --error-on-warnings
```

while retaining periodic/full checks.

---

## Bottom line

The stack I would actually ship is:

```text
Biome 2.5.13
├─ formatter
├─ recommended rules
├─ next: recommended
├─ react: recommended
├─ project: recommended
├─ test domain only in test files
├─ React Compiler lint mode
├─ noFloatingPromises
├─ noMisusedPromises
├─ exhaustive dependencies
├─ strict named/type imports
├─ kebab-case files
└─ advisory Tailwind class sorting

TypeScript
└─ tsc --noEmit

ESLint
└─ not installed
```

The two caveats I'd write into the project's tooling README are: **Biome's Next coverage is not literal `core-web-vitals` parity**, chiefly because `no-html-link-for-pages` and several other framework rules remain absent; and **Biome has no replacement for `@convex-dev/eslint-plugin`**. Everything else has reached the point where an all-Biome setup is quite defensible, especially now that `noFloatingPromises`/`noMisusedPromises` have genuine type inference and `useReactCompiler` invokes the compiler itself. ([Biome](https://next.biomejs.dev/linter/rules/no-floating-promises/javascript/))
