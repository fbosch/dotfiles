package.path = package.path .. ";./.config/wezterm/?.lua"

local child_process_result = { true, "text/plain\n" }
local callback
local actions = {}

package.loaded.wezterm = {
	target_triple = "x86_64-unknown-linux-gnu",
	action = {
		ActivateTab = function(index)
			return { name = "ActivateTab", index = index }
		end,
		DisableDefaultAssignment = "DisableDefaultAssignment",
		PasteFrom = function(selection)
			return { name = "PasteFrom", selection = selection }
		end,
		SendKey = function(key)
			return { name = "SendKey", key = key }
		end,
		SendString = function(value)
			return { name = "SendString", value = value }
		end,
		callback = function(fn)
			callback = fn
			return { name = "callback" }
		end,
	},
	action_callback = function(fn)
		callback = fn
		return { name = "callback" }
	end,
	run_child_process = function(command)
		assert(command[1] == "wl-paste" and command[2] == "--list-types")
		return table.unpack(child_process_result)
	end,
}

setmetatable(package.loaded.wezterm.action, {
	__index = function(_, name)
		return function(...)
			return { name = name, args = { ... } }
		end
	end,
})

local function assert_eq(actual, expected, label)
	if actual ~= expected then
		error((label or "assert_eq failed") .. ": expected " .. tostring(expected) .. ", got " .. tostring(actual))
	end
end

local config = {}
require("keys")(config)
assert_eq(type(callback), "function", "paste callback registered")

local window = {
	perform_action = function(_, action, pane)
		table.insert(actions, { action = action, pane = pane })
	end,
}
local pane = {}

callback(window, pane)
assert_eq(actions[1].action.name, "PasteFrom", "text clipboard action")
assert_eq(actions[1].action.selection, "Clipboard", "text clipboard selection")
assert_eq(actions[1].pane, pane, "text clipboard pane")

child_process_result = { true, "image/png\n" }
actions = {}
callback(window, pane)
assert_eq(actions[1].action.name, "SendKey", "image clipboard action")
assert_eq(actions[1].action.key.key, "V", "image clipboard key")
assert_eq(actions[1].action.key.mods, "CTRL", "image clipboard modifiers")
assert_eq(actions[1].pane, pane, "image clipboard pane")

print("keys_spec: ok")
