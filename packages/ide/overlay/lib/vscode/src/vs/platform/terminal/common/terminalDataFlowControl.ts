/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Arbitrates the pty's single acknowledgement counter between every consumer
 * receiving the same terminal data. Only one consumer drives the counter at a
 * time; acknowledgements from the others are retained so a replacement can
 * take over without acknowledging the same bytes twice.
 */
export class TerminalDataFlowControl {
	private readonly _consumers = new Map<string, number>();
	private _leader: string | undefined;
	private _produced = 0;
	private _acknowledged = 0;
	private readonly _acknowledge: (charCount: number) => void;

	// Written out rather than declared as a constructor parameter property: this
	// file is the one piece of the overlay a root test imports directly, and the
	// root tsconfig sets `erasableSyntaxOnly`, which that shorthand violates.
	constructor(acknowledge: (charCount: number) => void) {
		this._acknowledge = acknowledge;
	}

	acceptData(charCount: number): void {
		if (!Number.isSafeInteger(charCount) || charCount < 0) {
			throw new Error(`Invalid terminal data length: ${charCount}`);
		}
		this._produced += charCount;
		if (this._leader === undefined) {
			// Nobody is attached to acknowledge this, and the pty pauses above its
			// high watermark until something does - a terminal whose last reader
			// disconnected would stall mid-command instead of running on. Nothing
			// is lost: the serializer still records the output for replay.
			this._advance();
		}
	}

	register(consumerId: string): void {
		if (this._consumers.has(consumerId)) {
			return;
		}
		this._consumers.set(consumerId, this._produced);
		this._leader ??= consumerId;
	}

	unregister(consumerId: string): void {
		if (!this._consumers.delete(consumerId) || this._leader !== consumerId) {
			return;
		}
		this._leader = this._consumers.keys().next().value;
		this._advance();
	}

	acknowledge(consumerId: string, charCount: number): void {
		if (!Number.isSafeInteger(charCount) || charCount < 0) {
			throw new Error(`Invalid terminal acknowledgement: ${charCount}`);
		}
		let previous = this._consumers.get(consumerId);
		if (previous === undefined) {
			// Existing VS Code clients have no registration RPC: their first
			// acknowledgement is also their registration. Unlike an explicit
			// attachment, it covers data already delivered, so begin at the
			// native counter rather than at the current tail.
			previous = this._acknowledged;
			this._consumers.set(consumerId, previous);
			this._leader ??= consumerId;
		}
		this._consumers.set(consumerId, Math.min(previous + charCount, this._produced));
		if (consumerId === this._leader) {
			this._advance();
		}
	}

	/**
	 * Replay clears the pty's native counter. Every registered consumer receives
	 * that replay broadcast, so live flow control resumes at the current tail.
	 */
	resetAfterReplay(): void {
		this._acknowledged = this._produced;
		for (const consumerId of this._consumers.keys()) {
			this._consumers.set(consumerId, this._produced);
		}
	}

	private _advance(): void {
		// With no leader there is no consumer that could ever acknowledge, so
		// everything produced counts as acknowledged.
		const next = this._leader === undefined ? this._produced : this._consumers.get(this._leader)!;
		const delta = next - this._acknowledged;
		if (delta <= 0) {
			return;
		}
		this._acknowledged = next;
		this._acknowledge(delta);
	}
}
