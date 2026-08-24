import type { spawn } from "node:child_process";

export const KILL_GRACE_MS = 5000;

function signalProcess(proc: ReturnType<typeof spawn>, signal: NodeJS.Signals): void {
	if (process.platform !== "win32" && proc.pid) {
		try {
			process.kill(-proc.pid, signal);
			return;
		} catch {
			// Fall back to signaling the immediate child when process-group signaling is unavailable.
		}
	}
	try {
		proc.kill(signal);
	} catch {
		// The process may already have exited.
	}
}

export function terminateProcess(
	proc: ReturnType<typeof spawn>,
	graceMs = KILL_GRACE_MS,
): () => void {
	const leaderExited = proc.exitCode !== null || proc.signalCode !== null;
	const capturedOutputClosed = [proc.stdout, proc.stderr].every(
		(stream) => !stream || stream.readableEnded || stream.destroyed,
	);
	let closed = leaderExited && capturedOutputClosed;
	const onClose = () => {
		closed = true;
	};
	proc.once("close", onClose);
	if (!closed) signalProcess(proc, "SIGTERM");
	const escalation = setTimeout(() => {
		if (!closed) signalProcess(proc, "SIGKILL");
	}, graceMs);
	escalation.unref();
	return () => {
		clearTimeout(escalation);
		proc.off("close", onClose);
	};
}
