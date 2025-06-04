local config = require("wezterm").config_builder()

require("lua.base")(config)
require("lua.keys")(config)
require("lua.fonts")(config)
require("lua.colors")(config)
require("lua.layout")(config)
require("lua.tabs")(config)
require("lua.status")(config)
require("lua.platform")(config)

return config
