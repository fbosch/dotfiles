. ~/.config/fish/scripts.fish

if test (uname) = "Darwin"
  while true 
    set -Ux _hours_worked (hours_since_workday_start)
    wezterm_set_user_var "hours_worked" $_hours_worked
    commandline --function repaint
    # wait for 5 minutes
    sleep 300
  end
end