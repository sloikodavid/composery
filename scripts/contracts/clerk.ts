import path from "node:path";
import { clerkSelection } from "../../contracts/clerk/selection";
import { writePinnedContract } from "./derive";

await writePinnedContract(
	clerkSelection,
	path.join(import.meta.dir, "../../contracts/clerk"),
);
