function pi --wraps=pi --description 'Run Pi without inline images in Herdr'
    if test "$HERDR_ENV" = 1
        set -lx PI_IMAGE_PROTOCOL none
    end

    command pi $argv
end
