// The Composery lockup: the font-free SVG icon (kept in sync with the web Icon
// and the overlay favicon) + a live Bricolage Grotesque wordmark, so the
// wordmark follows the text color and needs no vector transcription.
import { Text, View } from "react-native";
import { SvgXml } from "react-native-svg";

import { heading } from "@/lib/fonts";

// viewBox cropped to the ink (the mark has a ~23px margin in its 256 box) so it
// fills the rendered size; the amber gradient reads on light and dark as-is.
const ICON_XML = `<svg viewBox="16 16 224 224" fill="none" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient gradientUnits="userSpaceOnUse" id="icon-1" x1="128" x2="128" y1="23" y2="233"><stop stop-color="#F6C886"/><stop offset="1" stop-color="#9A5320"/></linearGradient><linearGradient gradientUnits="userSpaceOnUse" id="icon-2" x1="128" x2="128" y1="59" y2="197"><stop stop-color="#ECAE60"/><stop offset="1" stop-color="#8F4C1C"/></linearGradient><linearGradient gradientUnits="userSpaceOnUse" id="icon-3" x1="128" x2="128" y1="90" y2="160"><stop stop-color="#C97E3B"/><stop offset="1" stop-color="#6E3711"/></linearGradient></defs><path d="M200.5 71.4A92 92 0 1 0 200.5 184.6" stroke="url(#icon-1)" stroke-linecap="round" stroke-width="26"/><path d="M154.3 76.3A58 58 0 1 0 184.5 141" stroke="url(#icon-2)" stroke-linecap="round" stroke-width="22"/><path d="M130.4 101.1A27 27 0 1 0 154.1 121" stroke="url(#icon-3)" stroke-linecap="round" stroke-width="17"/></svg>`;

export function LogoMark({ size = 28 }: { size?: number }) {
	return <SvgXml xml={ICON_XML} width={size} height={size} />;
}

export function Logo({
	height = 28,
	color
}: {
	height?: number;
	color: string;
}) {
	return (
		<View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
			<LogoMark size={height * 1.12} />
			<Text
				style={[
					heading("semibold"),
					{ fontSize: height * 0.82, color, letterSpacing: -0.4 }
				]}
			>
				Composery
			</Text>
		</View>
	);
}
