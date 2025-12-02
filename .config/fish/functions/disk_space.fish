function disk_space
    df -h / | awk 'NR==2 {print "Total: " $2 "\nUsed: " $3 "\nAvailable: " $4 "\nPercentage Used: " $5}'
end
