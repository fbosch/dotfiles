function format_date_display --description 'Convert YYYY-MM-DD to DD.MM.YYYY for display'
    set -l iso_date $argv[1]
    set -l parts (string split '-' $iso_date)
    echo "$parts[3].$parts[2].$parts[1]"
end
