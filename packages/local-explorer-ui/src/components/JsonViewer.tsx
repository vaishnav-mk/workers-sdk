import { CaretDownIcon, CaretRightIcon, CopyIcon, CheckIcon } from "@phosphor-icons/react";
import { useState, useCallback, useMemo } from "react";

// ============================================================================
// Types
// ============================================================================

type JsonValue =
	| string
	| number
	| boolean
	| null
	| undefined
	| JsonValue[]
	| { [key: string]: JsonValue };

interface JsonViewerProps {
	/** The value to display */
	data: unknown;
	/** Max height with overflow scroll. Default: no limit */
	maxHeight?: string;
	/** Start fully expanded to this depth (0 = collapsed, Infinity = all). Default: 2 */
	defaultExpandDepth?: number;
	/** Show a copy button in the top-right corner. Default: true */
	copyable?: boolean;
	/** Visual variant for contextual coloring */
	variant?: "default" | "success" | "danger";
	/** Optional label shown above the viewer */
	label?: string;
}

// ============================================================================
// Color config for syntax tokens
// ============================================================================

const tokenColors = {
	key: "text-text",
	string: "text-[#d16969] dark:text-[#ce9178]",
	number: "text-[#098658] dark:text-[#b5cea8]",
	boolean: "text-[#0000ff] dark:text-[#569cd6]",
	null: "text-muted italic",
	bracket: "text-muted",
	punctuation: "text-muted",
} as const;

const variantBorder = {
	default: "border-border",
	success: "border-success/20",
	danger: "border-danger/20",
} as const;

const variantBg = {
	default: "bg-bg-secondary",
	success: "bg-success/4",
	danger: "bg-danger/4",
} as const;

// ============================================================================
// Helpers
// ============================================================================

function isExpandable(value: unknown): value is Record<string, unknown> | unknown[] {
	return value !== null && typeof value === "object";
}

function getPreview(value: unknown): string {
	if (Array.isArray(value)) {
		if (value.length === 0) {
			return "[]";
		}
		return `[${value.length} item${value.length !== 1 ? "s" : ""}]`;
	}
	if (value !== null && typeof value === "object") {
		const keys = Object.keys(value);
		if (keys.length === 0) {
			return "{}";
		}
		return `{${keys.length} key${keys.length !== 1 ? "s" : ""}}`;
	}
	return String(value);
}

function formatPrimitive(value: unknown): { text: string; colorClass: string } {
	if (value === null || value === undefined) {
		return { text: "null", colorClass: tokenColors.null };
	}
	if (typeof value === "string") {
		return { text: `"${value}"`, colorClass: tokenColors.string };
	}
	if (typeof value === "number") {
		return { text: String(value), colorClass: tokenColors.number };
	}
	if (typeof value === "boolean") {
		return { text: String(value), colorClass: tokenColors.boolean };
	}
	return { text: String(value), colorClass: tokenColors.string };
}

// ============================================================================
// JsonNode — recursive tree node
// ============================================================================

function JsonNode({
	keyName,
	value,
	depth,
	defaultExpandDepth,
	isLast,
}: {
	keyName?: string;
	value: unknown;
	depth: number;
	defaultExpandDepth: number;
	isLast: boolean;
}) {
	const expandable = isExpandable(value);
	const [expanded, setExpanded] = useState(depth < defaultExpandDepth);
	const comma = isLast ? "" : ",";

	if (!expandable) {
		const { text, colorClass } = formatPrimitive(value);
		return (
			<div className="flex items-baseline leading-6 pl-5">
				{keyName !== undefined && (
					<>
						<span className={tokenColors.key}>"{keyName}"</span>
						<span className={tokenColors.punctuation}>:&nbsp;</span>
					</>
				)}
				<span className={colorClass}>{text}</span>
				<span className={tokenColors.punctuation}>{comma}</span>
			</div>
		);
	}

	const isArray = Array.isArray(value);
	const entries = isArray
		? (value as unknown[]).map((v, i) => [String(i), v] as const)
		: Object.entries(value as Record<string, unknown>);
	const openBracket = isArray ? "[" : "{";
	const closeBracket = isArray ? "]" : "}";
	const isEmpty = entries.length === 0;

	if (isEmpty) {
		return (
			<div className="flex items-baseline leading-6 pl-5">
				{keyName !== undefined && (
					<>
						<span className={tokenColors.key}>"{keyName}"</span>
						<span className={tokenColors.punctuation}>:&nbsp;</span>
					</>
				)}
				<span className={tokenColors.bracket}>
					{openBracket}{closeBracket}
				</span>
				<span className={tokenColors.punctuation}>{comma}</span>
			</div>
		);
	}

	return (
		<div>
			{/* Header line with toggle */}
			<button
				className="flex items-baseline leading-6 w-full text-left cursor-pointer bg-transparent border-none p-0 hover:bg-text/[0.03] rounded-sm transition-colors"
				onClick={() => setExpanded(!expanded)}
				type="button"
			>
				<span className="w-5 shrink-0 flex items-center justify-center text-muted">
					{expanded ? (
						<CaretDownIcon size={10} weight="bold" />
					) : (
						<CaretRightIcon size={10} weight="bold" />
					)}
				</span>
				{keyName !== undefined && (
					<>
						<span className={tokenColors.key}>"{keyName}"</span>
						<span className={tokenColors.punctuation}>:&nbsp;</span>
					</>
				)}
				<span className={tokenColors.bracket}>{openBracket}</span>
				{!expanded && (
					<>
						<span className="text-muted text-[11px] mx-1">
							{getPreview(value)}
						</span>
						<span className={tokenColors.bracket}>{closeBracket}</span>
						<span className={tokenColors.punctuation}>{comma}</span>
					</>
				)}
			</button>

			{/* Children */}
			{expanded && (
				<>
					<div className="ml-4 border-l border-border/40 pl-1">
						{entries.map(([k, v], i) => (
							<JsonNode
								key={k}
								keyName={isArray ? undefined : k}
								value={v}
								depth={depth + 1}
								defaultExpandDepth={defaultExpandDepth}
								isLast={i === entries.length - 1}
							/>
						))}
					</div>
					<div className="flex items-baseline leading-6 pl-5">
						<span className={tokenColors.bracket}>{closeBracket}</span>
						<span className={tokenColors.punctuation}>{comma}</span>
					</div>
				</>
			)}
		</div>
	);
}

// ============================================================================
// CopyButton (inline)
// ============================================================================

function InlineCopyButton({ text }: { text: string }) {
	const [copied, setCopied] = useState(false);

	const handleCopy = useCallback(async () => {
		await navigator.clipboard.writeText(text);
		setCopied(true);
		setTimeout(() => setCopied(false), 1500);
	}, [text]);

	return (
		<button
			className={`flex items-center justify-center w-6 h-6 rounded bg-transparent border-none cursor-pointer transition-colors ${
				copied
					? "text-success"
					: "text-muted hover:text-text hover:bg-text/[0.06]"
			}`}
			onClick={handleCopy}
			type="button"
			title={copied ? "Copied!" : "Copy JSON"}
		>
			{copied ? (
				<CheckIcon size={13} weight="bold" />
			) : (
				<CopyIcon size={13} />
			)}
		</button>
	);
}

// ============================================================================
// JsonViewer — main exported component
// ============================================================================

export function JsonViewer({
	data,
	maxHeight,
	defaultExpandDepth = 2,
	copyable = true,
	variant = "default",
	label,
}: JsonViewerProps) {
	const serialized = useMemo(() => {
		try {
			return JSON.stringify(data, null, 2);
		} catch {
			return String(data);
		}
	}, [data]);

	if (data === null || data === undefined) {
		return null;
	}

	return (
		<div>
			{label && (
				<div className="flex items-center justify-between mb-1.5">
					<h5 className="text-[10px] font-semibold uppercase tracking-wider text-muted">
						{label}
					</h5>
				</div>
			)}
			<div
				className={`relative rounded-lg border font-mono text-xs overflow-hidden ${variantBorder[variant]} ${variantBg[variant]}`}
			>
			{copyable && (
				<div className="absolute top-2 right-2 z-10">
					<InlineCopyButton text={serialized} />
				</div>
			)}
			<div
				className={`px-3.5 py-3 pr-9 overflow-auto ${maxHeight ?? ""}`}
			>
					<JsonNode
						value={data}
						depth={0}
						defaultExpandDepth={defaultExpandDepth}
						isLast={true}
					/>
				</div>
			</div>
		</div>
	);
}

/**
 * Compact inline JSON for small values (shown in a single line).
 * Falls back to JsonViewer if the value is complex.
 */
export function JsonInline({ data }: { data: unknown }) {
	if (data === null || data === undefined) {
		return <span className="text-muted italic text-xs font-mono">null</span>;
	}

	const { text, colorClass } = formatPrimitive(data);

	if (!isExpandable(data)) {
		return <span className={`text-xs font-mono ${colorClass}`}>{text}</span>;
	}

	// For objects/arrays, show a compact summary
	const preview = getPreview(data);
	return (
		<span className="text-xs font-mono text-muted">{preview}</span>
	);
}
