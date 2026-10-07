#!/usr/bin/env python3
"""Controlled GTK toplevels for the private transient-placement probe."""
import ctypes
import json
import os
import select
import sys

gtk = ctypes.CDLL(os.environ["TEST_GTK_LIBRARY"])
pointer = ctypes.c_void_p


def bind(name, args, result=None):
    fn = getattr(gtk, name)
    fn.argtypes = args
    fn.restype = result
    return fn


bind("g_set_prgname", [ctypes.c_char_p])(b"transient-probe")
bind("gtk_init", [])()
new_window = bind("gtk_window_new", [], pointer)
set_title = bind("gtk_window_set_title", [pointer, ctypes.c_char_p])
set_size = bind("gtk_window_set_default_size", [pointer, ctypes.c_int, ctypes.c_int])
set_decorated = bind("gtk_window_set_decorated", [pointer, ctypes.c_int])
set_parent = bind("gtk_window_set_transient_for", [pointer, pointer])
present = bind("gtk_window_present", [pointer])
destroy = bind("gtk_window_destroy", [pointer])
iterate = bind("g_main_context_iteration", [pointer, ctypes.c_int], ctypes.c_int)
windows = {}
print("ready", flush=True)
while True:
    while iterate(None, False):
        pass
    if not select.select([sys.stdin], [], [], 0.01)[0]:
        continue
    line = sys.stdin.readline()
    if not line:
        break
    command = json.loads(line)
    if command["action"] == "open":
        window = new_window()
        windows[command["title"]] = window
        set_title(window, command["title"].encode())
        set_size(window, command.get("width", 60), command.get("height", 40))
        set_decorated(window, False)
        if command.get("parent"):
            set_parent(window, windows[command["parent"]])
        present(window)
    elif command["action"] == "close":
        destroy(windows.pop(command["title"]))
    elif command["action"] == "stop":
        break
for window in windows.values():
    destroy(window)
