import { errorResponse, wrapResponse } from "../common";
import type { AppContext } from "../common";
import type { Env } from "../explorer.worker";
import type { WorkflowInfo } from "../../../plugins/core/types";

// ============================================================================
// Types
// ============================================================================

// The Workflow binding interface (from @cloudflare/workflows-shared)
interface WorkflowBinding {
	create(options?: { id?: string; params?: unknown }): Promise<{ id: string }>;
	get(id: string): Promise<WorkflowInstanceHandle>;
	unsafeWatchLogs(
		instanceId: string,
		afterRowId: number
	): Promise<{
		logs: Array<{
			event: number;
			group: string | null;
			target: string | null;
			metadata: unknown;
		}>;
		status: string;
		lastRowId: number;
	}>;
}

interface WorkflowInstanceHandle {
	id: string;
	status(): Promise<WorkflowInstanceStatus>;
	sendEvent(args: { payload: unknown; type: string }): Promise<void>;
}

interface WorkflowInstanceStatus {
	status: string;
	output: unknown;
	error: { name: string; message: string } | undefined;
	__LOCAL_DEV_STEP_OUTPUTS: unknown[];
}

interface InstanceFromLoopback {
	hash: string;
	id: string;
	status: string;
	output: unknown;
	error: unknown;
	params: unknown;
	created_on: string | null;
	states: Array<{
		id: number;
		event: number;
		groupKey: string | null;
		target: string | null;
		metadata: unknown;
	}>;
}

// ============================================================================
// Helpers
// ============================================================================

function getWorkflowBinding(
	env: Env,
	workflowName: string
): { binding: WorkflowBinding; info: WorkflowInfo } | null {
	const info = env.LOCAL_EXPLORER_BINDING_MAP.workflows[workflowName];
	if (!info) {
		return null;
	}
	const binding = env[info.binding] as unknown as WorkflowBinding;
	if (!binding) {
		return null;
	}
	return { binding, info };
}

// ============================================================================
// List Workflows
// ============================================================================

/**
 * List all configured workflows.
 * Returns the workflow definitions from the binding map.
 */
export async function listWorkflows(c: AppContext) {
	const workflowMap = c.env.LOCAL_EXPLORER_BINDING_MAP.workflows;

	const workflows = Object.entries(workflowMap).map(([_name, info]) => ({
		id: info.name,
		name: info.name,
		class_name: info.className,
		script_name: info.scriptName,
	}));

	return c.json({
		...wrapResponse(workflows),
		result_info: {
			count: workflows.length,
			page: 1,
			per_page: workflows.length,
			total_count: workflows.length,
		},
	});
}

// ============================================================================
// List Workflow Instances
// ============================================================================

/**
 * List instances of a specific workflow.
 * Uses the loopback service to read workflow instance data from sqlite files.
 */
export async function listWorkflowInstances(
	c: AppContext,
	workflowName: string
) {
	const wf = getWorkflowBinding(c.env, workflowName);
	if (!wf) {
		return errorResponse(404, 10001, `Workflow not found: ${workflowName}`);
	}

	if (c.env.MINIFLARE_LOOPBACK === undefined) {
		return errorResponse(
			500,
			10001,
			"Loopback service not available for workflow instance listing"
		);
	}

	// The loopback endpoint reads all sqlite files for the Engine DO namespace
	// and returns parsed instance data including states
	const uniqueKey = `miniflare-workflows-${workflowName}`;
	const encodedKey = encodeURIComponent(uniqueKey);
	const loopbackUrl = `http://localhost/core/workflow-storage/${encodedKey}/instances`;

	const response = await c.env.MINIFLARE_LOOPBACK.fetch(loopbackUrl);

	if (!response.ok) {
		if (response.status === 404) {
			return c.json({
				...wrapResponse([]),
				result_info: { count: 0, cursor: "" },
			});
		}
		return errorResponse(
			500,
			10001,
			`Failed to read workflow storage: ${response.statusText}`
		);
	}

	const instances = (await response.json()) as InstanceFromLoopback[];

	// Return instances without the full states data (that's for the detail endpoint)
	// Sort by created_on descending (newest first), nulls at the end
	const result = instances
		.map((inst) => ({
			id: inst.id,
			hash: inst.hash,
			status: inst.status,
			output: inst.output,
			error: inst.error,
			params: inst.params,
			created_on: inst.created_on,
			step_count: countSteps(inst.states),
		}))
		.sort((a, b) => {
			if (a.created_on && b.created_on) {
				return (
					new Date(b.created_on).getTime() -
					new Date(a.created_on).getTime()
				);
			}
			if (a.created_on) return -1;
			if (b.created_on) return 1;
			return 0;
		});

	return c.json({
		...wrapResponse(result),
		result_info: {
			count: result.length,
			cursor: "",
		},
	});
}

// ============================================================================
// Get Workflow Instance Detail (with full states/timeline data)
// ============================================================================

/**
 * Get detailed information about a specific workflow instance.
 * Returns the full states table as a timeline for waterfall rendering.
 */
export async function getWorkflowInstance(
	c: AppContext,
	workflowName: string,
	instanceId: string
) {
	const wf = getWorkflowBinding(c.env, workflowName);
	if (!wf) {
		return errorResponse(404, 10001, `Workflow not found: ${workflowName}`);
	}

	if (c.env.MINIFLARE_LOOPBACK === undefined) {
		return errorResponse(500, 10001, "Loopback service not available");
	}

	// Get all instances from the loopback to find the matching one
	const uniqueKey = `miniflare-workflows-${workflowName}`;
	const encodedKey = encodeURIComponent(uniqueKey);
	const loopbackUrl = `http://localhost/core/workflow-storage/${encodedKey}/instances`;

	const response = await c.env.MINIFLARE_LOOPBACK.fetch(loopbackUrl);

	if (!response.ok) {
		return errorResponse(
			404,
			10001,
			`No instances found for workflow: ${workflowName}`
		);
	}

	const allInstances = (await response.json()) as InstanceFromLoopback[];

	// Find the matching instance by ID or hash
	const instance = allInstances.find(
		(inst) => inst.id === instanceId || inst.hash === instanceId
	);

	if (!instance) {
		return errorResponse(404, 10001, `Instance not found: ${instanceId}`);
	}

	// Parse states into a structured timeline
	const timeline = parseStatesToTimeline(instance.states);

	return c.json(
		wrapResponse({
			id: instance.id,
			hash: instance.hash,
			status: instance.status,
			output: instance.output,
			error: instance.error,
			params: instance.params,
			created_on: instance.created_on,
			timeline,
			raw_states: instance.states,
		})
	);
}

// ============================================================================
// Trigger Workflow (create a new instance)
// ============================================================================

/**
 * Create a new workflow instance with optional params.
 */
export async function triggerWorkflow(
	c: AppContext,
	workflowName: string,
	body: { id?: string; params?: unknown }
): Promise<Response> {
	const wf = getWorkflowBinding(c.env, workflowName);
	if (!wf) {
		return errorResponse(404, 10001, `Workflow not found: ${workflowName}`);
	}

	try {
		const result = await wf.binding.create({
			id: body.id,
			params: body.params,
		});
		return c.json(wrapResponse(result));
	} catch (err) {
		const message =
			err instanceof Error ? err.message : "Failed to trigger workflow";
		return errorResponse(500, 10001, message);
	}
}

// ============================================================================
// Send Event to Workflow Instance
// ============================================================================

/**
 * Send an event to a running workflow instance (for waitForEvent steps).
 *
 * The explorer displays DO hashes as instance IDs, but the Workflow binding's
 * `.get()` expects the real UUID that was returned from `.create()`. We resolve
 * the real UUID by looking it up via the loopback endpoint (which V8-deserializes
 * INSTANCE_METADATA from the Engine DO's sqlite).
 */
export async function sendWorkflowEvent(
	c: AppContext,
	workflowName: string,
	instanceId: string,
	body: { type: string; payload: unknown }
): Promise<Response> {
	const wf = getWorkflowBinding(c.env, workflowName);
	if (!wf) {
		return errorResponse(404, 10001, `Workflow not found: ${workflowName}`);
	}

	// Resolve hash → UUID, then try resolved first, fall back to original
	const resolvedId = await resolveInstanceUUID(
		c.env,
		workflowName,
		instanceId
	);
	const idsToTry = resolvedId && resolvedId !== instanceId
		? [resolvedId, instanceId]
		: [instanceId];

	let lastError: string = "Failed to send event";
	for (const candidateId of idsToTry) {
		try {
			const handle = await wf.binding.get(candidateId);
			await handle.sendEvent({
				type: body.type,
				payload: body.payload,
			});
			return c.json(wrapResponse({ success: true }));
		} catch (err) {
			lastError = err instanceof Error ? err.message : "Failed to send event";
		}
	}
	return errorResponse(500, 10001, lastError);
}

// ============================================================================
// Get Workflow Instance Status (lightweight, via binding only)
// ============================================================================

export async function getWorkflowInstanceStatus(
	c: AppContext,
	workflowName: string,
	instanceId: string
) {
	const wf = getWorkflowBinding(c.env, workflowName);
	if (!wf) {
		return errorResponse(404, 10001, `Workflow not found: ${workflowName}`);
	}

	// Resolve hash → UUID, then try resolved first, fall back to original
	const resolvedId = await resolveInstanceUUID(
		c.env,
		workflowName,
		instanceId
	);
	const idsToTry = resolvedId && resolvedId !== instanceId
		? [resolvedId, instanceId]
		: [instanceId];

	let lastError: string = "Failed to get instance status";
	for (const candidateId of idsToTry) {
		try {
			const handle = await wf.binding.get(candidateId);
			const status = await handle.status();
			return c.json(
				wrapResponse({
					id: instanceId,
					status: status.status,
					output: status.output,
					error: status.error,
				})
			);
		} catch (err) {
			lastError = err instanceof Error ? err.message : "Failed to get instance status";
		}
	}
	return errorResponse(500, 10001, lastError);
}

// ============================================================================
// SSE Stream — real-time instance updates (push-based via Engine DO)
// ============================================================================

const TERMINAL_STATUSES = new Set(["complete", "errored", "terminated"]);

/**
 * Resolve an instance identifier (which may be a DO hash or a UUID) to
 * the real UUID that the Workflow binding expects.
 *
 * Uses the loopback to read INSTANCE_METADATA from SQLite files.
 * Returns `null` if resolution fails (caller should fall back to the original id).
 */
async function resolveInstanceUUID(
	env: Env,
	workflowName: string,
	instanceId: string
): Promise<string | null> {
	if (env.MINIFLARE_LOOPBACK === undefined) {
		return null;
	}
	try {
		const uniqueKey = `miniflare-workflows-${workflowName}`;
		const encodedKey = encodeURIComponent(uniqueKey);
		const loopbackUrl = `http://localhost/core/workflow-storage/${encodedKey}/instances`;
		const resp = await env.MINIFLARE_LOOPBACK.fetch(loopbackUrl);
		if (!resp.ok) {
			return null;
		}
		const instances = (await resp.json()) as InstanceFromLoopback[];
		const match = instances.find(
			(inst) => inst.hash === instanceId || inst.id === instanceId
		);
		return match?.id ?? null;
	} catch {
		return null;
	}
}

/**
 * Stream real-time updates for a workflow instance via Server-Sent Events.
 *
 * Uses the Engine DO's `watchLogs` method for true push-based streaming:
 * each call to `unsafeWatchLogs(id, afterRowId)` blocks inside the DO
 * until `writeLog()` fires, then returns the new log entries. No polling.
 */
export function streamWorkflowInstance(
	c: AppContext,
	workflowName: string,
	instanceId: string
): Response {
	const env = c.env;
	const wf = getWorkflowBinding(env, workflowName);
	if (!wf) {
		return errorResponse(404, 10001, `Workflow not found: ${workflowName}`);
	}

	let closed = false;

	const stream = new ReadableStream({
		async start(controller) {
			const encoder = new TextEncoder();
			const send = (event: string, data: unknown) => {
				if (closed) {
					return;
				}
				try {
					controller.enqueue(
						encoder.encode(
							`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
						)
					);
				} catch {
					closed = true;
				}
			};

			// Resolve the instance UUID (the binding needs the real UUID, not a DO hash)
			const resolvedId = await resolveInstanceUUID(
				env,
				workflowName,
				instanceId
			);
			const uuid = resolvedId ?? instanceId;

			let afterRowId = 0;
			// Accumulate all states for timeline parsing
			const allStates: Array<{
				id: number;
				event: number;
				groupKey: string | null;
				target: string | null;
				metadata: unknown;
			}> = [];

			try {
				while (!closed) {
					// This call blocks inside the Engine DO until new logs are written
					const result = await wf.binding.unsafeWatchLogs(
						uuid,
						afterRowId
					);

					if (closed) {
						break;
					}

					// Append new logs to our accumulated state
					for (const log of result.logs) {
						allStates.push({
							id: afterRowId + allStates.length + 1,
							event: log.event,
							groupKey: log.group,
							target: log.target,
							metadata: log.metadata,
						});
					}

					afterRowId = result.lastRowId;

					// Parse the full accumulated timeline and emit
					const timeline = parseStatesToTimeline(allStates);
					send("update", {
						id: uuid,
						hash: instanceId,
						status: result.status,
						timeline,
						raw_states: allStates,
					});

					// Close on terminal status
					if (TERMINAL_STATUSES.has(result.status)) {
						send("done", { status: result.status });
						closed = true;
						controller.close();
						return;
					}
				}
			} catch {
				// Connection closed or error — clean up
				if (!closed) {
					closed = true;
					try {
						controller.close();
					} catch {
						// already closed
					}
				}
			}
		},
		cancel() {
			closed = true;
		},
	});

	return new Response(stream, {
		headers: {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			Connection: "keep-alive",
		},
	});
}

// ============================================================================
// Timeline Parser
// ============================================================================

/**
 * Event type enum (mirrors InstanceEvent from workflows-shared)
 */
const EventType = {
	WORKFLOW_QUEUED: 0,
	WORKFLOW_START: 1,
	WORKFLOW_SUCCESS: 2,
	WORKFLOW_FAILURE: 3,
	WORKFLOW_TERMINATED: 4,
	STEP_START: 5,
	STEP_SUCCESS: 6,
	STEP_FAILURE: 7,
	SLEEP_START: 8,
	SLEEP_COMPLETE: 9,
	ATTEMPT_START: 10,
	ATTEMPT_SUCCESS: 11,
	ATTEMPT_FAILURE: 12,
	WAIT_START: 14,
	WAIT_COMPLETE: 15,
	WAIT_TIMED_OUT: 16,
} as const;

interface TimelineStep {
	name: string;
	type: "step" | "sleep" | "wait";
	groupKey: string | null;
	startIndex: number;
	endIndex: number | null;
	status: "running" | "success" | "failure" | "waiting" | "sleeping";
	output: unknown;
	error: unknown;
	attempts: Array<{
		startIndex: number;
		endIndex: number | null;
		status: "running" | "success" | "failure";
		error: unknown;
	}>;
	config: unknown;
}

function parseStatesToTimeline(
	states: Array<{
		id: number;
		event: number;
		groupKey: string | null;
		target: string | null;
		metadata: unknown;
	}>
): TimelineStep[] {
	const stepMap = new Map<string, TimelineStep>();
	const stepOrder: string[] = [];

	for (let i = 0; i < states.length; i++) {
		const state = states[i];
		const meta =
			typeof state.metadata === "string"
				? tryParseJSON(state.metadata)
				: state.metadata;
		const key = state.groupKey ?? `_state_${i}`;

		switch (state.event) {
			case EventType.STEP_START: {
				const stepName =
					state.target ??
					(meta as Record<string, unknown>)?.name ??
					key;
				if (!stepMap.has(key)) {
					stepOrder.push(key);
				}
				stepMap.set(key, {
					name: String(stepName),
					type: "step",
					groupKey: state.groupKey,
					startIndex: i,
					endIndex: null,
					status: "running",
					output: null,
					error: null,
					attempts: [],
					config: (meta as Record<string, unknown>)?.config ?? null,
				});
				break;
			}
			case EventType.STEP_SUCCESS: {
				const step = stepMap.get(key);
				if (step) {
					step.endIndex = i;
					step.status = "success";
					step.output =
						(meta as Record<string, unknown>)?.result ?? null;
				}
				break;
			}
			case EventType.STEP_FAILURE: {
				const step = stepMap.get(key);
				if (step) {
					step.endIndex = i;
					step.status = "failure";
					step.error =
						(meta as Record<string, unknown>)?.error ?? null;
				}
				break;
			}
			case EventType.ATTEMPT_START: {
				const step = stepMap.get(key);
				if (step) {
					step.attempts.push({
						startIndex: i,
						endIndex: null,
						status: "running",
						error: null,
					});
				}
				break;
			}
			case EventType.ATTEMPT_SUCCESS: {
				const step = stepMap.get(key);
				if (step && step.attempts.length > 0) {
					const lastAttempt =
						step.attempts[step.attempts.length - 1];
					lastAttempt.endIndex = i;
					lastAttempt.status = "success";
				}
				break;
			}
			case EventType.ATTEMPT_FAILURE: {
				const step = stepMap.get(key);
				if (step && step.attempts.length > 0) {
					const lastAttempt =
						step.attempts[step.attempts.length - 1];
					lastAttempt.endIndex = i;
					lastAttempt.status = "failure";
					lastAttempt.error =
						(meta as Record<string, unknown>)?.error ?? null;
				}
				break;
			}
			case EventType.SLEEP_START: {
				const stepName = state.target ?? "sleep";
				if (!stepMap.has(key)) {
					stepOrder.push(key);
				}
				stepMap.set(key, {
					name: String(stepName),
					type: "sleep",
					groupKey: state.groupKey,
					startIndex: i,
					endIndex: null,
					status: "sleeping",
					output: null,
					error: null,
					attempts: [],
					config: meta,
				});
				break;
			}
			case EventType.SLEEP_COMPLETE: {
				const step = stepMap.get(key);
				if (step) {
					step.endIndex = i;
					step.status = "success";
				}
				break;
			}
			case EventType.WAIT_START: {
				const stepName = state.target ?? "waitForEvent";
				if (!stepMap.has(key)) {
					stepOrder.push(key);
				}
				stepMap.set(key, {
					name: String(stepName),
					type: "wait",
					groupKey: state.groupKey,
					startIndex: i,
					endIndex: null,
					status: "waiting",
					output: null,
					error: null,
					attempts: [],
					config: meta,
				});
				break;
			}
			case EventType.WAIT_COMPLETE: {
				const step = stepMap.get(key);
				if (step) {
					step.endIndex = i;
					step.status = "success";
					step.output =
						(meta as Record<string, unknown>)?.payload ?? null;
				}
				break;
			}
			case EventType.WAIT_TIMED_OUT: {
				const step = stepMap.get(key);
				if (step) {
					step.endIndex = i;
					step.status = "failure";
					step.error = {
						name: "TimeoutError",
						message: "Wait timed out",
					};
				}
				break;
			}
		}
	}

	// Return steps in order
	return stepOrder
		.map((key) => stepMap.get(key)!)
		.filter(Boolean);
}

function countSteps(
	states: Array<{ event: number }>
): number {
	return states.filter(
		(s) =>
			s.event === EventType.STEP_START ||
			s.event === EventType.SLEEP_START ||
			s.event === EventType.WAIT_START
	).length;
}

function tryParseJSON(str: string): unknown {
	try {
		return JSON.parse(str);
	} catch {
		return str;
	}
}
