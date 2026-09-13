import {
	Archivo,
	Bricolage_Grotesque,
	Chakra_Petch,
	Familjen_Grotesk,
	Fragment_Mono,
	Fraunces,
	Funnel_Display,
	Geist,
	Geist_Mono,
	Geologica,
	Hanken_Grotesk,
	Host_Grotesk,
	IBM_Plex_Mono,
	Instrument_Sans,
	Instrument_Serif,
	Inter_Tight,
	JetBrains_Mono,
	Manrope,
	Martian_Mono,
	Mona_Sans,
	Newsreader,
	Onest,
	Oxanium,
	Schibsted_Grotesk,
	Science_Gothic,
	Sora,
	Space_Grotesk,
	Space_Mono,
	Special_Gothic,
	Syne,
	Tomorrow,
	Unbounded,
} from "next/font/google";

// The specimen shows every font on one page, so no font is preloaded.

const geist = Geist({
	subsets: ["latin"],
	style: ["normal", "italic"],
	preload: false,
});
const interTight = Inter_Tight({
	subsets: ["latin"],
	style: ["normal", "italic"],
	preload: false,
});
const hankenGrotesk = Hanken_Grotesk({
	subsets: ["latin"],
	style: ["normal", "italic"],
	preload: false,
});
const schibstedGrotesk = Schibsted_Grotesk({
	subsets: ["latin"],
	style: ["normal", "italic"],
	preload: false,
});
const hostGrotesk = Host_Grotesk({
	subsets: ["latin"],
	style: ["normal", "italic"],
	preload: false,
});
const instrumentSans = Instrument_Sans({
	subsets: ["latin"],
	style: ["normal", "italic"],
	axes: ["wdth"],
	preload: false,
});
const monaSans = Mona_Sans({
	subsets: ["latin"],
	style: ["normal", "italic"],
	axes: ["wdth"],
	preload: false,
});
const spaceGrotesk = Space_Grotesk({ subsets: ["latin"], preload: false });
const bricolageGrotesque = Bricolage_Grotesque({
	subsets: ["latin"],
	axes: ["wdth"],
	preload: false,
});
const familjenGrotesk = Familjen_Grotesk({
	subsets: ["latin"],
	style: ["normal", "italic"],
	preload: false,
});
const specialGothic = Special_Gothic({
	subsets: ["latin"],
	axes: ["wdth"],
	preload: false,
});
const archivo = Archivo({
	subsets: ["latin"],
	style: ["normal", "italic"],
	axes: ["wdth"],
	preload: false,
});
const manrope = Manrope({ subsets: ["latin"], preload: false });
const sora = Sora({ subsets: ["latin"], preload: false });
const onest = Onest({ subsets: ["latin"], preload: false });
const funnelDisplay = Funnel_Display({ subsets: ["latin"], preload: false });
const unbounded = Unbounded({ subsets: ["latin"], preload: false });
const syne = Syne({ subsets: ["latin"], preload: false });
const chakraPetch = Chakra_Petch({
	subsets: ["latin"],
	weight: ["300", "400", "500", "600", "700"],
	style: ["normal", "italic"],
	preload: false,
});
const oxanium = Oxanium({ subsets: ["latin"], preload: false });
const tomorrow = Tomorrow({
	subsets: ["latin"],
	weight: ["100", "200", "300", "400", "500", "600", "700", "800", "900"],
	style: ["normal", "italic"],
	preload: false,
});
const geologica = Geologica({
	subsets: ["latin"],
	axes: ["SHRP"],
	preload: false,
});
const scienceGothic = Science_Gothic({
	subsets: ["latin"],
	axes: ["wdth"],
	preload: false,
});
const geistMono = Geist_Mono({
	subsets: ["latin"],
	style: ["normal", "italic"],
	preload: false,
});
const jetBrainsMono = JetBrains_Mono({
	subsets: ["latin"],
	style: ["normal", "italic"],
	preload: false,
});
const ibmPlexMono = IBM_Plex_Mono({
	subsets: ["latin"],
	weight: ["100", "200", "300", "400", "500", "600", "700"],
	style: ["normal", "italic"],
	preload: false,
});
const martianMono = Martian_Mono({
	subsets: ["latin"],
	axes: ["wdth"],
	preload: false,
});
const fragmentMono = Fragment_Mono({
	subsets: ["latin"],
	weight: "400",
	style: ["normal", "italic"],
	preload: false,
});
const spaceMono = Space_Mono({
	subsets: ["latin"],
	weight: ["400", "700"],
	style: ["normal", "italic"],
	preload: false,
});
const instrumentSerif = Instrument_Serif({
	subsets: ["latin"],
	weight: "400",
	style: ["normal", "italic"],
	preload: false,
});
const newsreader = Newsreader({
	subsets: ["latin"],
	style: ["normal", "italic"],
	preload: false,
});
const fraunces = Fraunces({
	subsets: ["latin"],
	style: ["normal", "italic"],
	axes: ["SOFT"],
	preload: false,
});

export const fontCategories = [
	"Neutral grotesque",
	"Expressive grotesque",
	"Geometric",
	"Technical",
	"Monospace",
	"Serif",
] as const;

export type FontCategory = (typeof fontCategories)[number];

export type SpecimenAxis = {
	tag: string;
	name: string;
	min: number;
	max: number;
	defaultValue: number;
};

export type SpecimenFont = {
	name: string;
	category: FontCategory;
	fontFamily: string;
	/** The named weights. A variable font accepts every value between the first and the last. */
	weights: readonly number[];
	variable: boolean;
	italic: boolean;
	axes: readonly SpecimenAxis[];
	note: string;
};

function range(min: number, max: number) {
	const weights: number[] = [];
	for (let weight = min; weight <= max; weight += 100) {
		weights.push(weight);
	}
	return weights;
}

const width = (min: number, max: number): SpecimenAxis => ({
	tag: "wdth",
	name: "Width",
	min,
	max,
	defaultValue: 100,
});

export const specimenFonts: readonly SpecimenFont[] = [
	{
		name: "Geist",
		category: "Neutral grotesque",
		fontFamily: geist.style.fontFamily,
		weights: range(100, 900),
		variable: true,
		italic: true,
		axes: [],
		note: "Narrow and precise, with a Swiss structure.",
	},
	{
		name: "Inter Tight",
		category: "Neutral grotesque",
		fontFamily: interTight.style.fontFamily,
		weights: range(100, 900),
		variable: true,
		italic: true,
		axes: [],
		note: "Inter with tighter spacing for large text.",
	},
	{
		name: "Hanken Grotesk",
		category: "Neutral grotesque",
		fontFamily: hankenGrotesk.style.fontFamily,
		weights: range(100, 900),
		variable: true,
		italic: true,
		axes: [],
		note: "Open and calm, with a slightly geometric feel.",
	},
	{
		name: "Schibsted Grotesk",
		category: "Neutral grotesque",
		fontFamily: schibstedGrotesk.style.fontFamily,
		weights: range(400, 900),
		variable: true,
		italic: true,
		axes: [],
		note: "Compact and firm, with sharp terminals.",
	},
	{
		name: "Host Grotesk",
		category: "Neutral grotesque",
		fontFamily: hostGrotesk.style.fontFamily,
		weights: range(300, 800),
		variable: true,
		italic: true,
		axes: [],
		note: "Clean and slightly wide.",
	},
	{
		name: "Instrument Sans",
		category: "Neutral grotesque",
		fontFamily: instrumentSans.style.fontFamily,
		weights: range(400, 700),
		variable: true,
		italic: true,
		axes: [width(75, 100)],
		note: "Balanced, with a condensed width option.",
	},
	{
		name: "Mona Sans",
		category: "Neutral grotesque",
		fontFamily: monaSans.style.fontFamily,
		weights: range(200, 900),
		variable: true,
		italic: true,
		axes: [width(75, 125)],
		note: "Strong and industrial, from condensed to expanded.",
	},
	{
		name: "Space Grotesk",
		category: "Expressive grotesque",
		fontFamily: spaceGrotesk.style.fontFamily,
		weights: range(300, 700),
		variable: true,
		italic: false,
		axes: [],
		note: "Grotesque shapes with monospace details.",
	},
	{
		name: "Bricolage Grotesque",
		category: "Expressive grotesque",
		fontFamily: bricolageGrotesque.style.fontFamily,
		weights: range(200, 800),
		variable: true,
		italic: false,
		axes: [width(75, 100)],
		note: "Ink traps and a lot of character at large sizes.",
	},
	{
		name: "Familjen Grotesk",
		category: "Expressive grotesque",
		fontFamily: familjenGrotesk.style.fontFamily,
		weights: range(400, 700),
		variable: true,
		italic: true,
		axes: [],
		note: "Condensed, with unusual angled cuts.",
	},
	{
		name: "Special Gothic",
		category: "Expressive grotesque",
		fontFamily: specialGothic.style.fontFamily,
		weights: range(400, 700),
		variable: true,
		italic: false,
		axes: [width(75, 125)],
		note: "Gothic poster shapes, from condensed to expanded.",
	},
	{
		name: "Archivo",
		category: "Expressive grotesque",
		fontFamily: archivo.style.fontFamily,
		weights: range(100, 900),
		variable: true,
		italic: true,
		axes: [width(62, 125)],
		note: "Very wide width range, from condensed to extended.",
	},
	{
		name: "Manrope",
		category: "Geometric",
		fontFamily: manrope.style.fontFamily,
		weights: range(200, 800),
		variable: true,
		italic: false,
		axes: [],
		note: "Geometric and modern, with open counters.",
	},
	{
		name: "Sora",
		category: "Geometric",
		fontFamily: sora.style.fontFamily,
		weights: range(100, 800),
		variable: true,
		italic: false,
		axes: [],
		note: "Wide and round, made for screens.",
	},
	{
		name: "Onest",
		category: "Geometric",
		fontFamily: onest.style.fontFamily,
		weights: range(100, 900),
		variable: true,
		italic: false,
		axes: [],
		note: "Simple geometric shapes with good legibility.",
	},
	{
		name: "Funnel Display",
		category: "Geometric",
		fontFamily: funnelDisplay.style.fontFamily,
		weights: range(300, 800),
		variable: true,
		italic: false,
		axes: [],
		note: "Geometric, with unusual cuts in some letters.",
	},
	{
		name: "Unbounded",
		category: "Geometric",
		fontFamily: unbounded.style.fontFamily,
		weights: range(200, 900),
		variable: true,
		italic: false,
		axes: [],
		note: "Very wide display shapes.",
	},
	{
		name: "Syne",
		category: "Geometric",
		fontFamily: syne.style.fontFamily,
		weights: range(400, 800),
		variable: true,
		italic: false,
		axes: [],
		note: "Becomes much wider as the weight increases.",
	},
	{
		name: "Chakra Petch",
		category: "Technical",
		fontFamily: chakraPetch.style.fontFamily,
		weights: range(300, 700),
		variable: false,
		italic: true,
		axes: [],
		note: "Square shapes with cut corners.",
	},
	{
		name: "Oxanium",
		category: "Technical",
		fontFamily: oxanium.style.fontFamily,
		weights: range(200, 800),
		variable: true,
		italic: false,
		axes: [],
		note: "Angular shapes from digital displays.",
	},
	{
		name: "Tomorrow",
		category: "Technical",
		fontFamily: tomorrow.style.fontFamily,
		weights: range(100, 900),
		variable: false,
		italic: true,
		axes: [],
		note: "Square grotesque with a technical feel.",
	},
	{
		name: "Geologica",
		category: "Technical",
		fontFamily: geologica.style.fontFamily,
		weights: range(100, 900),
		variable: true,
		italic: false,
		axes: [
			{
				tag: "SHRP",
				name: "Sharpness",
				min: 0,
				max: 100,
				defaultValue: 0,
			},
		],
		note: "Has a sharpness axis that cuts the curves into corners.",
	},
	{
		name: "Science Gothic",
		category: "Technical",
		fontFamily: scienceGothic.style.fontFamily,
		weights: range(100, 900),
		variable: true,
		italic: false,
		axes: [width(50, 200)],
		note: "Engineering gothic, from very condensed to very wide.",
	},
	{
		name: "Geist Mono",
		category: "Monospace",
		fontFamily: geistMono.style.fontFamily,
		weights: range(100, 900),
		variable: true,
		italic: true,
		axes: [],
		note: "The monospace partner of Geist.",
	},
	{
		name: "JetBrains Mono",
		category: "Monospace",
		fontFamily: jetBrainsMono.style.fontFamily,
		weights: range(100, 800),
		variable: true,
		italic: true,
		axes: [],
		note: "Tall lowercase letters, made for code.",
	},
	{
		name: "IBM Plex Mono",
		category: "Monospace",
		fontFamily: ibmPlexMono.style.fontFamily,
		weights: range(100, 700),
		variable: false,
		italic: true,
		axes: [],
		note: "Engineered, with a human feel in the italics.",
	},
	{
		name: "Martian Mono",
		category: "Monospace",
		fontFamily: martianMono.style.fontFamily,
		weights: range(100, 800),
		variable: true,
		italic: false,
		axes: [width(75, 112.5)],
		note: "Wide and technical, with a width axis.",
	},
	{
		name: "Fragment Mono",
		category: "Monospace",
		fontFamily: fragmentMono.style.fontFamily,
		weights: [400],
		variable: false,
		italic: true,
		axes: [],
		note: "A grotesque in monospace. One weight only.",
	},
	{
		name: "Space Mono",
		category: "Monospace",
		fontFamily: spaceMono.style.fontFamily,
		weights: [400, 700],
		variable: false,
		italic: true,
		axes: [],
		note: "Retro geometric monospace. Two weights only.",
	},
	{
		name: "Instrument Serif",
		category: "Serif",
		fontFamily: instrumentSerif.style.fontFamily,
		weights: [400],
		variable: false,
		italic: true,
		axes: [],
		note: "Condensed display serif. One weight only.",
	},
	{
		name: "Newsreader",
		category: "Serif",
		fontFamily: newsreader.style.fontFamily,
		weights: range(200, 800),
		variable: true,
		italic: true,
		axes: [],
		note: "Editorial serif, made for reading on screens.",
	},
	{
		name: "Fraunces",
		category: "Serif",
		fontFamily: fraunces.style.fontFamily,
		weights: range(100, 900),
		variable: true,
		italic: true,
		axes: [
			{
				tag: "SOFT",
				name: "Softness",
				min: 0,
				max: 100,
				defaultValue: 0,
			},
		],
		note: "Old-style display serif with a softness axis.",
	},
];
