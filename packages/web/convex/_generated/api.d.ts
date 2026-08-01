/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as account_deletion from "../account/deletion.js";
import type * as account_deletionLogic from "../account/deletionLogic.js";
import type * as billing_polar from "../billing/polar.js";
import type * as billing_reconciliation from "../billing/reconciliation.js";
import type * as billing_webhooks from "../billing/webhooks.js";
import type * as box_auth from "../box/auth.js";
import type * as box_release from "../box/release.js";
import type * as checkout_checkoutConversion from "../checkout/checkoutConversion.js";
import type * as checkout_checkoutIntents from "../checkout/checkoutIntents.js";
import type * as crons from "../crons.js";
import type * as env from "../env.js";
import type * as fleet_autoRepair from "../fleet/autoRepair.js";
import type * as fleet_capacity from "../fleet/capacity.js";
import type * as fleet_capacityAlerts from "../fleet/capacityAlerts.js";
import type * as fleet_cleanup from "../fleet/cleanup.js";
import type * as fleet_endpoint from "../fleet/endpoint.js";
import type * as fleet_events from "../fleet/events.js";
import type * as fleet_health from "../fleet/health.js";
import type * as fleet_infra_cloudflareContracts from "../fleet/infra/cloudflareContracts.js";
import type * as fleet_infra_cloudflareDns from "../fleet/infra/cloudflareDns.js";
import type * as fleet_infra_hetznerContracts from "../fleet/infra/hetznerContracts.js";
import type * as fleet_infra_hetznerVps from "../fleet/infra/hetznerVps.js";
import type * as fleet_infra_providerResponse from "../fleet/infra/providerResponse.js";
import type * as fleet_infra_registryContracts from "../fleet/infra/registryContracts.js";
import type * as fleet_infra_runtimeArtifacts from "../fleet/infra/runtimeArtifacts.js";
import type * as fleet_infra_runtimeImageRegistry from "../fleet/infra/runtimeImageRegistry.js";
import type * as fleet_infra_runtimeImages from "../fleet/infra/runtimeImages.js";
import type * as fleet_infra_ssh from "../fleet/infra/ssh.js";
import type * as fleet_infra_sshKeys from "../fleet/infra/sshKeys.js";
import type * as fleet_infra_sshScripts from "../fleet/infra/sshScripts.js";
import type * as fleet_infra_sshTransport from "../fleet/infra/sshTransport.js";
import type * as fleet_lifecycle from "../fleet/lifecycle.js";
import type * as fleet_logs from "../fleet/logs.js";
import type * as fleet_metricThresholds from "../fleet/metricThresholds.js";
import type * as fleet_metrics from "../fleet/metrics.js";
import type * as fleet_metricsPoll from "../fleet/metricsPoll.js";
import type * as fleet_operationSweep from "../fleet/operationSweep.js";
import type * as fleet_operations from "../fleet/operations.js";
import type * as fleet_queries from "../fleet/queries.js";
import type * as fleet_reconcile from "../fleet/reconcile.js";
import type * as fleet_retention from "../fleet/retention.js";
import type * as fleet_runtimeConfig from "../fleet/runtimeConfig.js";
import type * as fleet_runtimeFloor from "../fleet/runtimeFloor.js";
import type * as fleet_runtimeRelease from "../fleet/runtimeRelease.js";
import type * as fleet_slugAvailability from "../fleet/slugAvailability.js";
import type * as fleet_snapshotPolicy from "../fleet/snapshotPolicy.js";
import type * as fleet_snapshots from "../fleet/snapshots.js";
import type * as fleet_views from "../fleet/views.js";
import type * as fleet_workflows_boxWorkflow from "../fleet/workflows/boxWorkflow.js";
import type * as fleet_workflows_changeBoxConfig from "../fleet/workflows/changeBoxConfig.js";
import type * as fleet_workflows_changeBoxPassword from "../fleet/workflows/changeBoxPassword.js";
import type * as fleet_workflows_changeBoxSlug from "../fleet/workflows/changeBoxSlug.js";
import type * as fleet_workflows_createBox from "../fleet/workflows/createBox.js";
import type * as fleet_workflows_deleteBox from "../fleet/workflows/deleteBox.js";
import type * as fleet_workflows_repairBox from "../fleet/workflows/repairBox.js";
import type * as fleet_workflows_resetBox from "../fleet/workflows/resetBox.js";
import type * as fleet_workflows_runtimeLifecycle from "../fleet/workflows/runtimeLifecycle.js";
import type * as fleet_workflows_snapshotWorkflows from "../fleet/workflows/snapshotWorkflows.js";
import type * as fleet_workflows_startBox from "../fleet/workflows/startBox.js";
import type * as fleet_workflows_stopBox from "../fleet/workflows/stopBox.js";
import type * as fleet_workflows_suspendBox from "../fleet/workflows/suspendBox.js";
import type * as fleet_workflows_unsuspendBox from "../fleet/workflows/unsuspendBox.js";
import type * as fleet_workflows_updateBox from "../fleet/workflows/updateBox.js";
import type * as http from "../http.js";
import type * as model_box_auth from "../model/box/auth.js";
import type * as model_box_billing from "../model/box/billing.js";
import type * as model_box_metric from "../model/box/metric.js";
import type * as model_box_operation from "../model/box/operation.js";
import type * as model_box_path from "../model/box/path.js";
import type * as model_box_plan from "../model/box/plan.js";
import type * as model_box_recovery from "../model/box/recovery.js";
import type * as model_box_slug from "../model/box/slug.js";
import type * as model_box_snapshot from "../model/box/snapshot.js";
import type * as model_box_status from "../model/box/status.js";
import type * as model_legal from "../model/legal.js";
import type * as model_links from "../model/links.js";
import type * as notice_account from "../notice/account.js";
import type * as notice_email from "../notice/email.js";
import type * as notice_legal from "../notice/legal.js";
import type * as notice_owner from "../notice/owner.js";
import type * as owner_account from "../owner/account.js";
import type * as owner_boxConfig from "../owner/boxConfig.js";
import type * as owner_boxes from "../owner/boxes.js";
import type * as owner_checkout from "../owner/checkout.js";
import type * as settings from "../settings.js";
import type * as site_pricing from "../site/pricing.js";
import type * as staff_alerts from "../staff/alerts.js";
import type * as staff_boxes from "../staff/boxes.js";
import type * as staff_checkout from "../staff/checkout.js";
import type * as staff_metrics from "../staff/metrics.js";
import type * as staff_settings from "../staff/settings.js";
import type * as staff_stats from "../staff/stats.js";
import type * as staff_users from "../staff/users.js";
import type * as time from "../time.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "account/deletion": typeof account_deletion;
  "account/deletionLogic": typeof account_deletionLogic;
  "billing/polar": typeof billing_polar;
  "billing/reconciliation": typeof billing_reconciliation;
  "billing/webhooks": typeof billing_webhooks;
  "box/auth": typeof box_auth;
  "box/release": typeof box_release;
  "checkout/checkoutConversion": typeof checkout_checkoutConversion;
  "checkout/checkoutIntents": typeof checkout_checkoutIntents;
  crons: typeof crons;
  env: typeof env;
  "fleet/autoRepair": typeof fleet_autoRepair;
  "fleet/capacity": typeof fleet_capacity;
  "fleet/capacityAlerts": typeof fleet_capacityAlerts;
  "fleet/cleanup": typeof fleet_cleanup;
  "fleet/endpoint": typeof fleet_endpoint;
  "fleet/events": typeof fleet_events;
  "fleet/health": typeof fleet_health;
  "fleet/infra/cloudflareContracts": typeof fleet_infra_cloudflareContracts;
  "fleet/infra/cloudflareDns": typeof fleet_infra_cloudflareDns;
  "fleet/infra/hetznerContracts": typeof fleet_infra_hetznerContracts;
  "fleet/infra/hetznerVps": typeof fleet_infra_hetznerVps;
  "fleet/infra/providerResponse": typeof fleet_infra_providerResponse;
  "fleet/infra/registryContracts": typeof fleet_infra_registryContracts;
  "fleet/infra/runtimeArtifacts": typeof fleet_infra_runtimeArtifacts;
  "fleet/infra/runtimeImageRegistry": typeof fleet_infra_runtimeImageRegistry;
  "fleet/infra/runtimeImages": typeof fleet_infra_runtimeImages;
  "fleet/infra/ssh": typeof fleet_infra_ssh;
  "fleet/infra/sshKeys": typeof fleet_infra_sshKeys;
  "fleet/infra/sshScripts": typeof fleet_infra_sshScripts;
  "fleet/infra/sshTransport": typeof fleet_infra_sshTransport;
  "fleet/lifecycle": typeof fleet_lifecycle;
  "fleet/logs": typeof fleet_logs;
  "fleet/metricThresholds": typeof fleet_metricThresholds;
  "fleet/metrics": typeof fleet_metrics;
  "fleet/metricsPoll": typeof fleet_metricsPoll;
  "fleet/operationSweep": typeof fleet_operationSweep;
  "fleet/operations": typeof fleet_operations;
  "fleet/queries": typeof fleet_queries;
  "fleet/reconcile": typeof fleet_reconcile;
  "fleet/retention": typeof fleet_retention;
  "fleet/runtimeConfig": typeof fleet_runtimeConfig;
  "fleet/runtimeFloor": typeof fleet_runtimeFloor;
  "fleet/runtimeRelease": typeof fleet_runtimeRelease;
  "fleet/slugAvailability": typeof fleet_slugAvailability;
  "fleet/snapshotPolicy": typeof fleet_snapshotPolicy;
  "fleet/snapshots": typeof fleet_snapshots;
  "fleet/views": typeof fleet_views;
  "fleet/workflows/boxWorkflow": typeof fleet_workflows_boxWorkflow;
  "fleet/workflows/changeBoxConfig": typeof fleet_workflows_changeBoxConfig;
  "fleet/workflows/changeBoxPassword": typeof fleet_workflows_changeBoxPassword;
  "fleet/workflows/changeBoxSlug": typeof fleet_workflows_changeBoxSlug;
  "fleet/workflows/createBox": typeof fleet_workflows_createBox;
  "fleet/workflows/deleteBox": typeof fleet_workflows_deleteBox;
  "fleet/workflows/repairBox": typeof fleet_workflows_repairBox;
  "fleet/workflows/resetBox": typeof fleet_workflows_resetBox;
  "fleet/workflows/runtimeLifecycle": typeof fleet_workflows_runtimeLifecycle;
  "fleet/workflows/snapshotWorkflows": typeof fleet_workflows_snapshotWorkflows;
  "fleet/workflows/startBox": typeof fleet_workflows_startBox;
  "fleet/workflows/stopBox": typeof fleet_workflows_stopBox;
  "fleet/workflows/suspendBox": typeof fleet_workflows_suspendBox;
  "fleet/workflows/unsuspendBox": typeof fleet_workflows_unsuspendBox;
  "fleet/workflows/updateBox": typeof fleet_workflows_updateBox;
  http: typeof http;
  "model/box/auth": typeof model_box_auth;
  "model/box/billing": typeof model_box_billing;
  "model/box/metric": typeof model_box_metric;
  "model/box/operation": typeof model_box_operation;
  "model/box/path": typeof model_box_path;
  "model/box/plan": typeof model_box_plan;
  "model/box/recovery": typeof model_box_recovery;
  "model/box/slug": typeof model_box_slug;
  "model/box/snapshot": typeof model_box_snapshot;
  "model/box/status": typeof model_box_status;
  "model/legal": typeof model_legal;
  "model/links": typeof model_links;
  "notice/account": typeof notice_account;
  "notice/email": typeof notice_email;
  "notice/legal": typeof notice_legal;
  "notice/owner": typeof notice_owner;
  "owner/account": typeof owner_account;
  "owner/boxConfig": typeof owner_boxConfig;
  "owner/boxes": typeof owner_boxes;
  "owner/checkout": typeof owner_checkout;
  settings: typeof settings;
  "site/pricing": typeof site_pricing;
  "staff/alerts": typeof staff_alerts;
  "staff/boxes": typeof staff_boxes;
  "staff/checkout": typeof staff_checkout;
  "staff/metrics": typeof staff_metrics;
  "staff/settings": typeof staff_settings;
  "staff/stats": typeof staff_stats;
  "staff/users": typeof staff_users;
  time: typeof time;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  polar: import("@convex-dev/polar/_generated/component.js").ComponentApi<"polar">;
  resend: import("@convex-dev/resend/_generated/component.js").ComponentApi<"resend">;
  workflow: import("@convex-dev/workflow/_generated/component.js").ComponentApi<"workflow">;
};
