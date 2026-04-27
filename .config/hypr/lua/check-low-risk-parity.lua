local root = arg[1] or (os.getenv("HOME") .. "/dotfiles")
local hypr = root .. "/.config/hypr"

local function read_file(path)
  local file = assert(io.open(path, "r"))
  local content = file:read("*a")
  file:close()
  return content
end

local function trim(value)
  return value:match("^%s*(.-)%s*$")
end

local function strip_comment(line)
  return trim((line:gsub("%s+#.*$", "")))
end

local function parse_scalar(value)
  value = trim(value:gsub(";+$", ""))

  if value == "true" or value == "on" or value:match("^yes") then
    return true
  end

  if value == "false" or value == "no" or value == "off" then
    return false
  end

  local number = tonumber(value)
  if number ~= nil then
    return number
  end

  return value
end

local function value_key(value)
  if type(value) == "number" then
    return tostring(tonumber(value))
  end

  if type(value) ~= "table" then
    return tostring(value)
  end

  local keys = {}
  for key in pairs(value) do
    keys[#keys + 1] = key
  end
  table.sort(keys, function(left, right)
    return tostring(left) < tostring(right)
  end)

  local parts = {}
  for _, key in ipairs(keys) do
    parts[#parts + 1] = tostring(key) .. "=" .. value_key(value[key])
  end
  return "{" .. table.concat(parts, ",") .. "}"
end

local function split_csv(value)
  local parts = {}
  for part in value:gmatch("([^,]+)") do
    parts[#parts + 1] = trim(part)
  end
  return parts
end

local function split_csv_keep_empty(value)
  local parts = {}
  for part in (value .. ","):gmatch("(.-),") do
    parts[#parts + 1] = trim(part)
  end
  return parts
end

local function flatten_config(target, prefix, config)
  for key, value in pairs(config) do
    local full_key = prefix == "" and key or (prefix .. "." .. key)
    if type(value) == "table" then
      flatten_config(target, full_key, value)
    else
      target[full_key] = value
    end
  end
end

local function parse_config_file(path, skip_key)
  local result = {}
  local stack = {}

  for line in read_file(path):gmatch("[^\n]+") do
    line = strip_comment(line)

    local block = line:match("^([%w_]+)%s*{%s*$")
    if block then
      stack[#stack + 1] = block
    elseif line == "}" then
      stack[#stack] = nil
    else
      local key, value = line:match("^([%w_%.]+)%s*=%s*(.*)$")
      if key and key ~= skip_key and key ~= "gesture" and key ~= "source" and key ~= "monitor" and key ~= "workspace" then
        local parts = {}
        for _, item in ipairs(stack) do
          parts[#parts + 1] = item
        end
        parts[#parts + 1] = key
        result[table.concat(parts, ".")] = parse_scalar(value)
      end
    end
  end

  return result
end

local function parse_env(path)
  local result = {}
  for line in read_file(path):gmatch("[^\n]+") do
    line = strip_comment(line)
    local name, value = line:match("^env%s*=%s*([^,]+),(.+)$")
    if name then
      result[#result + 1] = trim(name) .. "=" .. trim(value)
    end
  end
  return result
end

local function parse_layer_rules(path)
  local result = {}
  for line in read_file(path):gmatch("[^\n]+") do
    line = strip_comment(line)
    local namespace, effect = line:match("^layerrule%s*=%s*match:namespace%s+([^,]+),%s*(.+)$")
    if namespace then
      local key, value = effect:match("^(%S+)%s+(.+)$")
      if key == "blur" or key == "no_anim" then
        value = value == "on"
      elseif key == "ignore_alpha" then
        value = tonumber(value)
      end
      result[#result + 1] = trim(namespace) .. "|" .. key .. "=" .. tostring(value)
    end
  end
  return result
end

local function parse_gestures(path)
  local result = {}
  for line in read_file(path):gmatch("[^\n]+") do
    line = strip_comment(line)
    local value = line:match("^gesture%s*=%s*(.+)$")
    if value then
      local parts = split_csv_keep_empty(value)
      result[#result + 1] = parts[1] .. "|" .. parts[2] .. "|" .. parts[3]
    end
  end
  return result
end

local function parse_devices(path)
  local devices = {}
  local current = nil

  for line in read_file(path):gmatch("[^\n]+") do
    line = strip_comment(line)
    if line:match("^device%s*{%s*$") then
      current = {}
    elseif line == "}" and current then
      devices[#devices + 1] = current
      current = nil
    elseif current then
      local key, value = line:match("^([%w_]+)%s*=%s*(.+)$")
      if key then
        current[key] = parse_scalar(value)
      end
    end
  end

  local result = {}
  for _, device in ipairs(devices) do
    local name = device.name
    device.name = nil
    result[#result + 1] = name .. "|" .. value_key(device)
  end
  return result
end

local function parse_programs(path)
  local result = {}
  for line in read_file(path):gmatch("[^\n]+") do
    line = strip_comment(line)
    local key, value = line:match("^%$([%w_]+)%s*=%s*(.+)$")
    if key then
      result[key] = trim(value)
    end
  end
  return result
end

local function parse_monitors(path)
  local result = {}
  for line in read_file(path):gmatch("[^\n]+") do
    line = strip_comment(line)
    local value = line:match("^monitor%s*=%s*(.+)$")
    if value then
      local parts = split_csv_keep_empty(value)
      local rule = {
        output = parts[1] or "",
      }

      if parts[2] == "transform" then
        rule.transform = parse_scalar(parts[3] or "")
      else
        rule.mode = parts[2] or ""
        rule.position = parts[3] or ""
        rule.scale = parse_scalar(parts[4] or "")

        local index = 5
        while index <= #parts do
          local key = parts[index]
          if key == "hdr" then
            rule.cm = "hdr"
          elseif key ~= "" then
            rule[key] = parse_scalar(parts[index + 1] or "")
          end
          index = key == "hdr" and (index + 1) or (index + 2)
        end
      end

      result[#result + 1] = value_key(rule)
    end
  end
  return result
end

local function parse_workspace_rules(path)
  local result = {}
  for line in read_file(path):gmatch("[^\n]+") do
    line = strip_comment(line)
    local value = line:match("^workspace%s*=%s*(.+)$")
    if value then
      local parts = split_csv(value)
      local rule = { workspace = parts[1] }
      for index = 2, #parts do
        local key, raw = parts[index]:match("^([^:]+):(.+)$")
        if key == "monitor" then
          rule.monitor = raw
        elseif key == "default" then
          rule.default = raw == "true"
        end
      end
      result[#result + 1] = value_key(rule)
    end
  end
  return result
end

local function parse_curves_and_animations(path)
  local curves = {}
  local animations = {}
  local skipped = {}

  for line in read_file(path):gmatch("[^\n]+") do
    line = strip_comment(line)
    local bezier = line:match("^bezier%s*=%s*(.+)$")
    if bezier then
      local parts = split_csv(bezier)
      curves[#curves + 1] = parts[1] .. "|" .. value_key(tonumber(parts[2])) .. "," .. value_key(tonumber(parts[3])) .. "," .. value_key(tonumber(parts[4])) .. "," .. value_key(tonumber(parts[5]))
    end

    local animation = line:match("^animation%s*=%s*(.+)$")
    if animation then
      local parts = split_csv(animation)
      if parts[2] == "0" or parts[2] == "1" then
        animations[#animations + 1] = parts[1] .. "|" .. (parts[2] == "1" and "true" or "false") .. "|" .. value_key(tonumber(parts[3] or "")) .. "|" .. (parts[4] or "") .. "|" .. (parts[5] or "")
      else
        skipped[#skipped + 1] = animation
      end
    end
  end

  return curves, animations, skipped
end

local captured = {
  env = {},
  config = {},
  curves = {},
  animations = {},
  layer_rules = {},
  gestures = {},
  devices = {},
  monitors = {},
  workspace_rules = {},
}

hl = {
  env = function(name, value)
    captured.env[#captured.env + 1] = name .. "=" .. value
  end,
  config = function(config)
    flatten_config(captured.config, "", config)
  end,
  curve = function(name, curve)
    local points = curve.points
    captured.curves[#captured.curves + 1] = name .. "|" .. value_key(points[1][1]) .. "," .. value_key(points[1][2]) .. "," .. value_key(points[2][1]) .. "," .. value_key(points[2][2])
  end,
  animation = function(animation)
    captured.animations[#captured.animations + 1] = animation.leaf .. "|" .. tostring(animation.enabled) .. "|" .. value_key(animation.speed or "") .. "|" .. tostring(animation.bezier or "") .. "|" .. tostring(animation.style or "")
  end,
  layer_rule = function(rule)
    local namespace = rule.match.namespace
    for key, value in pairs(rule) do
      if key ~= "match" then
        captured.layer_rules[#captured.layer_rules + 1] = namespace .. "|" .. key .. "=" .. tostring(value)
      end
    end
  end,
  gesture = function(gesture)
    captured.gestures[#captured.gestures + 1] = tostring(gesture.fingers) .. "|" .. gesture.direction .. "|" .. gesture.action
  end,
  device = function(device)
    local copy = {}
    for key, value in pairs(device) do
      if key ~= "name" then
        copy[key] = value
      end
    end
    captured.devices[#captured.devices + 1] = device.name .. "|" .. value_key(copy)
  end,
  monitor = function(monitor)
    captured.monitors[#captured.monitors + 1] = value_key(monitor)
  end,
  workspace_rule = function(rule)
    captured.workspace_rules[#captured.workspace_rules + 1] = value_key(rule)
  end,
}

local programs = dofile(hypr .. "/lua/programs.lua")
dofile(hypr .. "/lua/base.lua")
dofile(hypr .. "/lua/monitors.lua")
dofile(hypr .. "/lua/rules/workspace-base.lua")
dofile(hypr .. "/lua/environment.lua")
dofile(hypr .. "/lua/appearance.lua")
dofile(hypr .. "/lua/rules/layer.lua")
dofile(hypr .. "/lua/input.lua")
dofile(hypr .. "/lua/animations.lua")

local expected_curves, expected_animations, skipped_animations = parse_curves_and_animations(hypr .. "/animations.conf")

local expected = {
  env = parse_env(hypr .. "/environment.conf"),
  config = {},
  curves = expected_curves,
  animations = expected_animations,
  layer_rules = parse_layer_rules(hypr .. "/appearance.conf"),
  gestures = parse_gestures(hypr .. "/input.conf"),
  devices = parse_devices(hypr .. "/input.conf"),
  programs = parse_programs(hypr .. "/hyprland.conf"),
  monitors = {},
  workspace_rules = parse_workspace_rules(hypr .. "/hyprland.conf"),
}

for _, monitor in ipairs(parse_monitors(hypr .. "/monitors.conf")) do
  expected.monitors[#expected.monitors + 1] = monitor
end

for _, monitor in ipairs(parse_monitors(hypr .. "/hyprland.conf")) do
  expected.monitors[#expected.monitors + 1] = monitor
end

for key, value in pairs(parse_config_file(hypr .. "/hyprland.conf")) do
  expected.config[key] = value
end

for key, value in pairs(parse_config_file(hypr .. "/appearance.conf", "layerrule")) do
  expected.config[key] = value
end

for key, value in pairs(parse_config_file(hypr .. "/input.conf")) do
  if not key:match("^device%.") then
    expected.config[key] = value
  end
end

expected.config["animations.enabled"] = parse_config_file(hypr .. "/animations.conf")["animations.enabled"]

local failures = {}

local function add_failure(message)
  failures[#failures + 1] = message
end

local function compare_maps(label, left, right)
  for key, value in pairs(left) do
    if value_key(right[key]) ~= value_key(value) then
      add_failure(label .. " mismatch for " .. key .. ": conf=" .. value_key(value) .. " lua=" .. value_key(right[key]))
    end
  end

  for key in pairs(right) do
    if left[key] == nil then
      add_failure(label .. " extra Lua key " .. key .. "=" .. value_key(right[key]))
    end
  end
end

local function compare_lists(label, left, right)
  if #left ~= #right then
    add_failure(label .. " count mismatch: conf=" .. #left .. " lua=" .. #right)
  end

  local count = math.max(#left, #right)
  for index = 1, count do
    if left[index] ~= right[index] then
      add_failure(label .. " mismatch at " .. index .. ": conf=" .. tostring(left[index]) .. " lua=" .. tostring(right[index]))
    end
  end
end

compare_lists("env", expected.env, captured.env)
compare_maps("config", expected.config, captured.config)
compare_lists("curves", expected.curves, captured.curves)
compare_lists("animations", expected.animations, captured.animations)
compare_lists("layer rules", expected.layer_rules, captured.layer_rules)
compare_lists("gestures", expected.gestures, captured.gestures)
compare_lists("devices", expected.devices, captured.devices)
compare_maps("programs", expected.programs, {
  terminal = programs.terminal,
  fileManager = programs.file_manager,
  browser = programs.browser,
  menu = programs.menu,
})
compare_lists("monitors", expected.monitors, captured.monitors)
compare_lists("workspace rules", expected.workspace_rules, captured.workspace_rules)

local known_skips = {
  "layersIn, ags-confirm, 1, 15, pop, popin 98%",
  "layersOut, ags-confirm, 1, 8, pop",
  "layersIn, ags-layout-switcher, 0",
  "layersOut, ags-layout-switcher, 0",
  "layersIn, ags-window-switcher, 0",
  "layersOut, ags-window-switcher, 0",
}

compare_lists("known skipped layer animations", known_skips, skipped_animations)

if #failures > 0 then
  for _, failure in ipairs(failures) do
    io.stderr:write(failure .. "\n")
  end
  os.exit(1)
end

print("low-risk Hypr Lua parity ok")
print("known skipped layer animations: " .. tostring(#skipped_animations))
