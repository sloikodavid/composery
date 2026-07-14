import { ChevronDownIcon } from "lucide-react";

const FAQ: { question: string; answer: string }[] = [
	{
		question: "Is the paid version different from what I can self-host?",
		answer:
			"The editor is the same open-source product that you'd run yourself, but we just do all the complicated Dev-ops stuff to host it, so you don't have to worry about buying a domain, setting up DNS, securing your server, and so on."
	},
	{
		question: "Can I use the mobile app with a self-hosted Composery?",
		answer:
			"Yes. The app connects to any Composery, whether it's a Cloud box or your own server - just add the URL in the app and it will just work."
	},
	{
		question: "What if I break something?",
		answer:
			"You're free to experiment. Take a snapshot before a big change and roll back to it in one click, or reset the box to a clean slate whenever you want. You get a cap of 5 automatic and 5 manual snapshots per box."
	},
	{
		question: "How much control do I get over the machine?",
		answer:
			"Full control. It's a Debian system with passwordless sudo and systemd, so you can apt install packages, edit any file, and run services and cron jobs - and it all survives restarts. It runs as a container, so a custom kernel or kernel modules are the one thing you can't do."
	},
	{
		question: "Can I run a dev server and open it in the browser?",
		answer:
			"Yes. Anything you run on a port shows up in the Ports panel and opens at your box URL under /proxy/3000/ - signed in as you, not open to the world. Direct ports aren't reachable from the internet: the box only accepts HTTPS on its own domain."
	},
	{
		question: "What does it take to self-host?",
		answer:
			"Not much - a machine that runs Docker and a volume to keep your data on. The repo ships ready-made setups for Fly, Render, Railway, Kubernetes, and any VPS, with even more platforms documented."
	}
];

export function Faq() {
	return (
		<section className="space-y-4">
			<h2 className="font-heading text-2xl font-medium tracking-tight text-foreground">
				Common questions
			</h2>
			<div className="divide-y divide-border border-t border-border">
				{FAQ.map(({ question, answer }) => (
					<details className="group" key={question}>
						<summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-sm font-medium text-foreground select-none [&::-webkit-details-marker]:hidden">
							{question}
							<ChevronDownIcon className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180" />
						</summary>
						<p className="pb-4 text-sm leading-7 text-muted-foreground">
							{answer}
						</p>
					</details>
				))}
			</div>
		</section>
	);
}
