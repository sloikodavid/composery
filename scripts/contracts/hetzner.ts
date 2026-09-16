import path from "node:path";
import { hetznerSelection } from "../../contracts/hetzner/selection";
import { writePinnedContract } from "./derive";

await writePinnedContract(
	hetznerSelection,
	path.join(import.meta.dir, "../../contracts/hetzner"),
);
