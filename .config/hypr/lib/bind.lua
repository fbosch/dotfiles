---@class BindResult
---@field pass_event? boolean Pass the original input event to the focused client.
---@field ok? boolean Whether the callback completed successfully.
---@field error? string Failure description when `ok` is false.

---@alias BindCallback fun(...: any): BindResult?
---@alias BindAction string|BindCallback

---@class BindOptions
---@field predicate? fun(...: any): boolean Run the action only when this returns true.
---@field on_false? BindAction Action to run when `predicate` returns false. Defaults to pass.
---@field long_press? boolean
---@field release? boolean
---@field repeating? boolean
---@field non_consuming? boolean
---@field auto_consuming? boolean
---@field mouse? boolean
---@field click? boolean
---@field drag? boolean
---@field ignore_mods? boolean
---@field transparent? boolean
---@field locked? boolean

---@class Bind
---@field pass fun(): BindResult
---@field consume fun(): BindResult
---@field register fun(keys: string, action: BindAction, options?: BindOptions)
local M = {}

---@param action BindAction
---@return BindCallback
local function callback(action)
	if type(action) == "string" then
		return function()
			return hl.dispatch(hl.dsp.exec_cmd(action))
		end
	end

	return action
end

---@return BindResult
function M.pass()
	return { pass_event = true }
end

---@return BindResult
function M.consume()
	return {}
end

---@param keys string
---@param action BindAction
---@param options? BindOptions
function M.register(keys, action, options)
	local predicate = options and options.predicate
	if predicate then
		local on_true = callback(action)
		local on_false = callback(options.on_false or M.pass)
		action = function(...)
			if predicate(...) then
				return on_true(...)
			end

			return on_false(...)
		end
	end

	if not predicate and type(action) == "string" then
		action = hl.dsp.exec_cmd(action)
	end

	if options then
		local native_options = {}
		for key, value in pairs(options) do
			if key ~= "predicate" and key ~= "on_false" then
				native_options[key] = value
			end
		end
		options = next(native_options) and native_options or nil
	end

	hl.bind(keys, action, options)
end

return M
