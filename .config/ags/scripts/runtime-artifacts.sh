#!/usr/bin/env bash

RUNTIME_ARTIFACTS_SCRIPT_DIR="$(dirname "$(realpath "${BASH_SOURCE[0]}")")"
AGS_CONFIG_DIR="${AGS_CONFIG_DIR:-$(dirname "$RUNTIME_ARTIFACTS_SCRIPT_DIR")}"

RUNTIME_ARTIFACT_ERROR=""
RUNTIME_ARTIFACT_WARNING=""
RUNTIME_ARTIFACT_BUNDLED_HOST_READY=false
AGS_RUNTIME_ARTIFACT_GENERATION_DIR=""

runtime_artifact_fail() {
    RUNTIME_ARTIFACT_ERROR="$1"
    return 1
}

require_private_runtime_directory() {
    local runtime_dir="${XDG_RUNTIME_DIR:-}"
    local owner
    local permissions

    if [[ -z "$runtime_dir" || "$runtime_dir" != /* || ! -d "$runtime_dir" ]]; then
        runtime_artifact_fail "XDG_RUNTIME_DIR must be an existing absolute directory"
        return 1
    fi
    if ! owner="$(stat -c %u -- "$runtime_dir")" || [[ "$owner" != "$EUID" ]]; then
        runtime_artifact_fail "XDG_RUNTIME_DIR must be owned by the current user"
        return 1
    fi
    if ! permissions="$(stat -c %a -- "$runtime_dir")"; then
        runtime_artifact_fail "Unable to inspect XDG_RUNTIME_DIR permissions"
        return 1
    fi
    if (( (8#$permissions & 8#077) != 0 )); then
        runtime_artifact_fail "XDG_RUNTIME_DIR must not be accessible by group or other users"
        return 1
    fi
}

cleanup_runtime_artifacts() {
    local generation="${AGS_RUNTIME_ARTIFACT_GENERATION_DIR:-}"
    if [[ -z "$generation" || ! -d "$generation" ]]; then
        return
    fi
    if [[ "$(dirname "$generation")" != "$XDG_RUNTIME_DIR" ]]; then
        runtime_artifact_fail "Refusing to clean an artifact generation outside XDG_RUNTIME_DIR"
        return 1
    fi
    rm -rf -- "$generation"
}

configure_runtime_artifacts() {
    local mode="$1"
    local generation_prefix

    require_private_runtime_directory || return 1
    case "$mode" in
        session|source-host|bundle)
            generation_prefix="ags-runtime-$mode"
            ;;
        *)
            runtime_artifact_fail "Unknown runtime artifact mode: $mode"
            return 1
            ;;
    esac

    if ! AGS_RUNTIME_ARTIFACT_GENERATION_DIR="$(mktemp -d "$XDG_RUNTIME_DIR/$generation_prefix-XXXXXXXX")"; then
        runtime_artifact_fail "Failed to allocate runtime artifact generation"
        return 1
    fi
    if ! chmod 700 "$AGS_RUNTIME_ARTIFACT_GENERATION_DIR"; then
        cleanup_runtime_artifacts
        runtime_artifact_fail "Failed to secure runtime artifact generation"
        return 1
    fi

    AGS_BUNDLED_CONFIG_PATH="$AGS_CONFIG_DIR/config-bundled.tsx"
    AGS_ABOUT_THIS_PC_CONFIG_PATH="$AGS_CONFIG_DIR/config-about-this-pc.tsx"
    AGS_AI_POINTER_MODULE_CONFIG_PATH="$AGS_CONFIG_DIR/components/ai-pointer/index.tsx"
    AGS_AI_POINTER_ACCESSIBILITY_HELPER_CONFIG_PATH="$AGS_CONFIG_DIR/components/ai-pointer/accessibility/helper.ts"
    AGS_BUNDLED_EXECUTABLE_PATH="$AGS_RUNTIME_ARTIFACT_GENERATION_DIR/ags-bundled-executable"
    AGS_ABOUT_THIS_PC_EXECUTABLE_PATH="$AGS_RUNTIME_ARTIFACT_GENERATION_DIR/ags-about-this-pc-executable"
    AGS_AI_POINTER_ACCESSIBILITY_HELPER_PATH="$AGS_RUNTIME_ARTIFACT_GENERATION_DIR/ags-ai-pointer-accessibility-helper"
    AGS_AI_POINTER_MODULE_PATH="$AGS_RUNTIME_ARTIFACT_GENERATION_DIR/ags-ai-pointer-module.js"
    export \
        AGS_ABOUT_THIS_PC_EXECUTABLE_PATH \
        AGS_AI_POINTER_ACCESSIBILITY_HELPER_PATH \
        AGS_AI_POINTER_MODULE_PATH \
        AGS_RUNTIME_ARTIFACT_GENERATION_DIR
}

require_runtime_artifact_source() {
    local label="$1"
    local path="$2"
    if [[ -f "$path" ]]; then
        return 0
    fi
    runtime_artifact_fail "$label not found: $path"
}

build_executable_artifact() {
    local source="$1"
    local output="$2"
    shift 2
    if ! (cd "$AGS_CONFIG_DIR" && ags bundle "$@" "$source" "$output"); then
        return 1
    fi
    [[ -f "$output" && -x "$output" ]]
}

build_ai_pointer_module() {
    (cd "$AGS_CONFIG_DIR" && python3 scripts/build-ags-module.py \
        --gtk 4 \
        "$AGS_AI_POINTER_MODULE_CONFIG_PATH" \
        "$AGS_AI_POINTER_MODULE_PATH")
}

publish_runtime_artifacts() {
    local mode="$1"
    local build_bundled_host=false
    local strict_about_this_pc=false

    RUNTIME_ARTIFACT_ERROR=""
    RUNTIME_ARTIFACT_WARNING=""
    RUNTIME_ARTIFACT_BUNDLED_HOST_READY=false
    configure_runtime_artifacts "$mode" || return 1

    require_runtime_artifact_source \
        "AI Pointer helper" \
        "$AGS_AI_POINTER_ACCESSIBILITY_HELPER_CONFIG_PATH" || {
        cleanup_runtime_artifacts
        return 1
    }
    require_runtime_artifact_source \
        "AI Pointer module" \
        "$AGS_AI_POINTER_MODULE_CONFIG_PATH" || {
        cleanup_runtime_artifacts
        return 1
    }

    if [[ "$mode" == "bundle" ]]; then
        build_bundled_host=true
        strict_about_this_pc=true
    elif [[ "$mode" == "session" ]] && command -v ags-bundle-runtime >/dev/null 2>&1; then
        build_bundled_host=true
    fi

    if [[ "$build_bundled_host" == "true" ]]; then
        require_runtime_artifact_source "Bundled AGS config" "$AGS_BUNDLED_CONFIG_PATH" || {
            cleanup_runtime_artifacts
            return 1
        }
    fi

    if ! build_executable_artifact \
        "$AGS_AI_POINTER_ACCESSIBILITY_HELPER_CONFIG_PATH" \
        "$AGS_AI_POINTER_ACCESSIBILITY_HELPER_PATH" \
        --gtk 4; then
        cleanup_runtime_artifacts
        runtime_artifact_fail "Failed to build AI Pointer accessibility helper"
        return 1
    fi
    if ! build_ai_pointer_module; then
        cleanup_runtime_artifacts
        runtime_artifact_fail "Failed to build AI Pointer module"
        return 1
    fi

    if [[ "$build_bundled_host" == "false" ]]; then
        if [[ ! -f "$AGS_ABOUT_THIS_PC_CONFIG_PATH" ]]; then
            RUNTIME_ARTIFACT_WARNING="About This PC config not found; source fallback is unavailable"
        fi
        return 0
    fi

    if ! build_executable_artifact \
        "$AGS_BUNDLED_CONFIG_PATH" \
        "$AGS_BUNDLED_EXECUTABLE_PATH"; then
        cleanup_runtime_artifacts
        runtime_artifact_fail "Failed to build bundled AGS executable"
        return 1
    fi

    if [[ ! -f "$AGS_ABOUT_THIS_PC_CONFIG_PATH" ]]; then
        if [[ "$strict_about_this_pc" == "true" ]]; then
            cleanup_runtime_artifacts
            runtime_artifact_fail "About This PC config not found: $AGS_ABOUT_THIS_PC_CONFIG_PATH"
            return 1
        fi
        RUNTIME_ARTIFACT_WARNING="About This PC config not found; source fallback is unavailable"
    elif ! build_executable_artifact \
        "$AGS_ABOUT_THIS_PC_CONFIG_PATH" \
        "$AGS_ABOUT_THIS_PC_EXECUTABLE_PATH"; then
        rm -f -- "$AGS_ABOUT_THIS_PC_EXECUTABLE_PATH"
        if [[ "$strict_about_this_pc" == "true" ]]; then
            cleanup_runtime_artifacts
            runtime_artifact_fail "Failed to build About This PC executable"
            return 1
        fi
        RUNTIME_ARTIFACT_WARNING="Failed to build About This PC; source fallback will be used"
    fi

    RUNTIME_ARTIFACT_BUNDLED_HOST_READY=true
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
    if [[ $# -ne 1 ]]; then
        printf 'usage: %s session|source-host|bundle\n' "$0" >&2
        exit 2
    fi
    if ! publish_runtime_artifacts "$1"; then
        printf '%s\n' "$RUNTIME_ARTIFACT_ERROR" >&2
        exit 1
    fi
    if [[ -n "$RUNTIME_ARTIFACT_WARNING" ]]; then
        printf '%s\n' "$RUNTIME_ARTIFACT_WARNING" >&2
    fi
fi
