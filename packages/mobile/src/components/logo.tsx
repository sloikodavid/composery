import { Text, View } from "react-native";
import { SvgXml } from "react-native-svg";

import { heading } from "@/lib/fonts";
import { BRAND_COLORS, ICON_XML, LOGO_TEXT } from "@/lib/brand";

export function LogoIcon({
	color = BRAND_COLORS.surface.ink,
	size = 28
}: {
	color?: string;
	size?: number;
}) {
	return (
		<SvgXml
			xml={ICON_XML.replace(/currentColor/g, color)}
			width={size}
			height={size}
		/>
	);
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
			<LogoIcon color={color} size={height * 1.12} />
			<Text style={[heading("semibold"), { fontSize: height * 0.82, color }]}>
				{LOGO_TEXT}
			</Text>
		</View>
	);
}
