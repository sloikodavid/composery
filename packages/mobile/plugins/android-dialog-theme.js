// An in-page <select> (the IDE's dropdowns on touch - see touch.diff)
// surfaces as a framework AlertDialog themed by the hosting activity, which
// prebuild leaves at stock defaults: teal-green controls, or whatever the
// wallpaper dictates. Pin the control accent to the shared control colour so the dialog
// reads Composery like the auth pages; the app theme's DayNight parent swaps
// the dialog surfaces for dark mode on its own. Prebuild-only by nature: Expo Go
// runs under Expo's own activity theme and keeps the stock look - the built app
// is the surface that counts.
const {
	AndroidConfig,
	withAndroidColors,
	withAndroidColorsNight,
	withAndroidStyles
} = require("expo/config-plugins");

// Pinned to BRAND_THEME.{light,dark}.control by android-dialog-theme.test.ts:
// this file runs under plain node require at prebuild, where the TS `shared`
// package is out of reach.
const ACCENT = { light: "#323229", dark: "#c1b5a9" };

// composery- prefix because Android merges every library's resources into one
// namespace, and an app color named like a library's silently overrides it.
const COLOR_NAME = "composeryAccent";

function androidDialogTheme(config) {
	config = withAndroidStyles(config, (config) => {
		// Both spellings on purpose: framework widgets (the WebView's dialog) read
		// android:colorAccent, and AppCompat parents bridge their own colorAccent
		// onto it - setting both keeps the pin alive if the template's theme parent
		// ever stops being AppCompat-based.
		for (const name of ["colorAccent", "android:colorAccent"]) {
			config.modResults = AndroidConfig.Styles.assignStylesValue(
				config.modResults,
				{
					add: true,
					parent: AndroidConfig.Styles.getAppThemeGroup(),
					name,
					value: `@color/${COLOR_NAME}`
				}
			);
		}
		return config;
	});
	config = withAndroidColors(config, (config) => {
		config.modResults = AndroidConfig.Colors.assignColorValue(
			config.modResults,
			{ name: COLOR_NAME, value: ACCENT.light }
		);
		return config;
	});
	config = withAndroidColorsNight(config, (config) => {
		config.modResults = AndroidConfig.Colors.assignColorValue(
			config.modResults,
			{ name: COLOR_NAME, value: ACCENT.dark }
		);
		return config;
	});
	return config;
}

androidDialogTheme.ACCENT = ACCENT;
androidDialogTheme.COLOR_NAME = COLOR_NAME;
module.exports = androidDialogTheme;
