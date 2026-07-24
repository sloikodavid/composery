# Minimal Debian + systemd image for the overlay-root spike.
# NOT the Composery image: just enough to boot systemd and prove the mechanics.
FROM debian:trixie-slim

# systemd (+sysv wrappers), and util-linux/mount for pivot_root/mount/findmnt.
RUN apt-get update \
	&& DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
		systemd systemd-sysv util-linux mount procps attr strace \
	&& rm -rf /var/lib/apt/lists/* \
	&& ln -sf /lib/systemd/system/multi-user.target /etc/systemd/system/default.target

# Durable-volume mountpoint, empty in the image exactly like production /data.
RUN mkdir -p /data

# A sample enabled unit: proves the boot reached multi-user.target inside the
# pivoted overlay root (systemctl is-active + the marker it writes on start).
# ExecStop appends to a log ON THE VOLUME, which only runs during an orderly
# systemd shutdown --- so its presence after `docker stop` proves the SIGRTMIN+3
# path ran shutdown cleanly rather than the container being SIGKILLed.
RUN printf '%s\n' \
	'[Unit]' \
	'Description=overlay-spike sample unit' \
	'[Service]' \
	'Type=oneshot' \
	'RemainAfterExit=yes' \
	"ExecStart=/bin/sh -c 'echo active > /run/overlay-spike-sample.marker'" \
	"ExecStop=/bin/sh -c 'echo clean-stop >> /data/overlay-spike-shutdown.log'" \
	'[Install]' \
	'WantedBy=multi-user.target' \
	>/etc/systemd/system/overlay-spike-sample.service \
	&& mkdir -p /etc/systemd/system/multi-user.target.wants \
	&& ln -sf /etc/systemd/system/overlay-spike-sample.service \
		/etc/systemd/system/multi-user.target.wants/overlay-spike-sample.service

# Lower-content markers. The upgrade test (04) rebuilds with a different
# LOWER_VERSION to simulate an image bump while the upper (delta) is unchanged.
ARG LOWER_VERSION=1
RUN echo "lower-version=${LOWER_VERSION}" >/etc/overlay-spike-lower \
	&& echo "from-image-v${LOWER_VERSION}" >/usr/share/overlay-spike-marker

# Upgrade-test fixtures (04). The upgrade test builds v1 then v2 and boots v2 on
# v1's upper. Each file probes one interaction between a NEW lower and an OLD upper:
#   untouched.txt   present in both, user never touches -> should show v2 after upgrade
#   user-edits.txt  present in both, user edits on v1   -> upper must win over v2
#   reintroduced.txt present in both, user deletes on v1 -> v2's copy shadowed by whiteout
#   pkgdir/         user replaces the dir on v1 (opaque) -> v2's new files in it hidden
#   only-in-v2.txt  added only in v2                     -> new lower file should appear
RUN set -eu; d=/opt/upg; mkdir -p "$d/pkgdir"; \
	echo "v${LOWER_VERSION}" >"$d/untouched.txt"; \
	echo "v${LOWER_VERSION}" >"$d/user-edits.txt"; \
	echo "v${LOWER_VERSION}-important" >"$d/reintroduced.txt"; \
	echo "v${LOWER_VERSION}-a" >"$d/pkgdir/a.txt"; \
	if [ "${LOWER_VERSION}" = 2 ]; then \
		echo "v2-only" >"$d/only-in-v2.txt"; \
		echo "v2-b" >"$d/pkgdir/b.txt"; \
	fi

COPY entrypoint.sh /usr/local/sbin/overlay-root-entrypoint.sh
RUN chmod +x /usr/local/sbin/overlay-root-entrypoint.sh

ENTRYPOINT ["/usr/local/sbin/overlay-root-entrypoint.sh"]
