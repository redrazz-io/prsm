import yaml from "js-yaml";

export function parseYaml<T = unknown>(content: string): T {
  return yaml.load(content) as T;
}

export function dumpYaml(value: unknown): string {
  return yaml.dump(value, { indent: 2, lineWidth: -1 });
}
