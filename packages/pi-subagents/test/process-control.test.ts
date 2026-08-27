import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { test } from "vitest";
import { terminateProcess } from "../src/process-control.js";

test("terminateProcess escalates when a child ignores SIGTERM", {
	skip: process.platform === "win32",
}, async () => {
	const child = spawn(
		process.execPath,
		[
			"-e",
			"process.on('SIGTERM',()=>{}); process.stdout.write('ready\\n'); setInterval(()=>{},1000)",
		],
		{ detached: true, stdio: ["ignore", "pipe", "ignore"] },
	);
	await new Promise<void>((resolve) => child.stdout?.once("data", () => resolve()));
	const started = Date.now();
	terminateProcess(child, 30);
	await new Promise<void>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error("child did not exit")), 1000);
		child.once("close", () => {
			clearTimeout(timer);
			resolve();
		});
	});
	assert.ok(Date.now() - started < 1000);
});
test("terminateProcess cleans a group whose leader exited before inherited stdout closed", {
	skip: process.platform === "win32",
}, async () => {
	const child = spawn(
		process.execPath,
		[
			"-e",
			"require('node:child_process').spawn(process.execPath,['-e',\"process.on('SIGTERM',()=>{});process.stdout.write('descendant-ready\\\\n');setTimeout(()=>{},2000)\"],{stdio:['ignore','inherit','ignore']}).unref()",
		],
		{ detached: true, stdio: ["ignore", "pipe", "ignore"] },
	);
	const leaderExited = new Promise<void>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error("process-group leader did not exit")), 1000);
		child.once("exit", () => {
			clearTimeout(timer);
			resolve();
		});
		child.once("error", reject);
	});
	const descendantReady = new Promise<void>((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new Error("process-group descendant did not start")),
			1000,
		);
		child.stdout?.once("data", () => {
			clearTimeout(timer);
			resolve();
		});
	});
	await Promise.all([leaderExited, descendantReady]);

	const started = Date.now();
	terminateProcess(child, 30);
	await new Promise<void>((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new Error("descendant kept inherited stdout open")),
			3000,
		);
		child.once("close", () => {
			clearTimeout(timer);
			resolve();
		});
	});
	assert.ok(Date.now() - started < 1000);
});
