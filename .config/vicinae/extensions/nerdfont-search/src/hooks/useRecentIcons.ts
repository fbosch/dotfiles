import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LocalStorage } from "@vicinae/api";

const RECENT_ICONS_KEY = "recentIconsData";
const MAX_RECENT_ICONS = 20;

type RecentIcon = {
	id: string;
	char: string;
	code: string;
	hexCode: string;
	htmlEntity: string;
	displayName: string;
	nerdFontId: string;
	packLabel: string;
	iconPath: string;
};

async function loadRecentIcons(): Promise<RecentIcon[]> {
	const stored = await LocalStorage.getItem<string>(RECENT_ICONS_KEY);
	if (!stored) return [];

	try {
		return JSON.parse(stored) as RecentIcon[];
	} catch {
		return [];
	}
}

async function saveRecentIcons(icons: RecentIcon[]): Promise<void> {
	await LocalStorage.setItem(RECENT_ICONS_KEY, JSON.stringify(icons));
}

export function useRecentIcons() {
	const queryClient = useQueryClient();

	const { data: recentIcons = [] } = useQuery({
		queryKey: ["recentIcons"],
		queryFn: loadRecentIcons,
		staleTime: Infinity,
	});

	const addRecentMutation = useMutation({
		mutationFn: async (icon: RecentIcon) => {
			const updated = [
				icon,
				...recentIcons.filter((r) => r.id !== icon.id),
			].slice(0, MAX_RECENT_ICONS);

			await saveRecentIcons(updated);
			return updated;
		},
		onSuccess: (updated) => {
			queryClient.setQueryData(["recentIcons"], updated);
		},
	});

	const clearRecentMutation = useMutation({
		mutationFn: async () => {
			await LocalStorage.removeItem(RECENT_ICONS_KEY);
			return [];
		},
		onSuccess: () => {
			queryClient.setQueryData(["recentIcons"], []);
		},
	});

	return {
		recentIcons,
		addRecent: (icon: RecentIcon) => addRecentMutation.mutate(icon),
		clearRecent: () => clearRecentMutation.mutate(),
	};
}

export type { RecentIcon };
