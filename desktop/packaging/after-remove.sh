#!/bin/bash
# Community Lab IDE: after the .deb is removed. electron-builder's own step
# (the command on the PATH), then the AppArmor profile is unloaded when the
# package is purged (its file under /etc is a conffile, kept on a plain remove).

if type update-alternatives >/dev/null 2>&1; then
    update-alternatives --remove 'community-lab-ide' '/usr/bin/community-lab-ide'
else
    rm -f '/usr/bin/community-lab-ide'
fi

if [ "$1" = "purge" ] && hash apparmor_parser 2>/dev/null && [ -d /sys/kernel/security/apparmor ]; then
    apparmor_parser --remove /etc/apparmor.d/community-lab-ide 2>/dev/null || true
    rm -f /etc/apparmor.d/community-lab-ide
fi
