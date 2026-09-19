// biome-ignore-start lint/style/useNamingConvention: external field names

/** Fixture values are invented; field presence and nullability follow Clerk's contract. */

const created = 1_789_000_000_000;

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
							verification: {
								object: "verification_otp",
								status: "verified",
								strategy: "email_code",
								attempts: 1,
								expire_at: null,
							},
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

// biome-ignore-end lint/style/useNamingConvention: external field names
