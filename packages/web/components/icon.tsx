export const ICON_SVG = `<defs><linearGradient gradientUnits="userSpaceOnUse" id="icon-1" x1="128" x2="128" y1="23" y2="233"><stop stop-color="#F6C886"/><stop offset="1" stop-color="#9A5320"/></linearGradient><linearGradient gradientUnits="userSpaceOnUse" id="icon-2" x1="128" x2="128" y1="59" y2="197"><stop stop-color="#ECAE60"/><stop offset="1" stop-color="#8F4C1C"/></linearGradient><linearGradient gradientUnits="userSpaceOnUse" id="icon-3" x1="128" x2="128" y1="90" y2="160"><stop stop-color="#C97E3B"/><stop offset="1" stop-color="#6E3711"/></linearGradient></defs><path d="M200.5 71.4A92 92 0 1 0 200.5 184.6" stroke="url(#icon-1)" stroke-linecap="round" stroke-width="26"/><path d="M154.3 76.3A58 58 0 1 0 184.5 141" stroke="url(#icon-2)" stroke-linecap="round" stroke-width="22"/><path d="M130.4 101.1A27 27 0 1 0 154.1 121" stroke="url(#icon-3)" stroke-linecap="round" stroke-width="17"/>`;

export function Icon({ className }: { className?: string }) {
	return (
		<svg
			className={className}
			dangerouslySetInnerHTML={{ __html: ICON_SVG }}
			fill="none"
			viewBox="0 0 256 256"
			xmlns="http://www.w3.org/2000/svg"
		/>
	);
}
