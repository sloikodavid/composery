/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as crons from "../crons.js";
import type * as hetzner from "../hetzner.js";
import type * as http from "../http.js";
import type * as limits from "../limits.js";
import type * as names from "../names.js";
import type * as server_access from "../server_access.js";
import type * as server_inventory from "../server_inventory.js";
import type * as server_lifecycle from "../server_lifecycle.js";
import type * as server_model from "../server_model.js";
import type * as server_permissions from "../server_permissions.js";
import type * as server_worker from "../server_worker.js";
import type * as servers from "../servers.js";
import type * as ssh_authorized_keys from "../ssh/authorized_keys.js";
import type * as ssh_bootstrap from "../ssh/bootstrap.js";
import type * as ssh_bootstrap_http from "../ssh/bootstrap_http.js";
import type * as ssh_bootstrap_state from "../ssh/bootstrap_state.js";
import type * as ssh_connection from "../ssh/connection.js";
import type * as ssh_inspect_key from "../ssh/inspect_key.js";
import type * as ssh_read_file from "../ssh/read_file.js";
import type * as ssh_remove_keys from "../ssh/remove_keys.js";
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
  crons: typeof crons;
  hetzner: typeof hetzner;
  http: typeof http;
  limits: typeof limits;
  names: typeof names;
  server_access: typeof server_access;
  server_inventory: typeof server_inventory;
  server_lifecycle: typeof server_lifecycle;
  server_model: typeof server_model;
  server_permissions: typeof server_permissions;
  server_worker: typeof server_worker;
  servers: typeof servers;
  "ssh/authorized_keys": typeof ssh_authorized_keys;
  "ssh/bootstrap": typeof ssh_bootstrap;
  "ssh/bootstrap_http": typeof ssh_bootstrap_http;
  "ssh/bootstrap_state": typeof ssh_bootstrap_state;
  "ssh/connection": typeof ssh_connection;
  "ssh/inspect_key": typeof ssh_inspect_key;
  "ssh/read_file": typeof ssh_read_file;
  "ssh/remove_keys": typeof ssh_remove_keys;
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
  workpool: import("@convex-dev/workpool/_generated/component.js").ComponentApi<"workpool">;
  serverCleanup: import("@convex-dev/workpool/_generated/component.js").ComponentApi<"serverCleanup">;
};
