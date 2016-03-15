# yodel
[![dependency Status](https://david-dm.org/gamekeller/yodel/status.svg)](https://david-dm.org/gamekeller/yodel#info=dependencies)
[![devDependency Status](https://david-dm.org/gamekeller/yodel/dev-status.svg)](https://david-dm.org/gamekeller/yodel#info=devDependencies)

TeamSpeak bot for [gamekeller.net](https://gamekeller.net)

Released under the terms of the [MIT license](LICENSE).


## Tunnel

We strongly recommend using a SSH tunnel to forward the TeamSpeak Query connection if it is hosted on a different server than yodel.
Otherwise all commands (including login credentials) would be transmitted in plain text over the network, exposing them to potential MITM attcks.

Here's an example of how to set up [`autossh`](http://www.harding.motd.ca/autossh/) for this purpose:

```
# Be root
sudo -i

# Install autossh
apt-get install autossh

# Generate keys (make sure to leave the passphrase empty)
ssh-keygen -t rsa -b 4096 -C "yodel"

# Add public key as authorized key on the target server

# Set up SSH config
cat << EOF >> ~/.ssh/config
Host teamspeak-tunnel
  HostName             example.com
  User                 yodel
  IdentityFile         ~/.ssh/id_rsa-yodel
  LocalForward         10011 localhost:10011
  ServerAliveInterval  5
  ServerAliveCountMax  2
  ExitOnForwardFailure yes
EOF

# Try it out
autossh -M 0 teamspeak-tunnel

# Add startup script
touch /etc/network/if-up.d/teamspeak-tunnel
chmod +x /etc/network/if-up.d/teamspeak-tunnel

cat << EOF > /etc/network/if-up.d/teamspeak-tunnel
#!/bin/sh
sudo /usr/bin/autossh -M 0 -fNT teamspeak-tunnel &
EOF
```