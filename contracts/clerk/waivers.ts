import type { Waiver } from "../waiver";

/**
 * Where Clerk and Clerk's description of itself disagree. Empty is the honest state until a run
 * shows otherwise: a waiver is a claim about the running system, and it is only written with the
 * evidence that proves it.
 */
export const clerkWaivers: readonly Waiver[] = [];
