local config = require("wezterm").config_builder()

require("base")(config)
require("keys")(config)
require("fonts")(config)
require("colors")(config)
require("layout")(config)
require("mux")(config)
require("agent").apply(config)
require("tabs")(config)
require("status")(config)
require("platform")(config)

return config
