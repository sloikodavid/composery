import { source } from "@/lib/source";
import { llms } from "fumadocs-core/source";

export const revalidate = false;

// Generated from the docs source so the AI-readable index can't drift from the
// actual pages. Replaces the old hand-written public/llms.txt.
export function GET() {
	return new Response(llms(source).index());
}
