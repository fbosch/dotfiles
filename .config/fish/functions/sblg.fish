function sblg
    swpm cross-env NODE_OPTIONS=--openssl-legacy-provider start-storybook -p 9000 $argv
end
