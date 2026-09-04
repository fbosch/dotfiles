local script_path = debug.getinfo(1, "S").source:sub(2)
local config_dir = script_path:match("^(.*)/tests/anr_tag_ignore_spec%.lua$") or ".config/hypr"
package.path = config_dir .. "/?.lua;" .. config_dir .. "/?/init.lua;" .. package.path

local module_name = "plugins.anr_tag_ignore"
local original_hl = _G.hl
local original_getenv = os.getenv
local original_io_open = io.open

describe("ANR tag ignore plugin adapter", function()
	local loaded_path
	local loaded_plugins
	local configured

	before_each(function()
		package.loaded[module_name] = nil
		loaded_path = nil
		loaded_plugins = {}
		configured = nil

		_G.hl = {
			config = function(value)
				configured = value
			end,
			get_loaded_plugins = function()
				return loaded_plugins
			end,
			plugin = {
				load = function(path)
					loaded_path = path
				end,
			},
		}

		os.getenv = function(name)
			if name == "HYPR_ANR_TAG_IGNORE_PLUGIN" then
				return "/nix/store/anr-tag-ignore/lib/libanr-tag-ignore.so"
			end
			return original_getenv(name)
		end
	end)

	after_each(function()
		package.loaded[module_name] = nil
		_G.hl = original_hl
		os.getenv = original_getenv
		io.open = original_io_open
	end)

	it("waits for the plugin-triggered reload before configuring tags", function()
		require(module_name)

		assert.are.equal("/nix/store/anr-tag-ignore/lib/libanr-tag-ignore.so", loaded_path)
		assert.is_nil(configured)
	end)

	it("configures ignored tags after the plugin is loaded", function()
		loaded_plugins = { { name = "anr-tag-ignore" } }

		require(module_name)

		assert.are.equal("intentionally-frozen", configured.plugin.anr_tag_ignore.ignored_tags)
	end)

	it("loads from the current system after a switch adds the plugin", function()
		os.getenv = function(name)
			if name == "HYPR_ANR_TAG_IGNORE_PLUGIN" then
				return nil
			end
			return original_getenv(name)
		end
		io.open = function(path, mode)
			if path == "/run/current-system/sw/lib/libanr-tag-ignore.so" then
				return { close = function() end }
			end
			return original_io_open(path, mode)
		end

		require(module_name)

		assert.are.equal("/run/current-system/sw/lib/libanr-tag-ignore.so", loaded_path)
		assert.is_nil(configured)
	end)

	it("does nothing when the plugin path is unavailable", function()
		os.getenv = function(name)
			if name == "HYPR_ANR_TAG_IGNORE_PLUGIN" then
				return nil
			end
			return original_getenv(name)
		end
		io.open = function(path, mode)
			if path == "/run/current-system/sw/lib/libanr-tag-ignore.so" then
				return nil
			end
			return original_io_open(path, mode)
		end

		require(module_name)

		assert.is_nil(loaded_path)
		assert.is_nil(configured)
	end)

	it("does not abort config parsing when plugin loading fails", function()
		hl.plugin.load = function()
			error("load failed")
		end

		assert.has_no.errors(function()
			require(module_name)
		end)
		assert.is_nil(configured)
	end)
end)
