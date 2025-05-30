local config = require("wezterm").config_builder()

require("base")(config)
require("fonts")(config)
require("colors")(config)
require("layout")(config)
require("tabs")(config)
require("status")(config)
require("platform")(config)

return config
