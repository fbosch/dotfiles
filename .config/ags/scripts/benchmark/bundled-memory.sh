#!/usr/bin/env bash
# Sourced by the shared AGS benchmark runner to measure its launcher and GJS process tree.
# shellcheck disable=SC2034
MEMORY_SCOPES=(launcher gjs combined)
declare -A memory_before_rss memory_after_rss memory_delta_rss memory_sum_rss memory_peak_rss memory_samples_rss memory_avg_rss
declare -A memory_before_pss memory_after_pss memory_delta_pss memory_sum_pss memory_peak_pss memory_samples_pss memory_avg_pss

function run_bundled_memory_benchmark() {
  for scope in "${MEMORY_SCOPES[@]}"; do
    memory_before_rss[$scope]=""
    memory_after_rss[$scope]=""
    memory_delta_rss[$scope]=""
    memory_sum_rss[$scope]=0
    memory_peak_rss[$scope]=""
    memory_samples_rss[$scope]=0
    memory_avg_rss[$scope]=""
    memory_before_pss[$scope]=""
    memory_after_pss[$scope]=""
    memory_delta_pss[$scope]=""
    memory_sum_pss[$scope]=0
    memory_peak_pss[$scope]=""
    memory_samples_pss[$scope]=0
    memory_avg_pss[$scope]=""
  done

  if target_enabled "memory"; then
    printf -- "%s\n" "- memory process tree over ${BENCH_MEM_CYCLES} cycles"
    capture_memory_sample
    for scope in "${MEMORY_SCOPES[@]}"; do
      memory_before_rss[$scope]="$(sample_scope_rss_kb "$scope")"
      memory_before_pss[$scope]="$(sample_scope_pss_kb "$scope")"
    done

    for _ in $(seq 1 "$BENCH_MEM_CYCLES"); do
      request '{"action":"next"}'
      request '{"action":"hide"}'
      capture_memory_sample
      for scope in "${MEMORY_SCOPES[@]}"; do
        sample_rss="$(sample_scope_rss_kb "$scope")"
        if is_number "$sample_rss"; then
          memory_sum_rss[$scope]="$((memory_sum_rss[$scope] + sample_rss))"
          memory_samples_rss[$scope]="$((memory_samples_rss[$scope] + 1))"
          if ! is_number "${memory_peak_rss[$scope]}" || [[ "$sample_rss" -gt "${memory_peak_rss[$scope]}" ]]; then
            memory_peak_rss[$scope]="$sample_rss"
          fi
        fi
        sample_pss="$(sample_scope_pss_kb "$scope")"
        if is_number "$sample_pss"; then
          memory_sum_pss[$scope]="$((memory_sum_pss[$scope] + sample_pss))"
          memory_samples_pss[$scope]="$((memory_samples_pss[$scope] + 1))"
          if ! is_number "${memory_peak_pss[$scope]}" || [[ "$sample_pss" -gt "${memory_peak_pss[$scope]}" ]]; then
            memory_peak_pss[$scope]="$sample_pss"
          fi
        fi
      done
    done

    capture_memory_sample
    for scope in "${MEMORY_SCOPES[@]}"; do
      memory_after_rss[$scope]="$(sample_scope_rss_kb "$scope")"
      memory_after_pss[$scope]="$(sample_scope_pss_kb "$scope")"
      if is_number "${memory_before_rss[$scope]}" && is_number "${memory_after_rss[$scope]}"; then
        memory_delta_rss[$scope]="$((memory_after_rss[$scope] - memory_before_rss[$scope]))"
      fi
      if is_number "${memory_before_pss[$scope]}" && is_number "${memory_after_pss[$scope]}"; then
        memory_delta_pss[$scope]="$((memory_after_pss[$scope] - memory_before_pss[$scope]))"
      fi
      if [[ "${memory_samples_rss[$scope]}" -gt 0 ]]; then
        memory_avg_rss[$scope]="$((memory_sum_rss[$scope] / memory_samples_rss[$scope]))"
      fi
      if [[ "${memory_samples_pss[$scope]}" -gt 0 ]]; then
        memory_avg_pss[$scope]="$((memory_sum_pss[$scope] / memory_samples_pss[$scope]))"
      fi
      printf "  %s pid=%s rss before=%sKB avg=%sKB peak=%sKB after=%sKB delta=%sKB pss before=%sKB avg=%sKB peak=%sKB after=%sKB delta=%sKB\n" \
        "$scope" "$(scope_pid "$scope")" \
        "${memory_before_rss[$scope]}" "${memory_avg_rss[$scope]}" "${memory_peak_rss[$scope]}" "${memory_after_rss[$scope]}" "${memory_delta_rss[$scope]}" \
        "${memory_before_pss[$scope]}" "${memory_avg_pss[$scope]}" "${memory_peak_pss[$scope]}" "${memory_after_pss[$scope]}" "${memory_delta_pss[$scope]}"
    done

    before_rss_kb="${memory_before_rss[combined]}"
    after_rss_kb="${memory_after_rss[combined]}"
    delta_rss_kb="${memory_delta_rss[combined]}"
    avg_rss_kb="${memory_avg_rss[combined]}"
    rss_peak_kb="${memory_peak_rss[combined]}"
    before_pss_kb="${memory_before_pss[combined]}"
    after_pss_kb="${memory_after_pss[combined]}"
    delta_pss_kb="${memory_delta_pss[combined]}"
    avg_pss_kb="${memory_avg_pss[combined]}"
    pss_peak_kb="${memory_peak_pss[combined]}"
  else
    printf -- "%s\n" "- memory: skipped"
  fi
}
