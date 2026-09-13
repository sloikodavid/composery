import type { SpecimenFont } from "./fonts";
import { sampleParagraph, shortParagraph } from "./sample-text";
import { resolveWeight } from "./specimen-settings";
import { tones } from "./specimen-tones";

export function ReadingView({ fonts }: { fonts: readonly SpecimenFont[] }) {
	return (
		<div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,26rem),1fr))] gap-4">
			{fonts.map((font) => (
				<article
					key={font.name}
					className={`flex flex-col gap-4 border p-5 ${tones.border} ${tones.surface}`}
				>
					<header>
						<h2 className={`font-medium text-sm ${tones.text}`}>{font.name}</h2>
						<p className={`text-xs ${tones.faint}`}>{font.category}</p>
					</header>
					<div
						className="flex flex-col gap-3"
						style={{
							fontFamily: font.fontFamily,
							fontWeight: resolveWeight(font, 400),
						}}
					>
						<p
							className={`text-xl leading-snug ${tones.text}`}
							style={{ fontWeight: resolveWeight(font, 600) }}
						>
							Build on a server that stays yours.
						</p>
						<p className={`text-base leading-relaxed ${tones.muted}`}>
							{sampleParagraph}
						</p>
						<p className={`text-sm leading-relaxed ${tones.muted}`}>
							{shortParagraph}
						</p>
						<p className={`text-xs tabular-nums ${tones.faint}`}>
							Updated 12:04 · 2 vCPU · 4 GB · 38.2 of 40 GB used
						</p>
					</div>
				</article>
			))}
		</div>
	);
}
