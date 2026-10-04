#!/bin/bash
# Community Lab IDE: after the .deb is installed. electron-builder's own steps
# (the command on the PATH, the sandbox helper, the MIME and desktop
# databases), then the AppArmor profile is loaded, so the first launch on
# Ubuntu 24.04 has its user namespaces.

APP='/opt/Community Lab IDE'

if type update-alternatives 2>/dev/null >&1; then
    # Remove a previous link that does not use update-alternatives
    if [ -L '/usr/bin/community-lab-ide' -a -e '/usr/bin/community-lab-ide' -a "`readlink '/usr/bin/community-lab-ide'`" != '/etc/alternatives/community-lab-ide' ]; then
        rm -f '/usr/bin/community-lab-ide'
    fi
    update-alternatives --install '/usr/bin/community-lab-ide' 'community-lab-ide' "$APP/community-lab-ide" 100 || ln -sf "$APP/community-lab-ide" '/usr/bin/community-lab-ide'
else
    ln -sf "$APP/community-lab-ide" '/usr/bin/community-lab-ide'
fi

# Where user namespaces work, the SUID sandbox helper is not needed.
if ! { [[ -L /proc/self/ns/user ]] && unshare --user true; }; then
    chmod 4755 "$APP/chrome-sandbox" || true
else
    chmod 0755 "$APP/chrome-sandbox" || true
fi

# The AppArmor profile (/etc/apparmor.d/community-lab-ide), where AppArmor is in use.
if [ -f /etc/apparmor.d/community-lab-ide ] && hash apparmor_parser 2>/dev/null && [ -d /sys/kernel/security/apparmor ]; then
    apparmor_parser --replace --write-cache --skip-read-cache /etc/apparmor.d/community-lab-ide || true
fi

if hash update-mime-database 2>/dev/null; then
    update-mime-database /usr/share/mime || true
fi

if hash update-desktop-database 2>/dev/null; then
    update-desktop-database /usr/share/applications || true
fi
