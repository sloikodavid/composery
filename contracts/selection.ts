/**
 * What a system publishes about itself, and which of it we depend on. A pinned contract is
 * derived from this by a deterministic filter, so a reviewer sees a subset that was selected by
 * a rule, never a document somebody cut by hand.
 */

export type SelectedDocument = Readonly<{
	/** Where the published description is fetched from. */
	source: string;
	/**
	 * The member that holds the operations. OpenAPI puts them in `paths`; a system may publish
	 * its events elsewhere, as Clerk does in `x-webhooks`.
	 */
	holder: string;
	/** Every operation we depend on, by the path and method the description names. */
	operations: Record<string, readonly string[]>;
}>;

export type Selection = Readonly<{
	/** The system's name, as it appears in a problem: `Hetzner`, `Clerk`. */
	system: string;
	documents: readonly SelectedDocument[];
}>;
