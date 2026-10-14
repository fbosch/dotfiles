/* Opt-in test input client. Generated protocol files and binary belong in /tmp. */
#include "virtual-pointer-protocol.h"
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <wayland-client.h>

static void require(bool condition, const char *expression) {
    if (!condition) {
        fprintf(stderr, "private pointer client refused: %s\n", expression);
        exit(EXIT_FAILURE);
    }
}
#define REQUIRE(expression) require((expression), #expression)

static struct zwlr_virtual_pointer_manager_v1 *manager;

static void global(void *data, struct wl_registry *registry, uint32_t name, const char *interface, uint32_t version) {
    (void)data;
    if (!strcmp(interface, "zwlr_virtual_pointer_manager_v1"))
        manager = wl_registry_bind(registry, name, &zwlr_virtual_pointer_manager_v1_interface, version < 2 ? version : 2);
}

static void removed(void *data, struct wl_registry *registry, uint32_t name) {
    (void)data;
    (void)registry;
    (void)name;
}

static uint32_t milliseconds(void) {
    struct timespec time;
    REQUIRE(clock_gettime(CLOCK_MONOTONIC, &time) == 0);
    return (uint32_t)((uint64_t)time.tv_sec * 1000 + time.tv_nsec / 1000000);
}

int main(void) {
    const char *runtime = getenv("XDG_RUNTIME_DIR");
    const char *display = getenv("WAYLAND_DISPLAY");
    const char *signature = getenv("TEST_PRIVATE_SIGNATURE");
    const char *pid = getenv("TEST_PRIVATE_PID");
    /* Refuse the host socket even if this helper is accidentally invoked directly. */
    REQUIRE(runtime && display && signature && pid);
    REQUIRE(!strncmp(runtime, "/tmp/wt.", 8));
    REQUIRE(!strncmp(display, runtime, strlen(runtime)) && display[strlen(runtime)] == '/');
    REQUIRE(strchr(signature, '/') == NULL);
    char lock_path[512], line[128];
    REQUIRE(snprintf(lock_path, sizeof(lock_path), "%s/hypr/%s/hyprland.lock", runtime, signature) < (int)sizeof(lock_path));
    FILE *lock = fopen(lock_path, "r");
    REQUIRE(lock);
    int found = 0;
    while (fgets(line, sizeof(line), lock)) {
        line[strcspn(line, "\r\n")] = 0;
        if (!strcmp(line, pid))
            found = 1;
    }
    fclose(lock);
    REQUIRE(found);
    struct wl_display *connection = wl_display_connect(display);
    REQUIRE(connection);
    struct wl_registry *registry = wl_display_get_registry(connection);
    const struct wl_registry_listener listener = {global, removed};
    wl_registry_add_listener(registry, &listener, NULL);
    REQUIRE(wl_display_roundtrip(connection) >= 0 && manager);
    struct zwlr_virtual_pointer_v1 *pointer = zwlr_virtual_pointer_manager_v1_create_virtual_pointer(manager, NULL);
    REQUIRE(wl_display_roundtrip(connection) >= 0);
    puts("ready");
    fflush(stdout);
    while (fgets(line, sizeof(line), stdin)) {
        unsigned x, y, width, height, button, state;
        if (sscanf(line, "M %u %u %u %u", &x, &y, &width, &height) == 4) {
            REQUIRE(width && height && x <= width && y <= height);
            zwlr_virtual_pointer_v1_motion_absolute(pointer, milliseconds(), x, y, width, height);
        } else if (sscanf(line, "B %u %u", &button, &state) == 2) {
            REQUIRE((button == 272 || button == 273) && state <= 1);
            zwlr_virtual_pointer_v1_button(pointer, milliseconds(), button, state);
        } else if (!strcmp(line, "Q\n")) {
            break;
        } else {
            return 2;
        }
        zwlr_virtual_pointer_v1_frame(pointer);
        REQUIRE(wl_display_roundtrip(connection) >= 0);
        puts("ok");
        fflush(stdout);
    }
    zwlr_virtual_pointer_v1_destroy(pointer);
    zwlr_virtual_pointer_manager_v1_destroy(manager);
    wl_registry_destroy(registry);
    wl_display_disconnect(connection);
    return 0;
}
