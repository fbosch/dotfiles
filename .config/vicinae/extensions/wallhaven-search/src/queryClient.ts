import { QueryClient } from "@tanstack/react-query";
import { PERSIST_MAX_AGE, QUERY_STALE_TIME } from "./constants";

export const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			staleTime: QUERY_STALE_TIME,
			gcTime: PERSIST_MAX_AGE,
			refetchOnWindowFocus: false,
			retry: 1,
		},
	},
});
