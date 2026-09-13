import { type CSSProperties, createContext, use } from "react";
import type { SpecimenFont } from "./fonts";
import type { SpecimenSettings } from "./specimen-settings";

export type PairingStyles = {
	/** Logo, buttons, and facts. */
	display: CSSProperties;
	/** Small labels, badges, and status. */
	label: CSSProperties;
	heading: CSSProperties;
	body: CSSProperties;
	strong: CSSProperties;
	displayFont: SpecimenFont;
	textFont: SpecimenFont;
	headingFont: SpecimenFont;
	logoSettings: SpecimenSettings;
};

export const PairingContext = createContext<PairingStyles | null>(null);

export function usePairing() {
	const pairing = use(PairingContext);
	if (!pairing) {
		throw new Error("usePairing must be used inside PairingContext.");
	}
	return pairing;
}
