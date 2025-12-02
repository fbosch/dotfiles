function src
    jq -r \'.scripts | to_entries[] | "\(.key):\n \(.value)\n"\' package.json | awk \'BEGIN{idx=1} {print "\033[3"idx"m" $0 "\033[0m"; idx = idx % 3 + 1}\'
end
