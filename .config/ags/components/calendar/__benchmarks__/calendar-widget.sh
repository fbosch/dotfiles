#!/usr/bin/env bash
# Sourced by the shared AGS benchmark runner; result variables feed its stable extras schema.
# shellcheck disable=SC2034
function run_calendar_widget_benchmark() {
  if target_enabled "calendar-widget"; then
    calendar_enabled=true
    printf -- "%s\n" "- calendar-widget baseline (${BENCH_CALENDAR_CYCLES} nav cycles)"
    calendar_before_rss_kb="$(read_combined_rss_kb)"
    calendar_before_pss_kb="$(read_combined_pss_kb)"
    request_calendar '{"action":"hide"}'
    calendar_cold_show_ms="$(timed_calendar_request '{"action":"show"}')"
    sleep "$BENCH_CALENDAR_REFRESH_WAIT"
    request_calendar '{"action":"hide"}'
    calendar_warm_show_ms="$(timed_calendar_request '{"action":"show"}')"
    sleep "$BENCH_CALENDAR_REFRESH_WAIT"

    calendar_next_total_ms=0
    calendar_prev_total_ms=0
    for _ in $(seq 1 "$BENCH_CALENDAR_CYCLES"); do
      nav_ms="$(timed_calendar_request '{"action":"next-month"}')"
      calendar_next_total_ms="$((calendar_next_total_ms + nav_ms))"
      sleep "$BENCH_CYCLE_SLEEP"
    done
    for _ in $(seq 1 "$BENCH_CALENDAR_CYCLES"); do
      nav_ms="$(timed_calendar_request '{"action":"prev-month"}')"
      calendar_prev_total_ms="$((calendar_prev_total_ms + nav_ms))"
      sleep "$BENCH_CYCLE_SLEEP"
    done
    calendar_today_ms="$(timed_calendar_request '{"action":"today"}')"
    sleep "$BENCH_CALENDAR_REFRESH_WAIT"
    request_calendar '{"action":"hide"}'
    calendar_after_rss_kb="$(read_combined_rss_kb)"
    calendar_after_pss_kb="$(read_combined_pss_kb)"
    calendar_delta_rss_kb=""
    calendar_delta_pss_kb=""
    if is_number "$calendar_before_rss_kb" && is_number "$calendar_after_rss_kb"; then
      calendar_delta_rss_kb="$((calendar_after_rss_kb - calendar_before_rss_kb))"
    fi
    if is_number "$calendar_before_pss_kb" && is_number "$calendar_after_pss_kb"; then
      calendar_delta_pss_kb="$((calendar_after_pss_kb - calendar_before_pss_kb))"
    fi
    calendar_next_avg_ms="$((calendar_next_total_ms / BENCH_CALENDAR_CYCLES))"
    calendar_prev_avg_ms="$((calendar_prev_total_ms / BENCH_CALENDAR_CYCLES))"
    printf "  cold_show=%sms warm_show=%sms next_avg=%sms prev_avg=%sms today=%sms rss_delta=%sKB pss_delta=%sKB\n" \
      "$calendar_cold_show_ms" \
      "$calendar_warm_show_ms" \
      "$calendar_next_avg_ms" \
      "$calendar_prev_avg_ms" \
      "$calendar_today_ms" \
      "${calendar_delta_rss_kb:-}" \
      "${calendar_delta_pss_kb:-}"
  else
    printf -- "%s\n" "- calendar-widget: skipped"
  fi
}
