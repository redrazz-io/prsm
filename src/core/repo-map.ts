import type { RepoEntry, RepoMap } from "../types";

export function findRepo(
	repos: RepoMap,
	name: string,
): { entry: RepoEntry; category: string } | null {
	for (const [category, categoryRepos] of Object.entries(repos)) {
		if (name in categoryRepos) {
			return { entry: categoryRepos[name], category };
		}
	}
	return null;
}

export function listAllRepos(repos: RepoMap): Array<{
	name: string;
	category: string;
	entry: RepoEntry;
}> {
	const result: Array<{ name: string; category: string; entry: RepoEntry }> =
		[];
	for (const [category, categoryRepos] of Object.entries(repos)) {
		for (const [name, entry] of Object.entries(categoryRepos)) {
			result.push({ name, category, entry });
		}
	}
	return result;
}
