import type { ResolvedHooks, ResolvedSkill, WorkspaceModel } from "../types";

export function mergeLayers(layers: WorkspaceModel[]): WorkspaceModel {
	if (layers.length === 0)
		throw new Error("mergeLayers requires at least one layer");

	const base = layers[0];
	const result: WorkspaceModel = { ...base };

	for (const layer of layers.slice(1)) {
		// Skills: last wins by name
		const skillMap = new Map<string, ResolvedSkill>(
			result.skills.map((s) => [s.name, s]),
		);
		for (const s of layer.skills) skillMap.set(s.name, s);
		result.skills = Array.from(skillMap.values());

		// Agents: last wins by name
		const agentMap = new Map(result.agents.map((a) => [a.name, a]));
		for (const a of layer.agents) agentMap.set(a.name, a);
		result.agents = Array.from(agentMap.values());

		// Hooks: last wins per event key
		result.hooks = {
			...result.hooks,
			...Object.fromEntries(
				Object.entries(layer.hooks).filter(([, v]) => v != null),
			),
		} as ResolvedHooks;

		// Permissions: additive, deduplicated
		const permSet = new Set([...result.permissions, ...layer.permissions]);
		result.permissions = Array.from(permSet);

		// Output: later layer wins per runtime
		result.output = { ...result.output, ...layer.output };

		// Repos: merge nested categories
		for (const [cat, repos] of Object.entries(layer.repos)) {
			result.repos[cat] = { ...(result.repos[cat] ?? {}), ...repos };
		}
	}

	return result;
}
