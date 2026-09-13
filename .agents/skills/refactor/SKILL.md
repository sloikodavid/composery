---
name: refactor
description: Use when making non-trivial changes.
---

# Refactor

Improve the system's ability to change without replacing simple code with architecture ceremony. Treat these as decision lenses, not patterns that must appear.

## Start with the pressure

Name the concrete pressure before proposing structure: duplicated policy, knowledge spread across callers, an interface callers routinely misuse, coupled changes, unclear state ownership, a hard external boundary, or a domain concept the code cannot express.

Separate evidence from taste and speculative future needs. If no present pressure exists, keep the direct implementation.

## Modules, depth, and locality

A module is any implementation behind an interface: a function, file, component, package, or service. Its interface includes every fact a caller must know, not only its TypeScript signature: invariants, ordering, errors, configuration, and performance behavior.

- Prefer **deep modules**: substantial useful behavior behind a small interface.
- Reject pass-through layers whose interface is almost as complex as what they wrap.
- Apply the deletion test: if removing an abstraction scatters a concept or invariant across callers, it was useful; if removal only deletes indirection, it was shallow.
- Optimize for locality. A policy change, bug fix, and its verification should concentrate in the owner rather than require coordinated edits throughout the repository.
- Hide decisions that callers should not need to make. Do not make configuration a substitute for choosing a good default.

## Ownership and cohesion

- Put state with the code that can uphold its invariant.
- Keep acquire/use/release together when they form one resource lifecycle.
- Keep policy with the operation it governs, not in callers that happen to invoke it.
- Split responsibilities when they change for different reasons or need different dependencies. Do not split by arbitrary file size or one-export-per-file habits.
- Make illegal states unrepresentable when the domain has a stable distinction. Do not build elaborate type machinery for a concept that is still uncertain.
- Use the domain's precise language. If two things have different rules or lifecycles, do not hide both behind one vague noun.

## Seams and dependencies

A seam is a place where behavior can vary without editing the caller. Seam placement is an architectural decision; dependency injection is only one mechanism.

- Add a seam for real variation, ownership, or an external boundary-not because a pattern expects one.
- One production implementation plus a test fake does not by itself prove a public abstraction. Prefer a truthful lightweight runtime when available.
- Keep internal seams private. Tests do not earn access to production internals.
- At a true external boundary, expose the smallest operation-specific interface the domain needs. Do not leak a vendor SDK or create a generic `fetch` wrapper that every caller must reinterpret.
- Dependency direction should point toward stable domain policy. Infrastructure adapts to the domain; domain concepts should not be shaped around transport or storage details.
- Prefer functional cores and imperative shells when computation can be separated naturally from I/O. Do not force this split when the behavior is inherently stateful or the wrapper would be shallow.

## Abstraction timing

- Similar syntax is not necessarily duplicated knowledge. Share a stable concept or policy, not merely matching lines.
- Wait for evidence of variation before designing extension points.
- The third example may reveal an abstraction, but it is not a command to create one.
- Prefer a small amount of obvious duplication over a premature abstraction that couples unrelated cases.
- When an abstraction is justified, migrate callers to it and remove the superseded path. Do not layer the new shape over the old one indefinitely.
- Preserve compatibility only when a real consumer requires it. Make the compatibility constraint and removal condition explicit.

## Tests and TDD

Tests are feedback about behavior, not an authority over production design. Repository testing rules take precedence over this section.

- Test through the narrowest truthful public boundary that observes the risk. Assert outcomes and state, not collaborator calls or private structure.
- A test that changes during an internal refactor without a behavior change is probably coupled to the implementation.
- Use red-green-refactor when behavior is clear enough to specify and feedback is fast and truthful. First confirm that the red failure occurs for the intended reason.
- Work in vertical slices: one behavior through its real boundary, then enough implementation to make it work. Avoid writing a horizontal inventory of imagined tests before learning from the implementation.
- TDD is a poor fit for exploratory spikes, generated wiring, visual styling, type-only constraints, and behavior whose truthful runtime is too heavy for each cycle. Use a proportionate verification loop instead.
- Do not add a production seam solely to make mocking convenient. Do not preserve redundant lower-level tests after a stronger boundary test makes them obsolete.
- A refactor may need no new tests when existing behavior checks already protect the changed boundary.

## Change strategy

- Make the smallest coherent change, not the smallest textual diff. Half-migrations and parallel architectures usually cost more than one complete local move.
- Preserve behavior separately from changing behavior when that separation makes review and diagnosis clearer.
- Keep unrelated cleanup out unless it is required to complete the structural change correctly.
- Prefer reversible decisions while the domain is uncertain. Record durable rationale only for decisions that are costly to reverse, surprising without context, and made between credible alternatives.
- Verify at the boundary affected by the change. Do not manufacture tests for mechanical moves or inflate the verification surface.

## Evaluate a proposed shape

Ask:

1. What concrete pressure does this solve now?
2. Who owns the state, policy, and lifecycle afterward?
3. What must each caller know, and did that knowledge shrink?
4. Where is the seam, and what real variation justifies it?
5. Does a likely change become local, or move complexity elsewhere?
6. What can be deleted because of this design?
7. What is the strongest simpler alternative?

Recommend one shape clearly. Mention an alternative only when it changes a real tradeoff or would become better under a specific condition.
