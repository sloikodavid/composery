/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as allocations_addresses from "../allocations/addresses.js";
import type * as allocations_hetzner_cloud_api from "../allocations/hetzner_cloud/api.js";
import type * as allocations_hetzner_cloud_inventory from "../allocations/hetzner_cloud/inventory.js";
import type * as allocations_hetzner_cloud_observation from "../allocations/hetzner_cloud/observation.js";
import type * as allocations_hetzner_cloud_worker from "../allocations/hetzner_cloud/worker.js";
import type * as allocations_hetzner_cloud_worker_state from "../allocations/hetzner_cloud/worker_state.js";
import type * as allocations_operations from "../allocations/operations.js";
import type * as allocations_retries from "../allocations/retries.js";
import type * as clerk from "../clerk.js";
import type * as clerk_http from "../clerk_http.js";
import type * as crons from "../crons.js";
import type * as errors from "../errors.js";
import type * as fake_address from "../fake_address.js";
import type * as http from "../http.js";
import type * as http_status from "../http_status.js";
import type * as loopback from "../loopback.js";
import type * as pagination from "../pagination.js";
import type * as quotas from "../quotas.js";
import type * as rate_limits from "../rate_limits.js";
import type * as servers_lifecycle from "../servers/lifecycle.js";
import type * as servers_memberships from "../servers/memberships.js";
import type * as servers_names from "../servers/names.js";
import type * as servers_ownership from "../servers/ownership.js";
import type * as servers_permissions from "../servers/permissions.js";
import type * as servers_reserved_names from "../servers/reserved_names.js";
import type * as servers_summary from "../servers/summary.js";
import type * as ssh_access from "../ssh/access.js";
import type * as ssh_access_state from "../ssh/access_state.js";
import type * as ssh_authorized_keys from "../ssh/authorized_keys.js";
import type * as ssh_bootstrap from "../ssh/bootstrap.js";
import type * as ssh_bootstrap_http from "../ssh/bootstrap_http.js";
import type * as ssh_bootstrap_state from "../ssh/bootstrap_state.js";
import type * as ssh_cloud_init from "../ssh/cloud_init.js";
import type * as ssh_connection from "../ssh/connection.js";
import type * as ssh_discovery from "../ssh/discovery.js";
import type * as ssh_encryption_keys from "../ssh/encryption_keys.js";
import type * as ssh_errors from "../ssh/errors.js";
import type * as ssh_failures from "../ssh/failures.js";
import type * as ssh_hostname from "../ssh/hostname.js";
import type * as ssh_key_acceptance from "../ssh/key_acceptance.js";
import type * as ssh_key_pair from "../ssh/key_pair.js";
import type * as ssh_keys from "../ssh/keys.js";
import type * as ssh_permissions from "../ssh/permissions.js";
import type * as ssh_read_file from "../ssh/read_file.js";
import type * as ssh_scripts_bootstrap from "../ssh/scripts/bootstrap.js";
import type * as ssh_scripts_discovery from "../ssh/scripts/discovery.js";
import type * as ssh_scripts_hostname from "../ssh/scripts/hostname.js";
import type * as ssh_scripts_report_host_key from "../ssh/scripts/report_host_key.js";
import type * as ssh_scripts_write_file from "../ssh/scripts/write_file.js";
import type * as ssh_secrets from "../ssh/secrets.js";
import type * as ssh_secrets_state from "../ssh/secrets_state.js";
import type * as ssh_write_file from "../ssh/write_file.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";
import { anyApi, componentsGeneric } from "convex/server";

const fullApi: ApiFromModules<{
  "allocations/addresses": typeof allocations_addresses;
  "allocations/hetzner_cloud/api": typeof allocations_hetzner_cloud_api;
  "allocations/hetzner_cloud/inventory": typeof allocations_hetzner_cloud_inventory;
  "allocations/hetzner_cloud/observation": typeof allocations_hetzner_cloud_observation;
  "allocations/hetzner_cloud/worker": typeof allocations_hetzner_cloud_worker;
  "allocations/hetzner_cloud/worker_state": typeof allocations_hetzner_cloud_worker_state;
  "allocations/operations": typeof allocations_operations;
  "allocations/retries": typeof allocations_retries;
  clerk: typeof clerk;
  clerk_http: typeof clerk_http;
  crons: typeof crons;
  errors: typeof errors;
  fake_address: typeof fake_address;
  http: typeof http;
  http_status: typeof http_status;
  loopback: typeof loopback;
  pagination: typeof pagination;
  quotas: typeof quotas;
  rate_limits: typeof rate_limits;
  "servers/lifecycle": typeof servers_lifecycle;
  "servers/memberships": typeof servers_memberships;
  "servers/names": typeof servers_names;
  "servers/ownership": typeof servers_ownership;
  "servers/permissions": typeof servers_permissions;
  "servers/reserved_names": typeof servers_reserved_names;
  "servers/summary": typeof servers_summary;
  "ssh/access": typeof ssh_access;
  "ssh/access_state": typeof ssh_access_state;
  "ssh/authorized_keys": typeof ssh_authorized_keys;
  "ssh/bootstrap": typeof ssh_bootstrap;
  "ssh/bootstrap_http": typeof ssh_bootstrap_http;
  "ssh/bootstrap_state": typeof ssh_bootstrap_state;
  "ssh/cloud_init": typeof ssh_cloud_init;
  "ssh/connection": typeof ssh_connection;
  "ssh/discovery": typeof ssh_discovery;
  "ssh/encryption_keys": typeof ssh_encryption_keys;
  "ssh/errors": typeof ssh_errors;
  "ssh/failures": typeof ssh_failures;
  "ssh/hostname": typeof ssh_hostname;
  "ssh/key_acceptance": typeof ssh_key_acceptance;
  "ssh/key_pair": typeof ssh_key_pair;
  "ssh/keys": typeof ssh_keys;
  "ssh/permissions": typeof ssh_permissions;
  "ssh/read_file": typeof ssh_read_file;
  "ssh/scripts/bootstrap": typeof ssh_scripts_bootstrap;
  "ssh/scripts/discovery": typeof ssh_scripts_discovery;
  "ssh/scripts/hostname": typeof ssh_scripts_hostname;
  "ssh/scripts/report_host_key": typeof ssh_scripts_report_host_key;
  "ssh/scripts/write_file": typeof ssh_scripts_write_file;
  "ssh/secrets": typeof ssh_secrets;
  "ssh/secrets_state": typeof ssh_secrets_state;
  "ssh/write_file": typeof ssh_write_file;
  users: typeof users;
}> = anyApi as any;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
> = anyApi as any;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
> = anyApi as any;

export const components = componentsGeneric() as unknown as {
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
  hetznerCloudWork: import("@convex-dev/workpool/_generated/component.js").ComponentApi<"hetznerCloudWork">;
  hetznerCloudCleanup: import("@convex-dev/workpool/_generated/component.js").ComponentApi<"hetznerCloudCleanup">;
};
