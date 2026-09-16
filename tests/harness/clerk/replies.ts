/**
 * The shapes Clerk sends, as `contracts/clerk.json` describes them. Composery reads a
 * few of these fields; the rest are here because Clerk always sends them, and a fake that sends
 * less would let our code depend on a Clerk that does not exist. The values are invented; the
 * shape is not, and every reply is checked against Clerk's own description.
 */

// biome-ignore-start lint/style/useNamingConvention: the Clerk Backend API names these fields

const created = 1_789_000_000_000;

/**
 * What a test says a Clerk account holds. Clerk's own words, because this answers as Clerk.
 *
 * Each member is separate because Clerk keeps them separate. `has_image` says whether the person
 * uploaded a picture; `image_url` is usually present either way, because Clerk generates one. A
 * fake that tied the two together would be inventing a rule Clerk does not have, and a test could
 * then only ever see the pairs that rule allows.
 */
export type ClerkUser = Readonly<{
	id: string;
	username?: string;
	email?: string;
	imageUrl?: string;
	hasImage?: boolean;
}>;

export function toUserReply(user: ClerkUser) {
	const emailId = `idn_${user.id}`;
	return {
		id: user.id,
		object: "user",
		external_id: null,
		primary_email_address_id: user.email === undefined ? null : emailId,
		primary_phone_number_id: null,
		primary_web3_wallet_id: null,
		// Clerk sends null rather than leaving the member out, and its own example shows one.
		username: user.username ?? null,
		first_name: null,
		last_name: null,
		...(user.imageUrl === undefined ? {} : { image_url: user.imageUrl }),
		has_image: user.hasImage ?? false,
		password_enabled: true,
		two_factor_enabled: false,
		totp_enabled: false,
		backup_code_enabled: false,
		email_addresses:
			user.email === undefined
				? []
				: [
						{
							id: emailId,
							object: "email_address",
							email_address: user.email,
							reserved: false,
							verification: null,
							linked_to: [],
							created_at: created,
							updated_at: created,
						},
					],
		phone_numbers: [],
		web3_wallets: [],
		passkeys: [],
		external_accounts: [],
		saml_accounts: [],
		enterprise_accounts: [],
		public_metadata: {},
		private_metadata: {},
		unsafe_metadata: {},
		last_sign_in_at: created,
		banned: false,
		locked: false,
		lockout_expires_in_seconds: null,
		verification_attempts_remaining: 100,
		created_at: created,
		updated_at: created,
		delete_self_enabled: true,
		create_organization_enabled: true,
		last_active_at: created,
		mfa_enabled_at: null,
		mfa_disabled_at: null,
		legal_accepted_at: null,
	};
}

export function toCountReply(count: number) {
	return { object: "total_count", total_count: count };
}

/** The body Clerk signs and sends when something about an account changed. */
export function toUserEvent(
	type: "user.created" | "user.updated" | "user.deleted",
	user: ClerkUser,
) {
	return {
		object: "event",
		type,
		timestamp: created,
		instance_id: "ins_composery_test",
		event_attributes: {
			http_request: { client_ip: "127.0.0.1", user_agent: "composery-test" },
		},
		data:
			type === "user.deleted"
				? { object: "user", id: user.id, deleted: true }
				: toUserReply(user),
	};
}

// biome-ignore-end lint/style/useNamingConvention: the Clerk Backend API names these fields
