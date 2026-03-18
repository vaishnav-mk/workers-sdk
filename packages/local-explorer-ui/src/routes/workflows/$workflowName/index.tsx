import { Button } from "@base-ui/react/button";
import {
	ArrowsCounterClockwiseIcon,
	CheckCircleIcon,
	ClockIcon,
	GitBranchIcon,
	HourglassIcon,
	PaperPlaneIcon,
	SpinnerIcon,
	WarningCircleIcon,
	XCircleIcon,
} from "@phosphor-icons/react";
import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { listWorkflowInstances, triggerWorkflow } from "../../../api/workflows";
import { Breadcrumbs } from "../../../components/Breadcrumbs";
import { JsonViewer } from "../../../components/JsonViewer";
import type { WorkflowInstance } from "../../../api/workflows";

function formatTimestamp(iso: string): string {
	try {
		const d = new Date(iso);
		return d.toLocaleString(undefined, {
			month: "short",
			day: "numeric",
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
			hour12: false,
		});
	} catch {
		return iso;
	}
}

export const Route = createFileRoute("/workflows/$workflowName/")({
	component: WorkflowInstancesView,
	loader: async ({ params }) => {
		const instances = await listWorkflowInstances(params.workflowName);
		return { instances };
	},
});

function StatusBadge({ status }: { status: string }) {
	const config: Record<
		string,
		{ icon: typeof CheckCircleIcon; className: string; label: string }
	> = {
		complete: {
			icon: CheckCircleIcon,
			className: "bg-success/12 text-success border-success/20",
			label: "Complete",
		},
		running: {
			icon: SpinnerIcon,
			className: "bg-primary/12 text-primary border-primary/20",
			label: "Running",
		},
		queued: {
			icon: ClockIcon,
			className: "bg-muted/12 text-muted border-muted/20",
			label: "Queued",
		},
		errored: {
			icon: XCircleIcon,
			className: "bg-danger/12 text-danger border-danger/20",
			label: "Errored",
		},
		terminated: {
			icon: WarningCircleIcon,
			className: "bg-danger/12 text-danger border-danger/20",
			label: "Terminated",
		},
		unknown: {
			icon: HourglassIcon,
			className: "bg-muted/12 text-muted border-muted/20",
			label: "Unknown",
		},
	};

	const c = config[status] ?? config.unknown;
	const Icon = c.icon;

	return (
		<span
			className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full border ${c.className}`}
		>
			<Icon
				className={status === "running" ? "animate-spin" : undefined}
				size={12}
				weight="bold"
			/>
			{c.label}
		</span>
	);
}

function TriggerModal({
	onClose,
	onTrigger,
}: {
	onClose: () => void;
	onTrigger: (id: string, params: string) => void;
}) {
	const [id, setId] = useState("");
	const [params, setParams] = useState("{}");

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
			<div className="bg-bg border border-border rounded-xl shadow-xl w-full max-w-md">
				<div className="flex items-center justify-between px-5 py-4 border-b border-border">
					<h3 className="text-base font-semibold text-text">
						Trigger Workflow
					</h3>
					<button
						className="text-text-secondary hover:text-text cursor-pointer"
						onClick={onClose}
						type="button"
					>
						&times;
					</button>
				</div>
				<div className="px-5 py-4 space-y-4">
					<div>
						<label className="block text-xs font-medium text-text-secondary mb-1.5">
							Instance ID (optional)
						</label>
						<input
							className="w-full px-3 py-2 text-sm bg-bg-secondary border border-border rounded-lg text-text placeholder:text-muted focus:outline-none focus:border-primary focus:shadow-focus-primary"
							onChange={(e) => setId(e.target.value)}
							placeholder="Auto-generated UUID"
							type="text"
							value={id}
						/>
					</div>
					<div>
						<label className="block text-xs font-medium text-text-secondary mb-1.5">
							Params (JSON)
						</label>
						<textarea
							className="w-full px-3 py-2 text-sm bg-bg-secondary border border-border rounded-lg text-text font-mono placeholder:text-muted focus:outline-none focus:border-primary focus:shadow-focus-primary resize-none"
							onChange={(e) => setParams(e.target.value)}
							placeholder="{}"
							rows={5}
							value={params}
						/>
					</div>
				</div>
				<div className="flex justify-end gap-2 px-5 py-4 border-t border-border">
					<button
						className="px-4 py-2 text-sm font-medium text-text-secondary bg-bg-tertiary border border-border rounded-full hover:bg-border cursor-pointer transition-colors"
						onClick={onClose}
						type="button"
					>
						Cancel
					</button>
					<button
						className="px-4 py-2 text-sm font-medium text-white bg-primary rounded-full hover:bg-primary-hover cursor-pointer transition-colors"
						onClick={() => onTrigger(id, params)}
						type="button"
					>
						Trigger
					</button>
				</div>
			</div>
		</div>
	);
}

function WorkflowInstancesView() {
	const params = Route.useParams();
	const loaderData = Route.useLoaderData();
	const router = useRouter();
	const navigate = useNavigate();

	const [instances, setInstances] = useState<WorkflowInstance[]>(
		loaderData.instances
	);
	const [isRefreshing, setIsRefreshing] = useState(false);
	const [showTrigger, setShowTrigger] = useState(false);
	const [triggerError, setTriggerError] = useState<string | null>(null);

	useEffect(() => {
		setInstances(loaderData.instances);
	}, [loaderData]);

	const handleRefresh = useCallback(async () => {
		setIsRefreshing(true);
		try {
			await Promise.all([
				router.invalidate(),
				new Promise((resolve) => setTimeout(resolve, 300)),
			]);
		} finally {
			setIsRefreshing(false);
		}
	}, [router]);

	const handleTrigger = useCallback(
		async (id: string, paramsJson: string) => {
			try {
				setTriggerError(null);
				let parsedParams: unknown = {};
				try {
					parsedParams = JSON.parse(paramsJson);
				} catch {
					setTriggerError("Invalid JSON params");
					return;
				}
				const result = await triggerWorkflow(params.workflowName, {
					id: id || undefined,
					params: parsedParams,
				});
				setShowTrigger(false);

				// Wait briefly for the instance to become visible, then navigate to it
				await new Promise((resolve) => setTimeout(resolve, 800));

				// Try to find the instance by the returned UUID in the refreshed list
				const freshInstances = await listWorkflowInstances(params.workflowName);
				const match = freshInstances.find(
					(inst) => inst.id === result.id
				);
				const navId = match?.hash || match?.id || result.id;

				void navigate({
					to: "/workflows/$workflowName/$instanceId",
					params: { workflowName: params.workflowName, instanceId: navId },
				});
			} catch (err) {
				setTriggerError(
					err instanceof Error ? err.message : "Failed to trigger"
				);
			}
		},
		[params.workflowName, navigate]
	);

	return (
		<>
			<Breadcrumbs
				icon={GitBranchIcon}
				items={[
					<span className="flex items-center gap-1.5" key="wf-name">
						{params.workflowName}
					</span>,
				]}
				title="Workflows"
			>
				<div className="flex-1" />

				<Button
					className="inline-flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-medium rounded-full cursor-pointer transition-[background-color,transform] active:translate-y-px bg-bg-tertiary text-text border border-border hover:bg-border disabled:cursor-progress"
					disabled={isRefreshing}
					onClick={handleRefresh}
				>
					<ArrowsCounterClockwiseIcon
						className={isRefreshing ? "animate-spin" : undefined}
						size={14}
					/>
					Refresh
				</Button>

				<button
					className="inline-flex items-center justify-center gap-1.5 py-2 px-4 text-xs font-medium rounded-full cursor-pointer transition-colors bg-primary text-white hover:bg-primary-hover"
					onClick={() => setShowTrigger(true)}
					type="button"
				>
					<PaperPlaneIcon size={14} weight="bold" />
					Trigger
				</button>
			</Breadcrumbs>

			{showTrigger && (
				<TriggerModal
					onClose={() => {
						setShowTrigger(false);
						setTriggerError(null);
					}}
					onTrigger={handleTrigger}
				/>
			)}

			<div className="px-6 py-6">
				{triggerError && (
					<div className="text-danger p-4 bg-danger/8 border border-danger/20 rounded-md mb-4">
						{triggerError}
					</div>
				)}

				{instances.length === 0 ? (
					<div className="text-center p-12 text-text-secondary space-y-3 flex flex-col items-center justify-center">
						<GitBranchIcon className="w-12 h-12 text-muted" />
						<h2 className="text-2xl font-medium text-text">
							No workflow instances
						</h2>
						<p className="text-sm font-light max-w-sm">
							Trigger a new instance to see it here. Instances will
							appear with their execution timeline and step details.
						</p>
						<button
							className="mt-4 inline-flex items-center justify-center gap-1.5 py-2.5 px-5 text-sm font-medium rounded-full cursor-pointer transition-colors bg-primary text-white hover:bg-primary-hover"
							onClick={() => setShowTrigger(true)}
							type="button"
						>
							<PaperPlaneIcon size={14} weight="bold" />
							Trigger Workflow
						</button>
					</div>
				) : (
					<div className="space-y-3">
						{instances.map((inst) => {
							// Use hash for URL navigation (it's the stable DO identifier)
							const navId = inst.hash || inst.id;
							return (
								<Link
									className="block rounded-xl border border-border bg-bg p-5 hover:border-primary/40 hover:shadow-[0_0_0_1px_rgba(255,72,1,0.1)] transition-all cursor-pointer group"
									key={navId}
									params={{
										instanceId: navId,
										workflowName: params.workflowName,
									}}
									to="/workflows/$workflowName/$instanceId"
								>
									<div className="relative">
										<div className="flex items-center justify-between">
											<div className="flex items-center gap-3">
												<StatusBadge status={inst.status} />
												<span className="font-mono text-xs text-text-secondary truncate max-w-64" title={inst.id}>
													{inst.id}
												</span>
											</div>
											<div className="flex items-center gap-4 text-xs text-muted shrink-0">
												{inst.created_on && (
													<span className="text-[11px]" title={inst.created_on}>
														{formatTimestamp(inst.created_on)}
													</span>
												)}
												<span className="font-mono text-[11px]">
													{inst.step_count}{" "}
													{inst.step_count === 1 ? "step" : "steps"}
												</span>
												<span className="text-primary opacity-0 group-hover:opacity-100 transition-opacity font-medium">
													View &rarr;
												</span>
											</div>
										</div>

										{inst.error ? (
											<div className="mt-3.5 p-3 rounded-lg bg-danger/5 border border-danger/10">
												<p className="text-xs font-mono text-danger truncate">
													{typeof inst.error === "object" &&
													inst.error !== null &&
													"message" in inst.error
														? (
																inst.error as {
																	message: string;
																}
															).message
														: String(inst.error)}
												</p>
											</div>
										) : null}

										{inst.output !== null &&
										inst.output !== undefined &&
										inst.status === "complete" ? (
											<div
												className="mt-3.5"
												onClick={(e) => e.preventDefault()}
											>
												<JsonViewer
													data={inst.output}
													variant="success"
													maxHeight="max-h-24"
													defaultExpandDepth={1}
													copyable={false}
												/>
											</div>
										) : null}
									</div>
								</Link>
							);
						})}
					</div>
				)}
			</div>
		</>
	);
}
