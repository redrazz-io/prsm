import { existsSync } from "fs";
import { readFile, writeFile, mkdir } from "fs/promises";
import { dirname } from "path";

export async function fileExists(p: string): Promise<boolean> {
	return existsSync(p);
}

export async function readTextFile(p: string): Promise<string> {
	return readFile(p, "utf-8");
}

export async function writeTextFile(p: string, content: string): Promise<void> {
	await mkdir(dirname(p), { recursive: true });
	await writeFile(p, content, "utf-8");
}

export async function ensureDir(p: string): Promise<void> {
	await mkdir(p, { recursive: true });
}

export function findUpSync(filename: string, from: string): string | null {
	let dir = from;
	while (true) {
		const candidate = `${dir}/${filename}`;
		if (existsSync(candidate)) return candidate;
		const parent = dirname(dir);
		if (parent === dir) return null;
		dir = parent;
	}
}
