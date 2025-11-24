import { QueryClient } from "@tanstack/react-query";
import { QUERY_GC_TIME, QUERY_STALE_TIME } from "./constants";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: QUERY_STALE_TIME,
      gcTime: QUERY_GC_TIME,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});
