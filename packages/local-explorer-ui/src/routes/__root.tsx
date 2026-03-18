import {
	createRootRoute,
	Outlet,
	useRouterState,
} from "@tanstack/react-router";
import {
	d1ListDatabases,
	durableObjectsNamespaceListNamespaces,
	workersKvNamespaceListNamespaces,
} from "../api";
import { listWorkflows } from "../api/workflows";
import { Sidebar } from "../components/Sidebar";
import type {
	D1DatabaseResponse,
	WorkersKvNamespace,
	WorkersNamespace,
} from "../api";
import type { WorkflowDefinition } from "../api/workflows";

export const Route = createRootRoute({
	component: RootLayout,
	loader: async () => {
		const [kvResponse, d1Response, doResponse, workflowsResponse] =
			await Promise.allSettled([
				workersKvNamespaceListNamespaces(),
				d1ListDatabases(),
				durableObjectsNamespaceListNamespaces(),
				listWorkflows(),
			]);

		let kvNamespaces = new Array<WorkersKvNamespace>();
		let kvError: string | null = null;
		if (kvResponse.status === "fulfilled") {
			kvNamespaces = kvResponse.value.data?.result ?? [];
		} else {
			kvError = `KV Error: ${kvResponse.reason instanceof Error ? kvResponse.reason.message : JSON.stringify(kvResponse.reason)}`;
		}

		let databases = new Array<D1DatabaseResponse>();
		let d1Error: string | null = null;
		if (d1Response.status === "fulfilled") {
			databases = d1Response.value.data?.result ?? [];
		} else {
			d1Error = `D1 Error: ${d1Response.reason instanceof Error ? d1Response.reason.message : JSON.stringify(d1Response.reason)}`;
		}

		let doNamespaces = new Array<WorkersNamespace>();
		let doError: string | null = null;
		if (doResponse.status === "fulfilled") {
			// Only show namespaces that use SQLite storage
			const allDoNamespaces = doResponse.value.data?.result ?? [];
			doNamespaces = allDoNamespaces.filter((ns) => ns.use_sqlite === true);
		} else {
			doError = `DO Error: ${doResponse.reason instanceof Error ? doResponse.reason.message : JSON.stringify(doResponse.reason)}`;
		}

		let workflows = new Array<WorkflowDefinition>();
		let workflowsError: string | null = null;
		if (workflowsResponse.status === "fulfilled") {
			workflows = workflowsResponse.value;
		} else {
			workflowsError = `Workflows Error: ${workflowsResponse.reason instanceof Error ? workflowsResponse.reason.message : JSON.stringify(workflowsResponse.reason)}`;
		}

		return {
			d1Error,
			databases,
			doError,
			doNamespaces,
			kvError,
			kvNamespaces,
			workflows,
			workflowsError,
		};
	},
});

function RootLayout() {
	const loaderData = Route.useLoaderData();
	const routerState = useRouterState();
	const currentPath = routerState.location.pathname;

	return (
		<div className="flex min-h-screen">
			<Sidebar
				currentPath={currentPath}
				d1Error={loaderData.d1Error}
				databases={loaderData.databases}
				doError={loaderData.doError}
				doNamespaces={loaderData.doNamespaces}
				kvError={loaderData.kvError}
				kvNamespaces={loaderData.kvNamespaces}
				workflows={loaderData.workflows}
				workflowsError={loaderData.workflowsError}
			/>
			<main className="flex flex-1 flex-col overflow-y-auto">
				<Outlet />
			</main>
		</div>
	);
}
