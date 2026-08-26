import type { ChildProcess } from "node:child_process";
import {
	DEFAULT_BROWSER_HOST,
	DEFAULT_BROWSER_PORT,
	type EffectiveBrowserSettings,
	parseConfiguredPort,
} from "./settings.js";

export const DEFAULT_HOST = DEFAULT_BROWSER_HOST;
export const DEFAULT_PORT = DEFAULT_BROWSER_PORT;
export const DEFAULT_TIMEOUT_MS = 10_000;
export const DEFAULT_HTTP_TIMEOUT_MS = 1_000;
export const DEFAULT_ENDPOINT_WAIT_MS = 5_000;
export const DEFAULT_ENDPOINT_RETRY_MS = 250;
export const MANAGED_BROWSER_PROFILE_PREFIX = "pi-chrome-devtools-profile-";
export const DEVTOOLS_ACTIVE_PORT_FILE = "DevToolsActivePort";
export const BROWSER_SHUTDOWN_WAIT_MS = 1_500;

export interface DevToolsPage {
	id: string;
	type: string;
	title: string;
	url: string;
	webSocketDebuggerUrl?: string;
}

export interface ChromeDevToolsState {
	host: string;
	port: number;
	configuredPort: number;
	hostConfigured: boolean;
	portConfigured: boolean;
	autoLaunchEnabled: boolean;
	endpointSource: EffectiveBrowserSettings["endpointSource"];
	autoLaunchSource: EffectiveBrowserSettings["autoLaunchSource"];
	browserExecutable?: string;
	extensionPaths: string[];
	browserExecutableSource: EffectiveBrowserSettings["executablePathSource"];
	extensionPathsSource: EffectiveBrowserSettings["extensionPathsSource"];
	settingsFilePath?: string;
	projectSettingsFilePath?: string;
	projectSettingsTrusted: boolean;
	activePageId?: string;
	managedBrowser?: ManagedBrowser;
	launchPromise?: Promise<void>;
	lastLaunchAttempt?: BrowserLaunchAttempt;
	shuttingDown: boolean;
	sessionGeneration: number;
	sessionController: AbortController;
	settingsNotice?: string;
	webMcpEnabled: boolean;
	webMcpGeneration: number;
	webMcpOperationControllers: Set<AbortController>;
}

export interface ManagedBrowser {
	process: ChildProcess;
	userDataDir: string;
	port?: number;
	exited: boolean;
	ready: boolean;
	ownerGeneration: number;
	cleanupPromise?: Promise<void>;
}

export interface BrowserLaunchAttempt {
	candidateLabels: string[];
	mode: "dynamic-port" | "explicit-port";
	selectedCandidate?: string;
	userDataDir?: string;
	lastError?: string;
}

export interface BrowserCandidateDefinition {
	label: string;
	executable: string;
	source: "env" | "path" | "wellKnownPath";
}

export interface BrowserCandidate extends BrowserCandidateDefinition {
	resolvedExecutable: string;
}

export { parseConfiguredPort };

export const state: ChromeDevToolsState = {
	host: DEFAULT_HOST,
	port: DEFAULT_PORT,
	configuredPort: DEFAULT_PORT,
	hostConfigured: false,
	portConfigured: false,
	autoLaunchEnabled: true,
	endpointSource: "default",
	autoLaunchSource: "default",
	extensionPaths: [],
	browserExecutableSource: "default",
	extensionPathsSource: "default",
	projectSettingsTrusted: false,
	shuttingDown: false,
	sessionGeneration: 0,
	sessionController: new AbortController(),
	webMcpEnabled: false,
	webMcpGeneration: 0,
	webMcpOperationControllers: new Set(),
};

export function beginWebMcpOperation(toolSignal?: AbortSignal) {
	const controller = new AbortController();
	state.webMcpOperationControllers.add(controller);
	const signals = [controller.signal, state.sessionController.signal];
	if (toolSignal) signals.push(toolSignal);
	const signal = AbortSignal.any(signals);
	return {
		signal,
		sessionGeneration: state.sessionGeneration,
		webMcpGeneration: state.webMcpGeneration,
		dispose() {
			state.webMcpOperationControllers.delete(controller);
		},
	};
}

export function invalidateWebMcpOperations(reason: string) {
	state.webMcpGeneration += 1;
	const controllers = [...state.webMcpOperationControllers];
	state.webMcpOperationControllers.clear();
	const error = new DOMException(reason, "AbortError");
	for (const controller of controllers) controller.abort(error);
}

export function applyRuntimeWebMcpSetting(enabled: boolean) {
	if (state.webMcpEnabled !== enabled) {
		invalidateWebMcpOperations(`WebMCP ${enabled ? "enabled" : "disabled"}`);
	}
	state.webMcpEnabled = enabled;
}

export function webMcpOperationIsCurrent(operation: {
	sessionGeneration: number;
	webMcpGeneration: number;
}) {
	return (
		operation.sessionGeneration === state.sessionGeneration &&
		operation.webMcpGeneration === state.webMcpGeneration
	);
}

export function applyRuntimeBrowserSettings(
	browser: EffectiveBrowserSettings,
	paths: { user: string; project?: string },
	projectTrusted: boolean,
) {
	state.host = browser.host;
	state.port = browser.port;
	state.configuredPort = browser.port;
	state.hostConfigured = browser.hostConfigured;
	state.portConfigured = browser.portConfigured;
	state.autoLaunchEnabled = browser.autoLaunchEnabled;
	state.endpointSource = browser.endpointSource;
	state.autoLaunchSource = browser.autoLaunchSource;
	state.browserExecutable = browser.executablePath;
	state.extensionPaths = [...browser.extensionPaths];
	state.browserExecutableSource = browser.executablePathSource;
	state.extensionPathsSource = browser.extensionPathsSource;
	state.settingsFilePath = paths.user;
	state.projectSettingsFilePath = paths.project;
	state.projectSettingsTrusted = projectTrusted;
}
