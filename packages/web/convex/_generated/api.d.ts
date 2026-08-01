/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as accountDeletion from "../accountDeletion.js";
import type * as accountDeletionLogic from "../accountDeletionLogic.js";
import type * as accountEmail from "../accountEmail.js";
import type * as billing_polar from "../billing/polar.js";
import type * as billing_reconciliation from "../billing/reconciliation.js";
import type * as billing_webhooks from "../billing/webhooks.js";
import type * as boxes_access from "../boxes/access.js";
import type * as boxes_auth from "../boxes/auth.js";
import type * as boxes_autoRepair from "../boxes/autoRepair.js";
import type * as boxes_capacity from "../boxes/capacity.js";
import type * as boxes_capacityAlerts from "../boxes/capacityAlerts.js";
import type * as boxes_cleanup from "../boxes/cleanup.js";
import type * as boxes_events from "../boxes/events.js";
import type * as boxes_health from "../boxes/health.js";
import type * as boxes_infra_cloudflareContracts from "../boxes/infra/cloudflareContracts.js";
import type * as boxes_infra_cloudflareDns from "../boxes/infra/cloudflareDns.js";
import type * as boxes_infra_hetznerContracts from "../boxes/infra/hetznerContracts.js";
import type * as boxes_infra_hetznerVps from "../boxes/infra/hetznerVps.js";
import type * as boxes_infra_providerResponse from "../boxes/infra/providerResponse.js";
import type * as boxes_infra_registryContracts from "../boxes/infra/registryContracts.js";
import type * as boxes_infra_runtimeArtifacts from "../boxes/infra/runtimeArtifacts.js";
import type * as boxes_infra_runtimeImageRegistry from "../boxes/infra/runtimeImageRegistry.js";
import type * as boxes_infra_runtimeImages from "../boxes/infra/runtimeImages.js";
import type * as boxes_infra_ssh from "../boxes/infra/ssh.js";
import type * as boxes_infra_sshKeys from "../boxes/infra/sshKeys.js";
import type * as boxes_infra_sshScripts from "../boxes/infra/sshScripts.js";
import type * as boxes_infra_sshTransport from "../boxes/infra/sshTransport.js";
import type * as boxes_logs from "../boxes/logs.js";
import type * as boxes_metricThresholds from "../boxes/metricThresholds.js";
import type * as boxes_metrics from "../boxes/metrics.js";
import type * as boxes_metricsPoll from "../boxes/metricsPoll.js";
import type * as boxes_operationSweep from "../boxes/operationSweep.js";
import type * as boxes_operations from "../boxes/operations.js";
import type * as boxes_queries from "../boxes/queries.js";
import type * as boxes_reconcile from "../boxes/reconcile.js";
import type * as boxes_recovery from "../boxes/recovery.js";
import type * as boxes_recoveryTypes from "../boxes/recoveryTypes.js";
import type * as boxes_retention from "../boxes/retention.js";
import type * as boxes_runtimeConfig from "../boxes/runtimeConfig.js";
import type * as boxes_runtimeFloor from "../boxes/runtimeFloor.js";
import type * as boxes_runtimeRelease from "../boxes/runtimeRelease.js";
import type * as boxes_slugAvailability from "../boxes/slugAvailability.js";
import type * as boxes_snapshotPolicy from "../boxes/snapshotPolicy.js";
import type * as boxes_snapshots from "../boxes/snapshots.js";
import type * as boxes_status from "../boxes/status.js";
import type * as boxes_views from "../boxes/views.js";
import type * as boxes_workflows_boxWorkflow from "../boxes/workflows/boxWorkflow.js";
import type * as boxes_workflows_changeBoxConfig from "../boxes/workflows/changeBoxConfig.js";
import type * as boxes_workflows_changeBoxPassword from "../boxes/workflows/changeBoxPassword.js";
import type * as boxes_workflows_changeBoxSlug from "../boxes/workflows/changeBoxSlug.js";
import type * as boxes_workflows_createBox from "../boxes/workflows/createBox.js";
import type * as boxes_workflows_deleteBox from "../boxes/workflows/deleteBox.js";
import type * as boxes_workflows_repairBox from "../boxes/workflows/repairBox.js";
import type * as boxes_workflows_resetBox from "../boxes/workflows/resetBox.js";
import type * as boxes_workflows_runtimeLifecycle from "../boxes/workflows/runtimeLifecycle.js";
import type * as boxes_workflows_snapshotWorkflows from "../boxes/workflows/snapshotWorkflows.js";
import type * as boxes_workflows_startBox from "../boxes/workflows/startBox.js";
import type * as boxes_workflows_stopBox from "../boxes/workflows/stopBox.js";
import type * as boxes_workflows_suspendBox from "../boxes/workflows/suspendBox.js";
import type * as boxes_workflows_unsuspendBox from "../boxes/workflows/unsuspendBox.js";
import type * as boxes_workflows_updateBox from "../boxes/workflows/updateBox.js";
import type * as checkout_checkoutConversion from "../checkout/checkoutConversion.js";
import type * as checkout_checkoutIntents from "../checkout/checkoutIntents.js";
import type * as crons from "../crons.js";
import type * as email from "../email.js";
import type * as env from "../env.js";
import type * as http from "../http.js";
import type * as legalNotice from "../legalNotice.js";
import type * as model_box_auth from "../model/box/auth.js";
import type * as model_box_billing from "../model/box/billing.js";
import type * as model_box_metric from "../model/box/metric.js";
import type * as model_box_operation from "../model/box/operation.js";
import type * as model_box_path from "../model/box/path.js";
import type * as model_box_plan from "../model/box/plan.js";
import type * as model_box_slug from "../model/box/slug.js";
import type * as model_box_snapshot from "../model/box/snapshot.js";
import type * as model_box_status from "../model/box/status.js";
import type * as model_legal from "../model/legal.js";
import type * as model_links from "../model/links.js";
import type * as ownerEmail from "../ownerEmail.js";
import type * as settings from "../settings.js";
import type * as staff_alerts from "../staff/alerts.js";
import type * as staff_boxes from "../staff/boxes.js";
import type * as staff_checkout from "../staff/checkout.js";
import type * as staff_metrics from "../staff/metrics.js";
import type * as staff_settings from "../staff/settings.js";
import type * as staff_stats from "../staff/stats.js";
import type * as staff_users from "../staff/users.js";
import type * as time from "../time.js";
import type * as user_boxConfig from "../user/boxConfig.js";
import type * as user_boxes from "../user/boxes.js";
import type * as user_checkout from "../user/checkout.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  accountDeletion: typeof accountDeletion;
  accountDeletionLogic: typeof accountDeletionLogic;
  accountEmail: typeof accountEmail;
  "billing/polar": typeof billing_polar;
  "billing/reconciliation": typeof billing_reconciliation;
  "billing/webhooks": typeof billing_webhooks;
  "boxes/access": typeof boxes_access;
  "boxes/auth": typeof boxes_auth;
  "boxes/autoRepair": typeof boxes_autoRepair;
  "boxes/capacity": typeof boxes_capacity;
  "boxes/capacityAlerts": typeof boxes_capacityAlerts;
  "boxes/cleanup": typeof boxes_cleanup;
  "boxes/events": typeof boxes_events;
  "boxes/health": typeof boxes_health;
  "boxes/infra/cloudflareContracts": typeof boxes_infra_cloudflareContracts;
  "boxes/infra/cloudflareDns": typeof boxes_infra_cloudflareDns;
  "boxes/infra/hetznerContracts": typeof boxes_infra_hetznerContracts;
  "boxes/infra/hetznerVps": typeof boxes_infra_hetznerVps;
  "boxes/infra/providerResponse": typeof boxes_infra_providerResponse;
  "boxes/infra/registryContracts": typeof boxes_infra_registryContracts;
  "boxes/infra/runtimeArtifacts": typeof boxes_infra_runtimeArtifacts;
  "boxes/infra/runtimeImageRegistry": typeof boxes_infra_runtimeImageRegistry;
  "boxes/infra/runtimeImages": typeof boxes_infra_runtimeImages;
  "boxes/infra/ssh": typeof boxes_infra_ssh;
  "boxes/infra/sshKeys": typeof boxes_infra_sshKeys;
  "boxes/infra/sshScripts": typeof boxes_infra_sshScripts;
  "boxes/infra/sshTransport": typeof boxes_infra_sshTransport;
  "boxes/logs": typeof boxes_logs;
  "boxes/metricThresholds": typeof boxes_metricThresholds;
  "boxes/metrics": typeof boxes_metrics;
  "boxes/metricsPoll": typeof boxes_metricsPoll;
  "boxes/operationSweep": typeof boxes_operationSweep;
  "boxes/operations": typeof boxes_operations;
  "boxes/queries": typeof boxes_queries;
  "boxes/reconcile": typeof boxes_reconcile;
  "boxes/recovery": typeof boxes_recovery;
  "boxes/recoveryTypes": typeof boxes_recoveryTypes;
  "boxes/retention": typeof boxes_retention;
  "boxes/runtimeConfig": typeof boxes_runtimeConfig;
  "boxes/runtimeFloor": typeof boxes_runtimeFloor;
  "boxes/runtimeRelease": typeof boxes_runtimeRelease;
  "boxes/slugAvailability": typeof boxes_slugAvailability;
  "boxes/snapshotPolicy": typeof boxes_snapshotPolicy;
  "boxes/snapshots": typeof boxes_snapshots;
  "boxes/status": typeof boxes_status;
  "boxes/views": typeof boxes_views;
  "boxes/workflows/boxWorkflow": typeof boxes_workflows_boxWorkflow;
  "boxes/workflows/changeBoxConfig": typeof boxes_workflows_changeBoxConfig;
  "boxes/workflows/changeBoxPassword": typeof boxes_workflows_changeBoxPassword;
  "boxes/workflows/changeBoxSlug": typeof boxes_workflows_changeBoxSlug;
  "boxes/workflows/createBox": typeof boxes_workflows_createBox;
  "boxes/workflows/deleteBox": typeof boxes_workflows_deleteBox;
  "boxes/workflows/repairBox": typeof boxes_workflows_repairBox;
  "boxes/workflows/resetBox": typeof boxes_workflows_resetBox;
  "boxes/workflows/runtimeLifecycle": typeof boxes_workflows_runtimeLifecycle;
  "boxes/workflows/snapshotWorkflows": typeof boxes_workflows_snapshotWorkflows;
  "boxes/workflows/startBox": typeof boxes_workflows_startBox;
  "boxes/workflows/stopBox": typeof boxes_workflows_stopBox;
  "boxes/workflows/suspendBox": typeof boxes_workflows_suspendBox;
  "boxes/workflows/unsuspendBox": typeof boxes_workflows_unsuspendBox;
  "boxes/workflows/updateBox": typeof boxes_workflows_updateBox;
  "checkout/checkoutConversion": typeof checkout_checkoutConversion;
  "checkout/checkoutIntents": typeof checkout_checkoutIntents;
  crons: typeof crons;
  email: typeof email;
  env: typeof env;
  http: typeof http;
  legalNotice: typeof legalNotice;
  "model/box/auth": typeof model_box_auth;
  "model/box/billing": typeof model_box_billing;
  "model/box/metric": typeof model_box_metric;
  "model/box/operation": typeof model_box_operation;
  "model/box/path": typeof model_box_path;
  "model/box/plan": typeof model_box_plan;
  "model/box/slug": typeof model_box_slug;
  "model/box/snapshot": typeof model_box_snapshot;
  "model/box/status": typeof model_box_status;
  "model/legal": typeof model_legal;
  "model/links": typeof model_links;
  ownerEmail: typeof ownerEmail;
  settings: typeof settings;
  "staff/alerts": typeof staff_alerts;
  "staff/boxes": typeof staff_boxes;
  "staff/checkout": typeof staff_checkout;
  "staff/metrics": typeof staff_metrics;
  "staff/settings": typeof staff_settings;
  "staff/stats": typeof staff_stats;
  "staff/users": typeof staff_users;
  time: typeof time;
  "user/boxConfig": typeof user_boxConfig;
  "user/boxes": typeof user_boxes;
  "user/checkout": typeof user_checkout;
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
