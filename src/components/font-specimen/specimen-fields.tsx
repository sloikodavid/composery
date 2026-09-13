import type { ReactNode } from "react";
import { tones } from "./specimen-tones";

export function Field({
	label,
	children,
}: {
	label: string;
	children: ReactNode;
}) {
	return (
		// biome-ignore lint/a11y/noLabelWithoutControl: Every caller passes the control as children.
		<label className={`flex flex-col gap-1 text-xs ${tones.muted}`}>
			{label}
			{children}
		</label>
	);
}

export function RangeField({
	label,
	value,
	display,
	min,
	max,
	step,
	onChange,
}: {
	label: string;
	value: number;
	display: string;
	min: number;
	max: number;
	step: number;
	onChange: (value: number) => void;
}) {
	return (
		<Field label={label}>
			<span className="flex items-center gap-2">
				<input
					type="range"
					min={min}
					max={max}
					step={step}
					value={value}
					onChange={(event) => onChange(Number(event.target.value))}
					className="w-28"
				/>
				<span className={`w-20 tabular-nums ${tones.text}`}>{display}</span>
			</span>
		</Field>
	);
}

export function SelectField<Value extends string>({
	label,
	value,
	options,
	onChange,
}: {
	label: string;
	value: Value;
	options: readonly { value: Value; label: string }[];
	onChange: (value: Value) => void;
}) {
	return (
		<Field label={label}>
			<select
				value={value}
				onChange={(event) => {
					const option = options.find(
						(candidate) => candidate.value === event.target.value,
					);
					if (option) {
						onChange(option.value);
					}
				}}
				className={`border px-2 py-1 ${tones.strongBorder} ${tones.surface} ${tones.text}`}
			>
				{options.map((option) => (
					<option key={option.value} value={option.value}>
						{option.label}
					</option>
				))}
			</select>
		</Field>
	);
}

export function CheckboxField({
	label,
	text,
	checked,
	onChange,
}: {
	label: string;
	text: string;
	checked: boolean;
	onChange: (checked: boolean) => void;
}) {
	return (
		<Field label={label}>
			<span className={`flex h-7 items-center gap-2 ${tones.text}`}>
				<input
					type="checkbox"
					checked={checked}
					onChange={(event) => onChange(event.target.checked)}
				/>
				{text}
			</span>
		</Field>
	);
}
