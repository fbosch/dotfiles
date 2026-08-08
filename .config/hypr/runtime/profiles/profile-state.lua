#!/usr/bin/env luajit

local script_dir = arg[0]:match("^(.*)/[^/]+$") or "."
package.path = script_dir .. "/../../?.lua;" .. package.path

local profile_state = require("lib.profile_state")

local function fail(message)
	error("profile-state: " .. message, 0)
end

local function encode_state(generation, selection, resolved)
	local source_claims = {
		gaming = {},
		powersave = {},
	}

	for line in io.lines() do
		local profile, source, count = line:match("^([^\t]+)\t([^\t]+)\t([^\t]+)$")
		if
			not profile
			or not source
			or not count
			or profile == "default"
			or profile_state.is_profile(profile) == false
		then
			fail("invalid source claim")
		end

		local numeric_count = tonumber(count)
		if profile_state.is_source(source) == false or not numeric_count then
			fail("invalid source claim")
		end

		source_claims[profile][source] = numeric_count
	end

	return profile_state.encode(generation, selection, resolved, source_claims)
end

local function main()
	if arg[1] == "generation" and arg[2] then
		io.write(profile_state.read(arg[2]).generation)
		return
	end

	if arg[1] == "source-count" and arg[2] and arg[3] and arg[4] then
		if
			arg[3] == "default"
			or profile_state.is_profile(arg[3]) == false
			or profile_state.is_source(arg[4]) == false
		then
			fail("invalid source claim")
		end

		io.write(profile_state.read(arg[2]).sources[arg[3]][arg[4]] or 0)
		return
	end

	if arg[1] == "encode" and arg[2] and arg[3] and arg[4] then
		local written, write_error = io.write(encode_state(tonumber(arg[2]), arg[3], arg[4]))
		if not written then
			fail("cannot write state: " .. tostring(write_error))
		end

		local flushed, flush_error = io.flush()
		if not flushed then
			fail("cannot flush state: " .. tostring(flush_error))
		end
		return
	end

	fail("usage: profile-state.lua <generation|source-count|encode> ...")
end

local ok, error_message = pcall(main)
if ok == false then
	io.stderr:write(tostring(error_message), "\n")
	os.exit(1)
end
