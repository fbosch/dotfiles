function toggle_proxy
    set current_status (networksetup -getwebproxy "Wi-Fi" | grep Enabled | cut -d " " -f 2 | head -1)
    if test "$current_status" = No
        echo (set_color green)" 🌐 Turning the proxy on "(set_color normal)
        networksetup -setwebproxystate Wi-Fi on
        networksetup -setsecurewebproxystate Wi-Fi on
    else
        echo (set_color red)" 🌐 Turning the proxy off "(set_color normal)
        networksetup -setwebproxystate Wi-Fi off
        networksetup -setsecurewebproxystate Wi-Fi off
    end
end
