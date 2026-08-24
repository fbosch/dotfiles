interface UtilityPrefetchOptions<Id> {
	prepare(id: Id): void;
	cancel(id: Id): void;
	activate(id: Id): void;
	schedule(callback: () => void): () => void;
}

export interface UtilityPrefetch<Id> {
	intentStart(id: Id): void;
	intentEnd(id: Id): void;
	intentClear(id: Id): void;
	activate(id: Id): void;
}

export function createUtilityPrefetch<Id>({
	prepare,
	cancel,
	activate,
	schedule,
}: UtilityPrefetchOptions<Id>): UtilityPrefetch<Id> {
	const intentCounts = new Map<Id, number>();
	const prepared = new Set<Id>();
	const pendingRelease = new Map<Id, () => void>();

	function cancelPendingRelease(id: Id): void {
		pendingRelease.get(id)?.();
		pendingRelease.delete(id);
	}

	function scheduleRelease(id: Id): void {
		if (prepared.has(id) === false || pendingRelease.has(id)) return;
		pendingRelease.set(
			id,
			schedule(() => {
				pendingRelease.delete(id);
				prepared.delete(id);
				cancel(id);
			}),
		);
	}

	return {
		intentStart(id) {
			cancelPendingRelease(id);
			intentCounts.set(id, (intentCounts.get(id) ?? 0) + 1);
			if (prepared.has(id)) return;
			prepared.add(id);
			prepare(id);
		},
		intentEnd(id) {
			const count = intentCounts.get(id) ?? 0;
			if (count <= 1) intentCounts.delete(id);
			else intentCounts.set(id, count - 1);
			if (count !== 1 || prepared.has(id) === false) return;
			scheduleRelease(id);
		},
		intentClear(id) {
			intentCounts.delete(id);
			scheduleRelease(id);
		},
		activate(id) {
			cancelPendingRelease(id);
			intentCounts.delete(id);
			prepared.delete(id);
			activate(id);
		},
	};
}
