function copykey
    if not pbcopy <~/.ssh/id_rsa.pub
        return 1
    end
end
