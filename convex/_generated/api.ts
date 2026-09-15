/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as allocations_hetzner_cloud_api from "../allocations/hetzner_cloud/api.js";
import type * as allocations_hetzner_cloud_inventory from "../allocations/hetzner_cloud/inventory.js";
import type * as allocations_hetzner_cloud_worker from "../allocations/hetzner_cloud/worker.js";
import type * as allocations_hetzner_cloud_worker_state from "../allocations/hetzner_cloud/worker_state.js";
import type * as allocations_operations from "../allocations/operations.js";
import type * as clerk from "../clerk.js";
import type * as crons from "../crons.js";
import type * as errors from "../errors.js";
import type * as http from "../http.js";
import type * as http_status from "../http_status.js";
import type * as pagination from "../pagination.js";
import type * as quotas from "../quotas.js";
import type * as rate_limits from "../rate_limits.js";
import type * as servers_lifecycle from "../servers/lifecycle.js";
import type * as servers_memberships from "../servers/memberships.js";
import type * as servers_names from "../servers/names.js";
import type * as servers_ownership from "../servers/ownership.js";
import type * as servers_permissions from "../servers/permissions.js";
import type * as servers_reserved_names from "../servers/reserved_names.js";
import type * as ssh_access from "../ssh/access.js";
import type * as ssh_access_http from "../ssh/access_http.js";
import type * as ssh_access_state from "../ssh/access_state.js";
import type * as ssh_authorized_keys from "../ssh/authorized_keys.js";
import type * as ssh_bootstrap_command from "../ssh/bootstrap_command.js";
import type * as ssh_cloud_init from "../ssh/cloud_init.js";
import type * as ssh_connection from "../ssh/connection.js";
import type * as ssh_inspect_public_key from "../ssh/inspect_public_key.js";
import type * as ssh_read_file from "../ssh/read_file.js";
import type * as ssh_remove_authorized_keys from "../ssh/remove_authorized_keys.js";
import type * as ssh_report_host_key_script from "../ssh/report_host_key_script.js";
import type * as ssh_write_file from "../ssh/write_file.js";
import type * as ssh_write_file_script from "../ssh/write_file_script.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";
import { anyApi, componentsGeneric } from "convex/server";

const fullApi: ApiFromModules<{
  "allocations/hetzner_cloud/api": typeof allocations_hetzner_cloud_api;
  "allocations/hetzner_cloud/inventory": typeof allocations_hetzner_cloud_inventory;
  "allocations/hetzner_cloud/worker": typeof allocations_hetzner_cloud_worker;
  "allocations/hetzner_cloud/worker_state": typeof allocations_hetzner_cloud_worker_state;
  "allocations/operations": typeof allocations_operations;
  clerk: typeof clerk;
  crons: typeof crons;
  errors: typeof errors;
  http: typeof http;
  http_status: typeof http_status;
  pagination: typeof pagination;
  quotas: typeof quotas;
  rate_limits: typeof rate_limits;
  "servers/lifecycle": typeof servers_lifecycle;
  "servers/memberships": typeof servers_memberships;
  "servers/names": typeof servers_names;
  "servers/ownership": typeof servers_ownership;
  "servers/permissions": typeof servers_permissions;
  "servers/reserved_names": typeof servers_reserved_names;
  "ssh/access": typeof ssh_access;
  "ssh/access_http": typeof ssh_access_http;
  "ssh/access_state": typeof ssh_access_state;
  "ssh/authorized_keys": typeof ssh_authorized_keys;
  "ssh/bootstrap_command": typeof ssh_bootstrap_command;
  "ssh/cloud_init": typeof ssh_cloud_init;
  "ssh/connection": typeof ssh_connection;
  "ssh/inspect_public_key": typeof ssh_inspect_public_key;
  "ssh/read_file": typeof ssh_read_file;
  "ssh/remove_authorized_keys": typeof ssh_remove_authorized_keys;
  "ssh/report_host_key_script": typeof ssh_report_host_key_script;
  "ssh/write_file": typeof ssh_write_file;
  "ssh/write_file_script": typeof ssh_write_file_script;
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
