local M = {}
local log = require("lib.log")

local window_rule_phases = {
  generated = "rules/generated.lua",
  window_state = "rules/window-state.lua",
}

function M.log(message)
  return log.write(message)
end

local function warn(warnings, message)
  warnings[#warnings + 1] = message
end

local function load_rule_file(path, warnings)
  local chunk, load_error = loadfile(path)
  if not chunk then
    warn(warnings, path .. ": " .. load_error)
    return {}
  end

  local ok, rules = pcall(chunk)
  if not ok then
    warn(warnings, path .. ": " .. rules)
    return {}
  end

  if type(rules) ~= "table" then
    warn(warnings, path .. ": expected a table return value")
    return {}
  end

  return rules
end

local function is_valid_rule(rule)
  return type(rule) == "table"
    and type(rule.id) == "string"
    and type(rule.match) == "table"
    and type(rule.effects) == "table"
end

local function is_pair(value)
  return type(value) == "table" and value[1] ~= nil and value[2] ~= nil
end

local function normalize_effect(key, value)
  if (key == "size" or key == "move") and is_pair(value) then
    return tostring(value[1]) .. " " .. tostring(value[2])
  end

  return value
end

local function copy_rule(rule)
  local effects = rule.effects
  local compiled = {
    name = rule.name or rule.id,
    match = rule.match,
  }

  for key, value in pairs(effects) do
    compiled[key] = normalize_effect(key, value)
  end

  return compiled
end

function M.compile_rules(paths)
  local compiled = {}
  local warnings = {}

  for _, path in ipairs(paths) do
    local rules = load_rule_file(path, warnings)

    for index, rule in ipairs(rules) do
      if is_valid_rule(rule) then
        compiled[#compiled + 1] = copy_rule(rule)
      else
        warn(warnings, path .. ": invalid rule at index " .. tostring(index))
      end
    end
  end

  return {
    rules = compiled,
    warnings = warnings,
  }
end

function M.apply_window_rules(paths)
  local result = M.compile_rules(paths)

  for _, rule in ipairs(result.rules) do
    hl.window_rule(rule)
  end

  result.applied = #result.rules
  return result
end

function M.apply_window_rule_phase(config_dir, phase)
  local relative_path = window_rule_phases[phase]
  if not relative_path then
    error("unknown window rule phase: " .. tostring(phase))
  end

  local result = M.apply_window_rules({
    config_dir .. "/" .. relative_path,
  })
  result.phase = phase
  return result
end

function M.report_warnings(warnings)
  for _, message in ipairs(warnings) do
    local line = "hypr lua migration warning: " .. message
    print(line)
    M.log(line)
  end
end

function M.report_results(results)
  for _, result in ipairs(results) do
    M.report_warnings(result.warnings)
  end
end

return M
