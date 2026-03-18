import { Button } from "@base-ui/react/button";
import { Select } from "@base-ui/react/select";
import {
	ArrowsCounterClockwiseIcon,
	CaretDownIcon,
	CaretRightIcon,
	CaretUpDownIcon,
	CheckCircleIcon,
	CheckIcon,
	ClockIcon,
	CodeIcon,
	EnvelopeIcon,
	GitBranchIcon,
	HourglassIcon,
	LightningIcon,
	PaperPlaneIcon,
	SpinnerIcon,
	TimerIcon,
	WarningCircleIcon,
	XCircleIcon,
} from "@phosphor-icons/react";
import {
	createFileRoute,
	Link,
	useNavigate,
	useRouter,
} from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	getWorkflowInstance,
	listWorkflowInstances,
	sendWorkflowEvent,
} from "../../../api/workflows";
import { Breadcrumbs } from "../../../components/Breadcrumbs";
import { JsonViewer } from "../../../components/JsonViewer";
import type {
	TimelineStep,
	WorkflowInstance,
	WorkflowInstanceDetail,
	RawState,
} from "../../../api/workflows";
import type { FC, ReactNode } from "react";

export const Route = createFileRoute(
	"/workflows/$workflowName/$instanceId"
)({
	component: WorkflowInstanceDetailView,
	loader: async ({ params }) => {
		const [detail, siblings] = await Promise.all([
			getWorkflowInstance(params.workflowName, params.instanceId),
			listWorkflowInstances(params.workflowName),
		]);
		return { detail, siblings };
	},
});

// ============================================================================
// Status config
// ============================================================================

interface StatusInfo {
	icon: FC<{ size?: number; weight?: string; className?: string }>;
	color: string;
	bg: string;
	label: string;
}

const statusConfig: Record<string, StatusInfo> = {
	complete: { icon: CheckCircleIcon, color: "text-success", bg: "bg-success", label: "Complete" },
	running: { icon: SpinnerIcon, color: "text-primary", bg: "bg-primary", label: "Running" },
	queued: { icon: ClockIcon, color: "text-muted", bg: "bg-muted", label: "Queued" },
	errored: { icon: XCircleIcon, color: "text-danger", bg: "bg-danger", label: "Errored" },
	terminated: { icon: WarningCircleIcon, color: "text-danger", bg: "bg-danger", label: "Terminated" },
	unknown: { icon: HourglassIcon, color: "text-muted", bg: "bg-muted", label: "Unknown" },
	success: { icon: CheckCircleIcon, color: "text-success", bg: "bg-success", label: "Success" },
	failure: { icon: XCircleIcon, color: "text-danger", bg: "bg-danger", label: "Failed" },
	waiting: { icon: HourglassIcon, color: "text-primary", bg: "bg-primary", label: "Waiting" },
	sleeping: { icon: ClockIcon, color: "text-muted", bg: "bg-muted", label: "Sleeping" },
};

function getStatus(status: string): StatusInfo {
	return statusConfig[status] ?? statusConfig.unknown;
}

// ============================================================================
// Event type config
// ============================================================================

interface EventInfo {
	label: string;
	shortLabel: string;
	color: string;
	bg: string;
	category: "workflow" | "step" | "sleep" | "attempt" | "wait";
}

const eventConfig: Record<number, EventInfo> = {
	0: { label: "Workflow Queued", shortLabel: "QUEUED", color: "text-muted", bg: "bg-muted", category: "workflow" },
	1: { label: "Workflow Started", shortLabel: "START", color: "text-primary", bg: "bg-primary", category: "workflow" },
	2: { label: "Workflow Success", shortLabel: "SUCCESS", color: "text-success", bg: "bg-success", category: "workflow" },
	3: { label: "Workflow Failure", shortLabel: "FAILURE", color: "text-danger", bg: "bg-danger", category: "workflow" },
	4: { label: "Workflow Terminated", shortLabel: "TERMINATED", color: "text-danger", bg: "bg-danger", category: "workflow" },
	5: { label: "Step Start", shortLabel: "START", color: "text-primary", bg: "bg-primary", category: "step" },
	6: { label: "Step Success", shortLabel: "SUCCESS", color: "text-success", bg: "bg-success", category: "step" },
	7: { label: "Step Failure", shortLabel: "FAILURE", color: "text-danger", bg: "bg-danger", category: "step" },
	8: { label: "Sleep Start", shortLabel: "START", color: "text-muted", bg: "bg-muted", category: "sleep" },
	9: { label: "Sleep Complete", shortLabel: "COMPLETE", color: "text-success", bg: "bg-success", category: "sleep" },
	10: { label: "Attempt Start", shortLabel: "START", color: "text-text-secondary", bg: "bg-muted", category: "attempt" },
	11: { label: "Attempt Success", shortLabel: "SUCCESS", color: "text-success", bg: "bg-success", category: "attempt" },
	12: { label: "Attempt Failure", shortLabel: "FAILURE", color: "text-danger", bg: "bg-danger", category: "attempt" },
	14: { label: "Wait Start", shortLabel: "WAITING", color: "text-primary", bg: "bg-primary", category: "wait" },
	15: { label: "Wait Complete", shortLabel: "RECEIVED", color: "text-success", bg: "bg-success", category: "wait" },
	16: { label: "Wait Timed Out", shortLabel: "TIMED OUT", color: "text-danger", bg: "bg-danger", category: "wait" },
};

function getEventInfo(event: number): EventInfo {
	return eventConfig[event] ?? { label: `Event ${event}`, shortLabel: `E${event}`, color: "text-muted", bg: "bg-muted", category: "workflow" as const };
}

// ============================================================================
// Shared UI components
// ============================================================================

function StatusBadge({ status, size = "sm" }: { status: string; size?: "sm" | "lg" }) {
	const c = getStatus(status);
	const Icon = c.icon;
	const cls = size === "lg" ? "px-3 py-1.5 text-xs gap-1.5" : "px-2 py-0.5 text-[11px] gap-1";
	return (
		<span className={`inline-flex items-center ${cls} font-medium rounded-full ${c.bg}/10 ${c.color} border border-current/15`}>
			<Icon className={status === "running" ? "animate-spin" : undefined} size={size === "lg" ? 13 : 11} />
			{c.label}
		</span>
	);
}

function InfoPill({ children, className = "" }: { children: ReactNode; className?: string }) {
	return (
		<span className={`inline-flex items-center gap-1 text-[11px] bg-bg-secondary border border-border rounded-md px-2 py-0.5 ${className}`}>
			{children}
		</span>
	);
}

// ============================================================================
// Step metadata extraction
// ============================================================================

interface StepMeta {
	sleepDurationMs: number | null;
	waitEventName: string | null;
	retryLimit: number | null;
	retryDelay: string | null;
	retryBackoff: string | null;
	timeout: string | null;
	eventSpan: number;
	failedAttempts: number;
	outputPreview: string | null;
}

function extractStepMeta(step: TimelineStep): StepMeta {
	const cfg = (step.config && typeof step.config === "object" ? step.config : {}) as Record<string, unknown>;
	const retries = (cfg.retries && typeof cfg.retries === "object" ? cfg.retries : null) as Record<string, unknown> | null;

	let sleepDurationMs: number | null = null;
	if ("durationMs" in cfg && typeof cfg.durationMs === "number") {
		sleepDurationMs = cfg.durationMs;
	}

	let waitEventName: string | null = null;
	if ("event" in cfg && typeof cfg.event === "string") {
		waitEventName = cfg.event;
	}

	let outputPreview: string | null = null;
	if (step.output !== null && step.output !== undefined) {
		const s = typeof step.output === "string" ? step.output : JSON.stringify(step.output);
		outputPreview = s.length > 60 ? s.slice(0, 57) + "..." : s;
	}

	return {
		sleepDurationMs,
		waitEventName,
		retryLimit: retries && typeof retries.limit === "number" ? retries.limit : null,
		retryDelay: retries ? (typeof retries.delay === "number" ? formatMs(retries.delay) : String(retries.delay ?? "")) : null,
		retryBackoff: retries && typeof retries.backoff === "string" ? retries.backoff : null,
		timeout: "timeout" in cfg && cfg.timeout ? String(cfg.timeout) : null,
		eventSpan: step.endIndex !== null ? step.endIndex - step.startIndex : 0,
		failedAttempts: step.attempts.filter(a => a.status === "failure").length,
		outputPreview,
	};
}

function formatMs(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
	const mins = Math.floor(ms / 60000);
	const secs = Math.round((ms % 60000) / 1000);
	return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
}

function formatTimestamp(iso: string): string {
	try {
		return new Date(iso).toLocaleString(undefined, {
			month: "short", day: "numeric",
			hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
		});
	} catch { return iso; }
}

function cleanStepName(name: string): string {
	return name.replace(/-\d+$/, "");
}

// ============================================================================
// Send Event Modal
// ============================================================================

function SendEventModal({ onClose, onSend, initialType }: { onClose: () => void; onSend: (type: string, payload: string) => void; initialType?: string }) {
	const [type, setType] = useState(initialType ?? "");
	const [payload, setPayload] = useState("{}");
	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
			<div className="bg-bg border border-border rounded-xl shadow-xl w-full max-w-md">
				<div className="flex items-center justify-between px-5 py-4 border-b border-border">
					<h3 className="text-sm font-semibold text-text">Send Event</h3>
					<button className="text-text-secondary hover:text-text cursor-pointer" onClick={onClose} type="button">&times;</button>
				</div>
				<div className="px-5 py-4 space-y-4">
					<div>
						<label className="block text-xs font-medium text-text-secondary mb-1.5">Event Type</label>
						<input className="w-full px-3 py-2 text-sm bg-bg-secondary border border-border rounded-lg text-text placeholder:text-muted focus:outline-none focus:border-primary focus:shadow-focus-primary" onChange={(e) => setType(e.target.value)} placeholder="e.g. warehouse_confirmed" type="text" value={type} />
					</div>
					<div>
						<label className="block text-xs font-medium text-text-secondary mb-1.5">Payload (JSON)</label>
						<textarea className="w-full px-3 py-2 text-sm bg-bg-secondary border border-border rounded-lg text-text font-mono placeholder:text-muted focus:outline-none focus:border-primary focus:shadow-focus-primary resize-none" onChange={(e) => setPayload(e.target.value)} placeholder="{}" rows={5} value={payload} />
					</div>
				</div>
				<div className="flex justify-end gap-2 px-5 py-4 border-t border-border">
					<button className="px-4 py-2 text-sm font-medium text-text-secondary bg-bg-tertiary border border-border rounded-full hover:bg-border cursor-pointer transition-colors" onClick={onClose} type="button">Cancel</button>
					<button className="px-4 py-2 text-sm font-medium text-white bg-primary rounded-full hover:bg-primary-hover cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed" disabled={!type.trim()} onClick={() => onSend(type, payload)} type="button">Send Event</button>
				</div>
			</div>
		</div>
	);
}

// ============================================================================
// Waterfall Timeline — full revamp
// ============================================================================

// Step type color system — bars are colored by type, failure overrides
const typeBarColors: Record<string, { bar: string; border: string; minimap: string }> = {
	step: { bar: "bg-primary/10", border: "border-primary/25", minimap: "#ff4801" },
	sleep: { bar: "bg-muted/10", border: "border-muted/20", minimap: "#71717a" },
	wait: { bar: "bg-[#7c3aed]/10", border: "border-[#7c3aed]/20", minimap: "#7c3aed" },
};

function getBarClasses(type: string, status: string): string {
	if (status === "failure") return "bg-danger/25 border-danger/35";
	const tc = typeBarColors[type] ?? typeBarColors.step;
	return `${tc.bar} ${tc.border}`;
}

function getMinimapColor(type: string, status: string): string {
	if (status === "failure") return "#fb2c36";
	return (typeBarColors[type] ?? typeBarColors.step).minimap;
}

function attemptBarColor(status: string): string {
	if (status === "failure") return "bg-danger/60";
	if (status === "success") return "bg-success/50";
	return "bg-primary/30";
}

// Step type labels used in legend and tooltip
const stepTypeLabels: Record<string, { label: string; dotClass: string }> = {
	step: { label: "step.do", dotClass: "bg-primary" },
	sleep: { label: "step.sleep", dotClass: "bg-muted" },
	wait: { label: "waitForEvent", dotClass: "bg-[#7c3aed]" },
};

function WaterfallTimeline({ timeline, rawStates, createdOn, onSendEvent }: { timeline: TimelineStep[]; rawStates: RawState[]; createdOn: string | null; onSendEvent?: (eventType: string) => void }) {
	const [expandedStep, setExpandedStep] = useState<string | null>(null);
	const [hoveredStep, setHoveredStep] = useState<number | null>(null);
	const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
	const barAreaRef = useRef<HTMLDivElement>(null);
	const stepsContainerRef = useRef<HTMLDivElement>(null);
	const [cursorPx, setCursorPx] = useState<number | null>(null);

	// Zoom state: [0, 1] range
	const [zoomStart, setZoomStart] = useState(0);
	const [zoomEnd, setZoomEnd] = useState(1);
	const sliderRef = useRef<HTMLDivElement>(null);
	const dragging = useRef<"left" | "right" | "range" | null>(null);
	const dragOrigin = useRef({ x: 0, start: 0, end: 1 });

	if (timeline.length === 0) {
		return (
			<div className="flex flex-col items-center justify-center py-12 text-text-secondary">
				<ClockIcon size={32} className="text-muted mb-3" />
				<p className="text-sm">No steps recorded yet</p>
			</div>
		);
	}

	const maxIdx = Math.max(...timeline.map(s => s.endIndex ?? s.startIndex + 1), ...timeline.map(s => s.startIndex));
	const span = maxIdx + 1;

	// Visible range
	const vStart = zoomStart * span;
	const vEnd = zoomEnd * span;
	const vSpan = vEnd - vStart;
	const isZoomed = zoomStart > 0.005 || zoomEnd < 0.995;

	// ---- Slider drag handlers ----
	const handleSliderMouseDown = useCallback((e: React.MouseEvent, handle: "left" | "right" | "range") => {
		e.preventDefault();
		dragging.current = handle;
		dragOrigin.current = { x: e.clientX, start: zoomStart, end: zoomEnd };
		const onMove = (ev: MouseEvent) => {
			const slider = sliderRef.current;
			if (!slider || !dragging.current) return;
			const rect = slider.getBoundingClientRect();
			const dx = (ev.clientX - dragOrigin.current.x) / rect.width;

			if (dragging.current === "left") {
				setZoomStart(Math.max(0, Math.min(dragOrigin.current.end - 0.02, dragOrigin.current.start + dx)));
			} else if (dragging.current === "right") {
				setZoomEnd(Math.min(1, Math.max(dragOrigin.current.start + 0.02, dragOrigin.current.end + dx)));
			} else {
				const range = dragOrigin.current.end - dragOrigin.current.start;
				let ns = dragOrigin.current.start + dx;
				let ne = dragOrigin.current.end + dx;
				if (ns < 0) { ne -= ns; ns = 0; }
				if (ne > 1) { ns -= ne - 1; ne = 1; }
				setZoomStart(Math.max(0, ns));
				setZoomEnd(Math.min(1, ne));
			}
		};
		const onUp = () => {
			dragging.current = null;
			window.removeEventListener("mousemove", onMove);
			window.removeEventListener("mouseup", onUp);
		};
		window.addEventListener("mousemove", onMove);
		window.addEventListener("mouseup", onUp);
	}, [zoomStart, zoomEnd]);

	// ---- Scroll-to-zoom on bar area ----
	const handleBarWheel = useCallback((e: React.WheelEvent) => {
		if (!e.ctrlKey && !e.metaKey) return;
		e.preventDefault();
		const container = barAreaRef.current;
		if (!container) return;
		const rect = container.getBoundingClientRect();
		const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
		const factor = e.deltaY > 0 ? 1.15 : 0.87;
		const range = zoomEnd - zoomStart;
		const newRange = Math.max(0.03, Math.min(1, range * factor));
		const cursor = zoomStart + frac * range;
		let ns = cursor - frac * newRange;
		let ne = cursor + (1 - frac) * newRange;
		if (ns < 0) { ne -= ns; ns = 0; }
		if (ne > 1) { ns -= ne - 1; ne = 1; }
		setZoomStart(Math.max(0, ns));
		setZoomEnd(Math.min(1, ne));
	}, [zoomStart, zoomEnd]);

	const hoveredStepData = hoveredStep !== null ? timeline[hoveredStep] : null;
	const hoveredMeta = hoveredStepData ? extractStepMeta(hoveredStepData) : null;

	// ---- Minimap ticks for the slider (show step positions) ----
	const minimapBars = timeline.map((step, i) => {
		const left = (step.startIndex / span) * 100;
		const end = step.endIndex ?? step.startIndex + 0.5;
		const width = Math.max(((end - step.startIndex) / span) * 100, 0.5);
		const color = getMinimapColor(step.type, step.status);
		return <div key={i} className="absolute top-0 bottom-0 rounded-sm opacity-60" style={{ left: `${left}%`, width: `${width}%`, backgroundColor: color }} />;
	});

	// Count step types for legend
	const typeCounts = { step: 0, sleep: 0, wait: 0 };
	for (const s of timeline) {
		if (s.type in typeCounts) { typeCounts[s.type as keyof typeof typeCounts]++; }
	}

	return (
		<div>
			{/* ---- Legend + Zoom row ---- */}
			<div className="px-6 py-3 border-b border-border bg-bg flex items-center gap-4">
				{/* Legend */}
				<div className="flex items-center gap-3 shrink-0">
					{(["step", "sleep", "wait"] as const).map(t => {
						const tc = stepTypeLabels[t];
						const count = typeCounts[t];
						if (count === 0) return null;
						return (
							<span key={t} className="inline-flex items-center gap-1.5 text-[10px] text-text-secondary">
								<span className={`w-2.5 h-2.5 rounded-sm ${tc.dotClass}`} />
								<span className="font-mono">{tc.label}</span>
								<span className="text-muted">({count})</span>
							</span>
						);
					})}
					<span className="inline-flex items-center gap-1.5 text-[10px] text-text-secondary">
						<span className="w-2.5 h-2.5 rounded-sm bg-danger" />
						<span>failed</span>
					</span>
				</div>

				<span className="w-px h-4 bg-border/50" />

				{/* Zoom controls */}
				<span className="text-[10px] text-muted uppercase tracking-wider font-semibold shrink-0">
					Zoom
				</span>
				<div ref={sliderRef} className="flex-1 relative h-5 select-none min-w-24">
					<div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-2 bg-bg-secondary rounded-full border border-border overflow-hidden">
						{minimapBars}
					</div>
					<div
						className="absolute top-1/2 -translate-y-1/2 h-2 bg-primary/15 border-y border-primary/25 cursor-grab active:cursor-grabbing"
						style={{ left: `${zoomStart * 100}%`, width: `${(zoomEnd - zoomStart) * 100}%` }}
						onMouseDown={(e) => handleSliderMouseDown(e, "range")}
					/>
					<div
						className="absolute top-1/2 -translate-y-1/2 w-2 h-4 rounded-sm bg-primary border border-primary-hover shadow-sm cursor-ew-resize z-10 -ml-1"
						style={{ left: `${zoomStart * 100}%` }}
						onMouseDown={(e) => handleSliderMouseDown(e, "left")}
					/>
					<div
						className="absolute top-1/2 -translate-y-1/2 w-2 h-4 rounded-sm bg-primary border border-primary-hover shadow-sm cursor-ew-resize z-10 -ml-1"
						style={{ left: `${zoomEnd * 100}%` }}
						onMouseDown={(e) => handleSliderMouseDown(e, "right")}
					/>
				</div>
				{isZoomed && (
					<button className="text-[10px] text-primary hover:text-primary-hover font-medium cursor-pointer bg-transparent border-none shrink-0" onClick={() => { setZoomStart(0); setZoomEnd(1); }} type="button">
						Reset
					</button>
				)}
				<span className="text-[10px] text-muted font-mono tabular-nums shrink-0 w-7 text-right">
					{Math.round((zoomEnd - zoomStart) * 100)}%
				</span>
			</div>

			{/* ---- Step boundary ruler ---- */}
			<div className="px-6 flex border-b border-border bg-bg-secondary/50" ref={barAreaRef} onWheel={handleBarWheel}>
				<div className="shrink-0 w-[280px]" />
				<div className="flex-1 relative h-4 overflow-hidden">
					{timeline.map((step, i) => {
						const stepStart = ((step.startIndex - vStart) / vSpan) * 100;
						const stepEnd = (((step.endIndex ?? step.startIndex + 0.5) - vStart) / vSpan) * 100;
						const midPct = (stepStart + stepEnd) / 2;
						if (midPct < -5 || midPct > 105) return null;
						const typeDot = stepTypeLabels[step.type] ?? stepTypeLabels.step;
						return (
							<span key={i} className="absolute top-0 bottom-0 flex items-center" style={{ left: `${stepStart}%` }}>
								<span className={`w-px h-full ${typeDot.dotClass} opacity-20`} />
								<span className="text-[8px] font-mono text-muted/60 ml-0.5 whitespace-nowrap">{i + 1}</span>
							</span>
						);
					})}
				</div>
			</div>

			{/* ---- Step rows ---- */}
			<div className="divide-y divide-border relative" ref={stepsContainerRef} onMouseLeave={() => setCursorPx(null)}>
				{/* Vertical cursor line */}
				{cursorPx !== null && (
					<div
						className="absolute top-0 bottom-0 w-px bg-text/15 pointer-events-none z-[60]"
						style={{ left: `${cursorPx}px` }}
					/>
				)}
				{timeline.map((step, i) => {
					const sc = getStatus(step.status);
					const Icon = sc.icon;
					const stepKey = step.groupKey ?? `step-${i}`;
					const isExpanded = expandedStep === stepKey;
					const meta = extractStepMeta(step);
					const isActive = step.status === "running" || step.status === "waiting" || step.status === "sleeping";
					const displayName = cleanStepName(step.name);
					const typeDot = stepTypeLabels[step.type] ?? stepTypeLabels.step;

					// Bar geometry
					const startPct = ((step.startIndex - vStart) / vSpan) * 100;
					const endIdx = step.endIndex ?? step.startIndex + 0.5;
					const widthPct = Math.max(((endIdx - step.startIndex) / vSpan) * 100, 1.5);

					return (
						<div key={stepKey}>
							<button
								className={`flex items-center w-full gap-0 text-left transition-colors cursor-pointer ${isExpanded ? "bg-primary/4" : "hover:bg-bg-secondary/70"}`}
								onClick={() => setExpandedStep(isExpanded ? null : stepKey)}
								type="button"
							onMouseEnter={() => setHoveredStep(i)}
							onMouseLeave={() => { setHoveredStep(null); setCursorPx(null); }}
							onMouseMove={(e) => {
								setTooltipPos({ x: e.clientX, y: e.clientY });
								const container = stepsContainerRef.current;
								if (!container) return;
								const rect = container.getBoundingClientRect();
								const px = e.clientX - rect.left;
								if (px > 280 && px < rect.width) {
									setCursorPx(px);
								} else {
									setCursorPx(null);
								}
							}}
							>
								{/* ---- Left: step info (clean) ---- */}
								<div className="shrink-0 w-[280px] flex items-center gap-2.5 px-4 py-3 border-r border-border">
									{/* Step number with type-colored left bar */}
									<span className={`w-5 h-5 rounded-md border flex items-center justify-center text-[10px] font-semibold shrink-0 ${
										step.status === "failure" ? "bg-danger/8 border-danger/20 text-danger" : "bg-bg-secondary border-border text-text-secondary"
									}`}>
										{i + 1}
									</span>

									{/* Type color dot */}
									<span className={`w-1.5 h-1.5 rounded-full shrink-0 ${step.status === "failure" ? "bg-danger" : typeDot.dotClass}`} />

									{/* Name */}
									<div className="flex flex-col min-w-0 flex-1">
										<span className="text-xs font-medium text-text truncate">
											{displayName}
										</span>
										{/* Compact secondary info */}
										<div className="flex items-center gap-2 mt-0.5">
											{meta.sleepDurationMs !== null && (
												<span className="text-[9px] font-mono text-muted">{formatMs(meta.sleepDurationMs)}</span>
											)}
											{meta.waitEventName && (
												<span className="text-[9px] font-mono text-muted truncate max-w-24">{meta.waitEventName}</span>
											)}
											{step.attempts.length > 1 && (
												<span className="text-[9px] font-mono text-muted">
													{step.attempts.length}x{meta.failedAttempts > 0 && <span className="text-danger"> ({meta.failedAttempts} fail)</span>}
												</span>
											)}
										</div>
										{step.type === "wait" && step.status === "waiting" && meta.waitEventName && onSendEvent && (
											<span
												className="inline-flex items-center gap-1 text-[9px] font-medium text-primary border border-primary/30 rounded px-1.5 py-px mt-1 cursor-pointer hover:bg-primary/10 transition-colors w-fit"
												onClick={(e) => { e.stopPropagation(); onSendEvent(meta.waitEventName!); }}
												role="button"
												tabIndex={0}
											>
												Send Event &rarr;
											</span>
										)}
									</div>

									{/* Status */}
									<span className={`shrink-0 inline-flex items-center gap-1 text-[10px] font-medium ${sc.color}`}>
										<Icon className={isActive ? "animate-spin" : undefined} size={10} />
									</span>

									{/* Caret */}
									<span className="shrink-0 text-muted">
										{isExpanded ? <CaretDownIcon size={10} /> : <CaretRightIcon size={10} />}
									</span>
								</div>

								{/* ---- Right: waterfall bar ---- */}
								<div className="flex-1 relative h-10 overflow-hidden min-w-0">
									<div
										className={`absolute top-1.5 bottom-1.5 rounded-md border transition-all ${getBarClasses(step.type, step.status)} ${isActive ? "animate-pulse" : ""}`}
										style={{ left: `${Math.max(-1, startPct)}%`, width: `${widthPct}%`, minWidth: "4px" }}
									>
										{step.attempts.length > 0 && widthPct > 4 && (
											<div className="absolute inset-0.5 flex gap-px">
												{step.attempts.map((attempt, ai) => {
													const aSpan = attempt.endIndex !== null ? attempt.endIndex - attempt.startIndex : 1;
													const totalAttemptSpan = step.endIndex !== null ? step.endIndex - step.startIndex : 1;
													const aPct = Math.max((aSpan / totalAttemptSpan) * 100, 5);
													return (
														<div
															key={ai}
															className={`rounded-sm ${attemptBarColor(attempt.status)} transition-all`}
															style={{ width: `${aPct}%`, minWidth: "2px" }}
														/>
													);
												})}
											</div>
										)}
									</div>
								</div>
							</button>

							{isExpanded && <StepDetail step={step} meta={meta} />}
						</div>
					);
				})}

				</div>

			{/* ---- Hover tooltip (outside divide-y to avoid layout shift) ---- */}
			{hoveredStep !== null && hoveredStepData && hoveredMeta && (
				<StepTooltip step={hoveredStepData} meta={hoveredMeta} stepIndex={hoveredStep} totalSteps={timeline.length} pos={tooltipPos} createdOn={createdOn} />
			)}
		</div>
	);
}

// ============================================================================
// Step Tooltip (on hover)
// ============================================================================

function StepTooltip({ step, meta, stepIndex, totalSteps, pos, createdOn }: {
	step: TimelineStep;
	meta: StepMeta;
	stepIndex: number;
	totalSteps: number;
	pos: { x: number; y: number };
	createdOn: string | null;
}) {
	const sc = getStatus(step.status);
	const typeLabel = stepTypeLabels[step.type] ?? stepTypeLabels.step;

	return (
		<div
			className="fixed z-50 bg-tooltip-bg text-tooltip-text rounded-lg shadow-xl border border-border/20 px-4 py-3 pointer-events-none max-w-xs"
			style={{ left: pos.x + 14, top: pos.y - 12, transform: "translateY(-100%)" }}
		>
			{/* Header */}
			<div className="flex items-center gap-2 mb-2">
				<span className={`w-2 h-2 rounded-full ${step.status === "failure" ? "bg-danger" : typeLabel.dotClass}`} />
				<span className="text-xs font-semibold">{cleanStepName(step.name)}</span>
			</div>

			{/* Timestamp context */}
			{createdOn && (
				<div className="text-[10px] text-tooltip-text/50 mb-2 font-mono">
					Instance started {formatTimestamp(createdOn)}
				</div>
			)}

			{/* Data rows */}
			<div className="space-y-1.5 text-[10px]">
				<div className="flex justify-between gap-6">
					<span className="text-tooltip-text/50">Type</span>
					<span className="font-mono font-medium">{typeLabel.label}</span>
				</div>
				<div className="flex justify-between gap-6">
					<span className="text-tooltip-text/50">Status</span>
					<span className={`font-medium ${sc.color}`}>{sc.label}</span>
				</div>
				<div className="flex justify-between gap-6">
					<span className="text-tooltip-text/50">Step</span>
					<span className="font-mono">{stepIndex + 1} of {totalSteps}</span>
				</div>
				<div className="flex justify-between gap-6">
					<span className="text-tooltip-text/50">Event span</span>
					<span className="font-mono">{meta.eventSpan > 0 ? `#${step.startIndex} \u2192 #${step.endIndex}` : `#${step.startIndex}`}</span>
				</div>
				{step.attempts.length > 0 && (
					<div className="flex justify-between gap-6">
						<span className="text-tooltip-text/50">Attempts</span>
						<span className="font-mono">
							{step.attempts.length}
							{meta.failedAttempts > 0 && <span className="text-danger ml-1">({meta.failedAttempts} failed)</span>}
						</span>
					</div>
				)}
				{meta.sleepDurationMs !== null && (
					<div className="flex justify-between gap-6">
						<span className="text-tooltip-text/50">Sleep duration</span>
						<span className="font-mono">{formatMs(meta.sleepDurationMs)}</span>
					</div>
				)}
				{meta.waitEventName && (
					<div className="flex justify-between gap-6">
						<span className="text-tooltip-text/50">Waiting for</span>
						<span className="font-mono">{meta.waitEventName}</span>
					</div>
				)}
				{meta.retryLimit !== null && (
					<div className="flex justify-between gap-6">
						<span className="text-tooltip-text/50">Retry limit</span>
						<span className="font-mono">max {meta.retryLimit}{meta.retryBackoff ? `, ${meta.retryBackoff}` : ""}</span>
					</div>
				)}
				{meta.timeout && (
					<div className="flex justify-between gap-6">
						<span className="text-tooltip-text/50">Timeout</span>
						<span className="font-mono">{meta.timeout}</span>
					</div>
				)}
			</div>

			{/* Error */}
			{step.error !== null && step.error !== undefined && (
				<div className="mt-2 pt-2 border-t border-tooltip-text/10 text-[10px] text-danger font-mono truncate">
					{typeof step.error === "object" && step.error !== null && "message" in step.error
						? (step.error as { message: string }).message
						: String(step.error)}
				</div>
			)}

			{/* Click hint */}
			<div className="mt-2 pt-1.5 border-t border-tooltip-text/10 text-[9px] text-tooltip-text/40">
				Click to inspect details
			</div>
		</div>
	);
}

// ============================================================================
// Step Detail (expanded panel)
// ============================================================================

function StepDetail({ step, meta }: { step: TimelineStep; meta: StepMeta }) {
	return (
		<div className="px-6 pb-5 pt-3 bg-primary/2 border-t border-border/50">
			<div className="ml-8 space-y-4">
				{/* Info pills */}
				<div className="flex flex-wrap items-center gap-2">
					<span
						className="inline-flex items-center gap-1 text-[11px] bg-bg-secondary border border-border rounded-md px-2 py-0.5 text-text-secondary cursor-pointer hover:border-primary/40 hover:text-primary transition-colors"
						onClick={() => {
							const el = document.getElementById("event-log");
							if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
						}}
						role="button"
						tabIndex={0}
					>
						<CodeIcon size={11} />
						Events {step.startIndex}–{step.endIndex ?? "?"}
						<span className="text-muted">({meta.eventSpan})</span>
					</span>
					{step.attempts.length > 0 && (
						<InfoPill className={meta.failedAttempts > 0 ? "text-danger border-danger/20" : "text-text-secondary"}>
							<ArrowsCounterClockwiseIcon size={11} />
							{step.attempts.length} attempt{step.attempts.length !== 1 ? "s" : ""}
							{meta.failedAttempts > 0 && ` (${meta.failedAttempts} failed)`}
						</InfoPill>
					)}
					{meta.sleepDurationMs !== null && (
						<InfoPill className="text-text-secondary">
							<TimerIcon size={11} />
							{formatMs(meta.sleepDurationMs)}
						</InfoPill>
					)}
					{meta.waitEventName && (
						<InfoPill className="text-text-secondary">
							<EnvelopeIcon size={11} />
							event: "{meta.waitEventName}"
						</InfoPill>
					)}
					{meta.timeout && (
						<InfoPill className="text-muted">
							<ClockIcon size={11} />
							timeout: {meta.timeout}
						</InfoPill>
					)}
					{meta.retryLimit !== null && (
						<InfoPill className="text-muted">
							<ArrowsCounterClockwiseIcon size={11} />
							max {meta.retryLimit} retries
							{meta.retryDelay && `, delay ${meta.retryDelay}`}
							{meta.retryBackoff && ` (${meta.retryBackoff})`}
						</InfoPill>
					)}
				</div>

				{/* Attempts */}
				{step.attempts.length > 0 && (
					<div>
						<h5 className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-2">Attempts</h5>
						<div className="space-y-1.5">
							{step.attempts.map((attempt, ai) => {
								const ac = getStatus(attempt.status);
								const AttemptIcon = ac.icon;
								const aSpan = attempt.endIndex !== null ? attempt.endIndex - attempt.startIndex : 0;
								return (
									<div className="flex items-center gap-2.5 text-xs" key={ai}>
										<span className="w-4 h-4 rounded bg-bg-secondary border border-border flex items-center justify-center text-[9px] font-bold text-text-secondary">
											{ai + 1}
										</span>
										<span className={`inline-flex items-center gap-1 font-medium ${ac.color}`}>
											<AttemptIcon size={11} />{ac.label}
										</span>
										<span className="text-[10px] font-mono text-muted">
											events {attempt.startIndex}–{attempt.endIndex ?? "?"} ({aSpan})
										</span>
										{attempt.error && (
											<span className="text-danger font-mono text-[11px] truncate flex-1">
												{typeof attempt.error === "object" && attempt.error !== null && "message" in attempt.error
													? (attempt.error as { message: string }).message
													: String(attempt.error)}
											</span>
										)}
									</div>
								);
							})}
						</div>
					</div>
				)}

				{/* Output */}
				{step.output !== null && step.output !== undefined && (
					<JsonViewer data={step.output} label="Output" variant={step.status === "failure" ? "danger" : "success"} maxHeight="max-h-48" defaultExpandDepth={3} />
				)}

				{/* Error */}
				{step.error !== null && step.error !== undefined && (
					<JsonViewer data={step.error} label="Error" variant="danger" maxHeight="max-h-48" defaultExpandDepth={3} />
				)}

				{/* Config */}
				{step.config !== null && step.config !== undefined && (
					<JsonViewer data={step.config} label="Config" maxHeight="max-h-36" defaultExpandDepth={2} />
				)}
			</div>
		</div>
	);
}

// ============================================================================
// Grouped Event Log
// ============================================================================

interface EventGroup {
	label: string;
	icon: FC<{ size?: number; weight?: string; className?: string }>;
	color: string;
	events: RawState[];
}

function buildEventGroups(states: RawState[]): EventGroup[] {
	const groups: EventGroup[] = [];
	let currentGroup: EventGroup | null = null;

	for (const state of states) {
		const info = getEventInfo(state.event);
		if (info.category === "workflow") {
			if (currentGroup) { groups.push(currentGroup); currentGroup = null; }
			groups.push({
				label: info.label,
				icon: state.event === 2 ? CheckCircleIcon : state.event === 3 ? XCircleIcon : state.event === 4 ? WarningCircleIcon : GitBranchIcon,
				color: info.color,
				events: [state],
			});
			continue;
		}
		const groupKey = state.groupKey;
		if (currentGroup && groupKey && currentGroup.events[0]?.groupKey === groupKey) {
			currentGroup.events.push(state);
		} else {
			if (currentGroup) { groups.push(currentGroup); }
			const displayTarget = state.target ? state.target.replace(/-\d+$/, "") : groupKey ?? "Unknown";
			const icon = info.category === "sleep" ? ClockIcon : info.category === "wait" ? HourglassIcon : LightningIcon;
			currentGroup = { label: displayTarget, icon, color: info.color, events: [state] };
		}
	}
	if (currentGroup) { groups.push(currentGroup); }
	return groups;
}

function getGroupFinalStatus(events: RawState[]): EventInfo | null {
	if (events.length === 0) return null;
	const finalEvent = [...events].reverse().find(e => !(e.event === 10 || e.event === 11 || e.event === 12));
	return finalEvent ? getEventInfo(finalEvent.event) : getEventInfo(events[events.length - 1].event);
}

function EventGroupRow({ group }: { group: EventGroup }) {
	const [expanded, setExpanded] = useState(false);
	const isSingleEvent = group.events.length === 1;
	const finalStatus = getGroupFinalStatus(group.events);
	const GroupIcon = group.icon;

	return (
		<div className="border-b border-border last:border-b-0">
			<button className={`flex items-center w-full gap-3 px-5 py-3 text-left transition-colors cursor-pointer ${expanded ? "bg-bg-secondary" : "hover:bg-bg-secondary/50"}`} onClick={() => setExpanded(!expanded)} type="button">
				<span className="shrink-0 w-4 text-muted">
					{isSingleEvent ? <span className="inline-block w-1.5 h-1.5 rounded-full bg-border ml-1" /> : expanded ? <CaretDownIcon size={12} /> : <CaretRightIcon size={12} />}
				</span>
				<span className={`shrink-0 ${group.color}`}><GroupIcon size={14} /></span>
				<span className="text-xs font-medium text-text flex-1 min-w-0 truncate">{group.label}</span>
				{!isSingleEvent && <span className="shrink-0 text-[10px] font-mono text-text-secondary bg-bg-secondary border border-border rounded-md px-2 py-0.5">{group.events.length}</span>}
				{finalStatus && <span className={`shrink-0 inline-flex items-center gap-1 text-[10px] font-medium ${finalStatus.color}`}>{finalStatus.shortLabel}</span>}
			</button>
			{expanded && (
				<div className="border-t border-border bg-bg">
					{group.events.map((state) => <EventRow key={state.id} state={state} />)}
				</div>
			)}
		</div>
	);
}

function EventRow({ state }: { state: RawState }) {
	const [showMeta, setShowMeta] = useState(false);
	const info = getEventInfo(state.event);
	const hasMetadata = state.metadata !== null && state.metadata !== undefined && JSON.stringify(state.metadata) !== "{}";

	return (
		<div className="ml-7 border-b border-border/50 last:border-b-0">
			<button
				className={`flex items-center gap-3 px-4 py-2.5 w-full text-left transition-colors ${
					hasMetadata ? "cursor-pointer hover:bg-bg-secondary/60" : "cursor-default"
				} ${showMeta ? "bg-bg-secondary/40" : ""}`}
				onClick={() => { if (hasMetadata) { setShowMeta(!showMeta); } }}
				type="button"
			>
				<span className="shrink-0 text-[10px] font-mono text-muted w-5 text-right">{state.id}</span>
				<span className={`shrink-0 inline-flex items-center px-2 py-0.5 text-[10px] font-semibold rounded-md ${info.bg}/10 ${info.color} border border-current/10`}>{info.label}</span>
				{state.target && <span className="shrink-0 text-[11px] font-mono text-text-secondary truncate max-w-48">{state.target}</span>}
				<span className="flex-1" />
				{hasMetadata && (
					<span className={`shrink-0 text-muted transition-transform duration-150 ${showMeta ? "rotate-90" : ""}`}>
						<CaretRightIcon size={10} />
					</span>
				)}
			</button>
			{showMeta && hasMetadata && (
				<div className="px-4 pb-3 ml-8">
					<JsonViewer data={state.metadata} maxHeight="max-h-40" defaultExpandDepth={2} />
				</div>
			)}
		</div>
	);
}

function GroupedEventLog({ states }: { states: WorkflowInstanceDetail["raw_states"] }) {
	const [expanded, setExpanded] = useState(false);
	if (states.length === 0) return null;
	const groups = buildEventGroups(states);

	return (
		<div className="border border-border rounded-xl bg-bg overflow-hidden">
			<button className="flex items-center justify-between w-full px-6 py-4 bg-bg-secondary border-b border-border cursor-pointer hover:bg-surface-tertiary transition-colors" onClick={() => setExpanded(!expanded)} type="button">
				<div className="flex items-center gap-3">
					<CodeIcon size={16} className="text-muted" />
					<h3 className="text-sm font-semibold text-text">Event Log</h3>
					<span className="text-[10px] font-mono text-text-secondary bg-bg-tertiary border border-border rounded-md px-2 py-0.5">{states.length} events &middot; {groups.length} groups</span>
				</div>
				<span className={`text-muted transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}><CaretDownIcon size={14} /></span>
			</button>
			{expanded && (
				<div className="max-h-[32rem] overflow-y-auto">
					{groups.map((group, i) => <EventGroupRow group={group} key={i} />)}
				</div>
			)}
		</div>
	);
}

// ============================================================================
// Main View
// ============================================================================

// ============================================================================
// Instance Switcher Dropdown (uses @base-ui/react/select like D1/DO)
// ============================================================================

const statusDot: Record<string, string> = {
	complete: "bg-success",
	running: "bg-primary",
	errored: "bg-danger",
	queued: "bg-muted",
	terminated: "bg-danger",
	unknown: "bg-muted",
	waiting: "bg-primary",
	sleeping: "bg-muted",
};

function InstanceSwitcher({ siblings, currentId, workflowName }: { siblings: WorkflowInstance[]; currentId: string; workflowName: string }) {
	const navigate = useNavigate();
	const [open, setOpen] = useState(false);

	const handleChange = useCallback((value: string | null) => {
		if (!value) return;
		void navigate({
			to: "/workflows/$workflowName/$instanceId",
			params: { workflowName, instanceId: value },
		});
	}, [navigate, workflowName]);

	// Build items — use hash as value (it's the URL param)
	const items = siblings.map((inst) => ({
		value: inst.hash || inst.id,
		id: inst.id,
		status: inst.status,
		stepCount: inst.step_count,
	}));

	const shortId = (id: string) => id.length > 24 ? `${id.slice(0, 8)}...${id.slice(-6)}` : id;

	return (
		<Select.Root
			onOpenChange={setOpen}
			onValueChange={handleChange}
			open={open}
			value={currentId}
		>
			<Select.Trigger className="inline-flex items-center gap-1 p-2 -mx-1.5 rounded-md bg-transparent text-xs font-mono text-text cursor-pointer border-none transition-colors hover:bg-border/50 data-popup-open:bg-border/50">
				<Select.Value placeholder="Select instance" />
				<Select.Icon>
					<CaretUpDownIcon className="w-3 h-3 text-text-secondary" />
				</Select.Icon>
			</Select.Trigger>

			<Select.Portal>
				<Select.Positioner align="start" alignItemWithTrigger={false} side="bottom" sideOffset={4}>
					<Select.Popup className="min-w-72 max-h-80 bg-bg border border-border rounded-lg shadow-[0_4px_12px_rgba(0,0,0,0.15)] z-100 overflow-hidden transition-[opacity,transform] duration-150 data-starting-style:opacity-0 data-starting-style:-translate-y-1 data-ending-style:opacity-0 data-ending-style:-translate-y-1">
						<div className="px-2.5 py-1.5 border-b border-border bg-bg-secondary">
							<span className="text-[10px] font-semibold uppercase tracking-wider text-muted">
								{items.length} instance{items.length !== 1 ? "s" : ""}
							</span>
						</div>
						<Select.List className="p-1">
							{items.length > 0 ? (
								items.map((item) => {
									const isCurrent = item.value === currentId;
									const dot = statusDot[item.status] ?? "bg-muted";
									return (
										<Select.Item
											className="flex items-center gap-2 w-full py-1.5 px-2 rounded-md text-xs text-text cursor-pointer transition-colors select-none outline-none data-highlighted:bg-bg-secondary dark:data-highlighted:bg-bg-tertiary"
											key={item.value}
											value={item.value}
										>
											<span className="flex items-center w-4">
												{isCurrent
													? <CheckIcon className="w-3.5 h-3.5 text-primary" weight="bold" />
													: <span className={`w-2 h-2 rounded-full ${dot}`} />
												}
											</span>
											<Select.ItemText>
												<span className="font-mono">{shortId(item.id)}</span>
											</Select.ItemText>
											<span className="ml-auto text-[10px] text-muted capitalize">{item.status}</span>
											<span className="text-[10px] text-muted">{item.stepCount}s</span>
										</Select.Item>
									);
								})
							) : (
								<span className="flex justify-center items-center gap-2 w-full py-1.5 px-2 text-xs text-text-secondary">
									No instances
								</span>
							)}
						</Select.List>
					</Select.Popup>
				</Select.Positioner>
			</Select.Portal>
		</Select.Root>
	);
}

// ============================================================================
// Main View
// ============================================================================

const TERMINAL_STATUSES = new Set(["complete", "errored", "terminated"]);
const SSE_BASE = import.meta.env.VITE_LOCAL_EXPLORER_API_PATH ?? "/cdn-cgi/explorer/api";

function WorkflowInstanceDetailView() {
	const params = Route.useParams();
	const loaderData = Route.useLoaderData();
	const router = useRouter();
	const [detail, setDetail] = useState<WorkflowInstanceDetail>(loaderData.detail);
	const [siblings, setSiblings] = useState<WorkflowInstance[]>(loaderData.siblings);
	const [isRefreshing, setIsRefreshing] = useState(false);
	const [showSendEvent, setShowSendEvent] = useState<string | false>(false);
	const [eventError, setEventError] = useState<string | null>(null);
	const [isStreaming, setIsStreaming] = useState(false);

	useEffect(() => { setDetail(loaderData.detail); setSiblings(loaderData.siblings); }, [loaderData]);

	// ---- SSE stream for real-time updates ----
	const isTerminal = TERMINAL_STATUSES.has(detail.status);
	useEffect(() => {
		if (isTerminal) return;

		const url = `${SSE_BASE}/workflows/${encodeURIComponent(params.workflowName)}/instances/${encodeURIComponent(params.instanceId)}/stream`;
		const es = new EventSource(url);
		setIsStreaming(true);

		es.addEventListener("update", (e) => {
			try {
				const data = JSON.parse(e.data) as WorkflowInstanceDetail;
				setDetail(data);
			} catch {
				// Ignore parse errors
			}
		});

		es.addEventListener("done", () => {
			setIsStreaming(false);
			es.close();
			// Refresh siblings list one final time
			void listWorkflowInstances(params.workflowName).then(setSiblings).catch(() => {});
		});

		es.addEventListener("error", () => {
			// EventSource auto-reconnects, but update streaming state
			setIsStreaming(false);
		});

		es.addEventListener("open", (() => {
			setIsStreaming(true);
		}) as EventListener);

		return () => {
			setIsStreaming(false);
			es.close();
		};
	}, [params.workflowName, params.instanceId, isTerminal]);

	const handleRefresh = useCallback(async () => {
		setIsRefreshing(true);
		try {
			const [freshDetail, freshSiblings] = await Promise.all([
				getWorkflowInstance(params.workflowName, params.instanceId),
				listWorkflowInstances(params.workflowName),
				new Promise(r => setTimeout(r, 300)),
			]);
			setDetail(freshDetail);
			setSiblings(freshSiblings);
		} catch {
			// fallback to router invalidation
			await router.invalidate();
		} finally { setIsRefreshing(false); }
	}, [params.workflowName, params.instanceId, router]);

	const handleSendEvent = useCallback(async (type: string, payloadJson: string) => {
		try {
			setEventError(null);
			let payload: unknown = {};
			try { payload = JSON.parse(payloadJson); } catch { setEventError("Invalid JSON payload"); return; }
			await sendWorkflowEvent(params.workflowName, params.instanceId, { type, payload });
			setShowSendEvent(false);
			setTimeout(() => { void handleRefresh(); }, 500);
		} catch (err) {
			setEventError(err instanceof Error ? err.message : "Failed to send event");
		}
	}, [params.workflowName, params.instanceId, handleRefresh]);

	const successSteps = detail.timeline.filter(s => s.status === "success").length;
	const failedSteps = detail.timeline.filter(s => s.status === "failure").length;
	const activeSteps = detail.timeline.filter(s => s.status === "running" || s.status === "waiting" || s.status === "sleeping").length;
	const totalSleepMs = useMemo(() => {
		let ms = 0;
		for (const step of detail.timeline) {
			if (step.type === "sleep" && step.config && typeof step.config === "object") {
				const cfg = step.config as Record<string, unknown>;
				if (typeof cfg.durationMs === "number") ms += cfg.durationMs;
			}
		}
		return ms;
	}, [detail.timeline]);
	const totalRetries = detail.timeline.reduce((sum, s) => sum + s.attempts.filter(a => a.status === "failure").length, 0);

	return (
		<div className="flex flex-col h-full">
			<Breadcrumbs
				icon={GitBranchIcon}
				items={[
					<Link className="flex items-center gap-1.5" key="wf-name" params={{ workflowName: params.workflowName }} to="/workflows/$workflowName">{params.workflowName}</Link>,
					<InstanceSwitcher key="instance-switcher" siblings={siblings} currentId={params.instanceId} workflowName={params.workflowName} />,
				]}
				title="Workflows"
			>
				<div className="flex-1" />
				{!isTerminal && (
					<span className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-medium rounded-full border ${
						isStreaming
							? "bg-success/10 text-success border-success/20"
							: "bg-muted/10 text-muted border-muted/20"
					}`}>
						<span className={`w-1.5 h-1.5 rounded-full ${isStreaming ? "bg-success animate-pulse" : "bg-muted"}`} />
						{isStreaming ? "Live" : "Connecting..."}
					</span>
				)}
				<Button className="inline-flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-medium rounded-full cursor-pointer transition-[background-color,transform] active:translate-y-px bg-bg-tertiary text-text border border-border hover:bg-border disabled:cursor-progress" disabled={isRefreshing} onClick={handleRefresh}>
					<ArrowsCounterClockwiseIcon className={isRefreshing ? "animate-spin" : undefined} size={14} />
					Refresh
				</Button>
				{!isTerminal && (
					<button className="inline-flex items-center justify-center gap-1.5 py-2 px-4 text-xs font-medium rounded-full cursor-pointer transition-colors bg-primary text-white hover:bg-primary-hover" onClick={() => setShowSendEvent(true)} type="button">
						<PaperPlaneIcon size={14} weight="bold" />Send Event
					</button>
				)}
			</Breadcrumbs>

			{showSendEvent !== false && <SendEventModal initialType={showSendEvent || undefined} onClose={() => { setShowSendEvent(false); setEventError(null); }} onSend={handleSendEvent} />}

			<div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
				{eventError && <div className="text-danger p-4 bg-danger/8 border border-danger/20 rounded-xl text-sm">{eventError}</div>}

				{/* ---- Instance header card ---- */}
				<div className="border border-border rounded-xl bg-bg overflow-hidden">
					{/* Top section: status + identity */}
					<div className="px-6 pt-5 pb-4">
						<div className="flex items-start justify-between gap-4">
							<div className="flex-1 min-w-0">
								<div className="flex items-center gap-3 mb-3">
									<StatusBadge size="lg" status={detail.status} />
									{detail.created_on && (
										<span className="text-[11px] text-muted flex items-center gap-1">
											<ClockIcon size={11} />
											{formatTimestamp(detail.created_on)}
										</span>
									)}
								</div>
								<div className="flex items-center gap-2">
									<p className="text-xs font-mono text-text-secondary truncate" title={detail.id}>{detail.id}</p>
								</div>
								{detail.id !== detail.hash && (
									<p className="text-[10px] font-mono text-muted mt-1 truncate" title={detail.hash}>DO hash: {detail.hash.slice(0, 20)}...</p>
								)}
							</div>
						</div>

						{/* Progress bar */}
						{detail.timeline.length > 0 && (
							<div className="mt-4">
								<div className="flex h-1.5 rounded-full overflow-hidden bg-bg-secondary border border-border/50">
									{detail.timeline.map((step, i) => {
										const pct = 100 / detail.timeline.length;
										const color = step.status === "success" || step.status === "complete"
											? "bg-success"
											: step.status === "failure"
												? "bg-danger"
												: step.status === "waiting" || step.status === "sleeping"
													? "bg-primary/40"
													: step.status === "running"
														? "bg-primary animate-pulse"
														: "bg-muted/30";
										return <div key={i} className={`${color} transition-all`} style={{ width: `${pct}%` }} title={`${cleanStepName(step.name)}: ${step.status}`} />;
									})}
								</div>
							</div>
						)}
					</div>

					{/* Stats grid — 3 columns for breathing room */}
					<div className="grid grid-cols-3 border-t border-border">
						{[
							{ label: "Total Steps", value: detail.timeline.length, color: "text-text" },
							{ label: "Passed", value: successSteps, color: successSteps > 0 ? "text-success" : "text-text" },
							{ label: "Failed", value: failedSteps, color: failedSteps > 0 ? "text-danger" : "text-text" },
							{ label: "Active", value: activeSteps, color: activeSteps > 0 ? "text-primary" : "text-text" },
							{ label: "Retries", value: totalRetries, color: totalRetries > 0 ? "text-danger" : "text-text" },
							{ label: "Total Sleep", value: totalSleepMs > 0 ? formatMs(totalSleepMs) : "—", color: "text-text" },
						].map((stat, i) => (
							<div key={stat.label} className={`px-6 py-3.5 ${i < 3 ? "border-b border-border" : ""} ${(i % 3 !== 2) ? "border-r border-border" : ""}`}>
								<div className="text-[10px] font-medium uppercase tracking-wider text-muted mb-1">{stat.label}</div>
								<div className={`text-lg font-semibold tabular-nums ${stat.color}`}>{stat.value}</div>
							</div>
						))}
					</div>

					{/* Params / Output / Error */}
					{detail.params !== null && detail.params !== undefined && (
						<div className="px-6 py-4 border-t border-border">
							<JsonViewer data={detail.params} label="Input Params" maxHeight="max-h-40" defaultExpandDepth={3} />
						</div>
					)}
					{detail.output !== null && detail.output !== undefined && (
						<div className="px-6 py-4 border-t border-border">
							<JsonViewer data={detail.output} label="Output" variant="success" maxHeight="max-h-40" defaultExpandDepth={3} />
						</div>
					)}
					{detail.error !== null && detail.error !== undefined && (
						<div className="px-6 py-4 border-t border-border">
							<JsonViewer data={detail.error} label="Error" variant="danger" maxHeight="max-h-40" defaultExpandDepth={3} />
						</div>
					)}
				</div>

				{/* ---- Execution Timeline ---- */}
				<div className="border border-border rounded-xl bg-bg overflow-hidden">
					<div className="flex items-center gap-3 px-6 py-4 bg-bg-secondary border-b border-border">
						<GitBranchIcon size={16} className="text-muted" />
						<div className="flex-1">
							<h3 className="text-sm font-semibold text-text">Execution Timeline</h3>
							<p className="text-[10px] text-muted mt-0.5">
								Hover for details &middot; Click to expand &middot; {"\u2318"}+scroll to zoom
							</p>
						</div>
						<span className="text-[10px] font-mono text-text-secondary bg-bg-tertiary border border-border rounded-md px-2 py-0.5">
							{detail.raw_states.length} events
						</span>
					</div>
					<WaterfallTimeline timeline={detail.timeline} rawStates={detail.raw_states} createdOn={detail.created_on} onSendEvent={(eventType) => setShowSendEvent(eventType)} />
				</div>

				{/* ---- Event Log ---- */}
				<div id="event-log">
					<GroupedEventLog states={detail.raw_states} />
				</div>
			</div>
		</div>
	);
}
