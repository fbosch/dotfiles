function wsc --description 'Create a worktree and start Pi'
    set -l switch_args
    set -l pi_args
    set -l forwarding_pi_args false
    for argument in $argv
        if test "$argument" = "--"; and test "$forwarding_pi_args" = false
            set forwarding_pi_args true
        else if test "$forwarding_pi_args" = true
            set -a pi_args $argument
        else
            set -a switch_args $argument
        end
    end

    # Load the new worktree's environment before starting its agent.
    if type -q direnv
        wt switch --create --execute=direnv $switch_args -- exec "{{ worktree_path }}" pi $pi_args
    else
        wt switch --create --execute=pi $switch_args -- $pi_args
    end
end
