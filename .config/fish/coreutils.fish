# uutils-coreutils replacements

if test -d "$HOMEBREW_PREFIX/bin" -a (count $HOMEBREW_PREFIX/bin/u*) -gt 0
    alias cp $HOMEBREW_PREFIX/bin/ucp
    alias date $HOMEBREW_PREFIX/bin/udate
    alias whoami $HOMEBREW_PREFIX/bin/uwhoami
    alias pwd $HOMEBREW_PREFIX/bin/upwd
    alias mv $HOMEBREW_PREFIX/bin/umv
    alias kill $HOMEBREW_PREFIX/bin/ukill
    alias touch $HOMEBREW_PREFIX/bin/utouch
    alias cat $HOMEBREW_PREFIX/bin/ucat
    alias printf $HOMEBREW_PREFIX/bin/uprintf
    alias paste $HOMEBREW_PREFIX/bin/upaste
    alias mkdir $HOMEBREW_PREFIX/bin/umkdir
    alias rm $HOMEBREW_PREFIX/bin/urm
    alias rmdir $HOMEBREW_PREFIX/bin/urmdir
    alias env $HOMEBREW_PREFIX/bin/uenv
    alias cut $HOMEBREW_PREFIX/bin/ucut
    alias join $HOMEBREW_PREFIX/bin/ujoin
    alias printenv $HOMEBREW_PREFIX/bin/uprintenv
    alias mktemp $HOMEBREW_PREFIX/bin/umktemp
    alias uname $HOMEBREW_PREFIX/bin/uuname
    alias sort $HOMEBREW_PREFIX/bin/usort
    alias tsort $HOMEBREW_PREFIX/bin/utsort
    alias seq $HOMEBREW_PREFIX/bin/useq
    alias head $HOMEBREW_PREFIX/bin/uhead
    alias tail $HOMEBREW_PREFIX/bin/utail
    alias printenv $HOMEBREW_PREFIX/bin/uprintenv
    alias uptime $HOMEBREW_PREFIX/bin/uuptime
end
