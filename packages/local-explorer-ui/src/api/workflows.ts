/**
 * Manual API client for workflow endpoints.
 * These endpoints are not in the OpenAPI spec yet, so we define them manually.
 */

const BASE = import.meta.env.VITE_LOCAL_EXPLORER_API_PATH ?? "/cdn-cgi/explorer/api";

async function fetchJSON<T>(url: string, init?: RequestInit): Promise<T> {
	const response = await fetch(`${BASE}${url}`, {
		...init,
		headers: {
			"Content-Type": "application/json",
			...init?.headers,
		},
	});
	if (!response.ok) {
		const error = await response.json().catch(() => ({ errors: [{ message: response.statusText }] }));
		throw new Error(
			(error as { errors?: Array<{ message: string }> }).errors?.[0]?.message ?? `HTTP ${response.status}`
		);
	}
	return response.json() as Promise<T>;
}

// Types

export interface WorkflowDefinition {
	id: string;
	name: string;
	class_name: string;
	script_name: string;
}

export interface WorkflowInstance {
	id: string;
	hash: string;
	status: string;
	output: unknown;
	error: unknown;
	params: unknown;
	created_on: string | null;
	step_count: number;
}

export interface TimelineStep {
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

export interface RawState {
	id: number;
	event: number;
	groupKey: string | null;
	target: string | null;
	metadata: unknown;
}

export interface WorkflowInstanceDetail {
	id: string;
	hash: string;
	status: string;
	output: unknown;
	error: unknown;
	params: unknown;
	created_on: string | null;
	timeline: TimelineStep[];
	raw_states: RawState[];
}

interface APIResponse<T> {
	success: boolean;
	result: T;
	errors: Array<{ code: number; message: string }>;
	messages: Array<{ code: number; message: string }>;
	result_info?: {
		count: number;
		cursor?: string;
	};
}

// API Functions

export async function listWorkflows(): Promise<WorkflowDefinition[]> {
	const data = await fetchJSON<APIResponse<WorkflowDefinition[]>>("/workflows");
	return data.result ?? [];
}

export async function listWorkflowInstances(
	workflowName: string
): Promise<WorkflowInstance[]> {
	const data = await fetchJSON<APIResponse<WorkflowInstance[]>>(
		`/workflows/${encodeURIComponent(workflowName)}/instances`
	);
	return data.result ?? [];
}

export async function getWorkflowInstance(
	workflowName: string,
	instanceId: string
): Promise<WorkflowInstanceDetail> {
	const data = await fetchJSON<APIResponse<WorkflowInstanceDetail>>(
		`/workflows/${encodeURIComponent(workflowName)}/instances/${encodeURIComponent(instanceId)}`
	);
	return data.result;
}

export async function triggerWorkflow(
	workflowName: string,
	params?: { id?: string; params?: unknown }
): Promise<{ id: string }> {
	const data = await fetchJSON<APIResponse<{ id: string }>>(
		`/workflows/${encodeURIComponent(workflowName)}/trigger`,
		{
			method: "POST",
			body: JSON.stringify(params ?? {}),
		}
	);
	return data.result;
}

export async function sendWorkflowEvent(
	workflowName: string,
	instanceId: string,
	event: { type: string; payload: unknown }
): Promise<void> {
	await fetchJSON<APIResponse<{ success: boolean }>>(
		`/workflows/${encodeURIComponent(workflowName)}/instances/${encodeURIComponent(instanceId)}/events`,
		{
			method: "POST",
			body: JSON.stringify(event),
		}
	);
}
