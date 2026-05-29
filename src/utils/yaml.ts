import { type Document, parse, parseDocument, stringify } from "yaml";

export function parseYaml<T = unknown>(content: string): T {
	return parse(content) as T;
}

export function dumpYaml(value: unknown): string {
	return stringify(value, { indent: 2, lineWidth: 0 });
}

export function parseYamlDocument(content: string): Document.Parsed {
	return parseDocument(content);
}

export function stringifyYamlDocument(doc: Document): string {
	return doc.toString();
}

export type { Document };
