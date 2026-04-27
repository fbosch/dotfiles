local root = arg[1] or (os.getenv("HOME") .. "/dotfiles")
local hypr = root .. "/.config/hypr"

local files = {
  "hyprland.conf",
  "monitors.conf",
  "keybinds.conf",
  "animations.conf",
  "rules.conf",
  "autostart.conf",
  "environment.conf",
  "appearance.conf",
  "input.conf",
  "generated-rules.conf",
  "window-state-rules.conf",
}

local source_lines = {
  ["hyprland.conf"] = {
    source = true,
  },
  ["rules.conf"] = {
    source = true,
  },
}

local known_keywords = {
  bezier = true,
  binde = true,
  bind = true,
  bindel = true,
  bindir = true,
  bindl = true,
  bindm = true,
  bindn = true,
  bindnitl = true,
  bindo = true,
  bindr = true,
  env = true,
  exec_once = true,
  gesture = true,
  monitor = true,
  submap = true,
  windowrule = true,
  workspace = true,
}

local known_blocks = {
  animations = true,
  binds = true,
  cursor = true,
  debug = true,
  decoration = true,
  device = true,
  dwindle = true,
  general = true,
  input = true,
  layout = true,
  master = true,
  misc = true,
  opengl = true,
  render = true,
  scrolling = true,
  xwayland = true,
}

local known_nested_blocks = {
  blur = true,
  shadow = true,
  touchpad = true,
}

local function read_file(path)
  local file = io.open(path, "r")
  if not file then
    return nil
  end

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

local function normalize_keyword(keyword)
  return keyword:gsub("-", "_")
end

local uncategorized = {}

for _, name in ipairs(files) do
  local path = hypr .. "/" .. name
  local content = read_file(path)

  if content then
    local stack = {}
    local line_number = 0

    for line in content:gmatch("[^\n]+") do
      line_number = line_number + 1
      local active = strip_comment(line)

      if active ~= "" then
        local block = active:match("^([%w_]+)%s*{%s*$")
        local key = active:match("^([%w_%-]+)%s*=")

        if block then
          if #stack == 0 and known_blocks[block] then
            stack[#stack + 1] = block
          elseif #stack > 0 and known_nested_blocks[block] then
            stack[#stack + 1] = block
          else
            uncategorized[#uncategorized + 1] = name .. ":" .. line_number .. ": " .. active
          end
        elseif active == "}" then
          stack[#stack] = nil
        elseif key then
          local normalized = normalize_keyword(key)
          local is_known_config_assignment = #stack > 0
          local is_known_keyword = known_keywords[normalized]
          local is_known_source = source_lines[name] and source_lines[name][normalized]

          if not is_known_config_assignment and not is_known_keyword and not is_known_source then
            uncategorized[#uncategorized + 1] = name .. ":" .. line_number .. ": " .. active
          end
        end
      end
    end
  end
end

if #uncategorized > 0 then
  for _, item in ipairs(uncategorized) do
    io.stderr:write(item .. "\n")
  end
  os.exit(1)
end

print("hypr source graph audit ok")
