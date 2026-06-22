# Node major is pinned by code-server (engines + VS Code remote/.npmrc target), whose
# native modules are built for this ABI. The builder and runtime must share it, so it
# lives in one ARG; bump both together when code-server moves to a new Node major.
ARG NODE_IMAGE=node:22-trixie-slim@sha256:e637ac91fb4f2f40761d217c5d48c41a05edf0b65eb9c34e72c27cce55af9e65

# Build patched code-server from source.
FROM ${NODE_IMAGE} AS code-server-builder

# renovate: datasource=custom.code-server-tags depName=coder/code-server versioning=semver
ARG CODE_SERVER_VERSION=4.118.0
ARG CODE_SERVER_COMMIT=871f1d904834ee78db1c4585e2f14f65c119374a
ARG CODE_SERVER_REPOSITORY=https://github.com/coder/code-server.git

# Apt packages are intentionally unpinned: the Debian suite comes from the base
# image, and the image digest is the reproducibility boundary.
RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    build-essential \
    ca-certificates \
    git \
    git-lfs \
    jq \
    libkrb5-dev \
    libsecret-1-dev \
    libx11-dev \
    libxkbfile-dev \
    patch \
    pkg-config \
    python-is-python3 \
    quilt \
    rsync \
    unzip \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /src/code-server

# Fetch code-server and VS Code.
RUN git clone --branch "v${CODE_SERVER_VERSION}" --depth 1 "${CODE_SERVER_REPOSITORY}" . \
  && test "$(git rev-parse HEAD)" = "${CODE_SERVER_COMMIT}" \
  && git submodule update --init --depth 1

# Install dependencies before local diffs so patch-only changes keep this layer cached.
RUN npm ci

# Add local code-server source diffs before building the standalone release.
COPY vendor/code-server/patches/ /tmp/code-server-patches/
RUN while IFS= read -r patch_name || [ -n "${patch_name}" ]; do \
    case "${patch_name}" in ""|\#*) continue ;; esac; \
    cp "/tmp/code-server-patches/${patch_name}" "patches/${patch_name}"; \
    printf '%s\n' "${patch_name}" >> patches/series; \
  done < /tmp/code-server-patches/series \
  && quilt push -a \
  && rm -rf /tmp/code-server-patches

# Build the standalone release.
RUN npm run build \
  && VERSION="${CODE_SERVER_VERSION}" npm run build:vscode \
  && KEEP_MODULES=1 npm run release

# Overlay Composery browser assets onto the built release.
COPY vendor/code-server/overlay/ /src/code-server/release/
RUN XDG_CONFIG_HOME=/tmp/code-server-config /src/code-server/release/bin/code-server --version --json > /tmp/code-server.version.json \
  && node -e 'const fs = require("node:fs"); const line = fs.readFileSync("/tmp/code-server.version.json", "utf8").split(/\n/).find((entry) => entry.trim().startsWith("{")); if (!line) { throw new Error("code-server version JSON was not found"); } const actual = JSON.parse(line); if (actual.codeServer !== process.argv[1] || actual.commit !== process.argv[2]) { throw new Error(`code-server version mismatch: ${JSON.stringify(actual)}`); }' \
    "${CODE_SERVER_VERSION}" \
    "${CODE_SERVER_COMMIT}" \
  && printf 'version=%s\ncommit=%s\nsource=%s\n' \
    "${CODE_SERVER_VERSION}" \
    "${CODE_SERVER_COMMIT}" \
    "${CODE_SERVER_REPOSITORY}" \
    > /src/code-server/release/.composery-upstream \
  && rm -rf /tmp/code-server.version.json /tmp/code-server-config

# Build persistence. cargo-chef caches the dependency compile so source-only edits skip it.
FROM rust:1.96.0-slim-trixie@sha256:26abcef3d79b8d890c4ceb17093154573e1f6479cf6dd7c1450043b8458350f6 AS persistence-chef
# renovate: datasource=crate depName=cargo-chef
ARG CARGO_CHEF_VERSION=0.1.77
RUN cargo install cargo-chef --version "${CARGO_CHEF_VERSION}" --locked
WORKDIR /src/persistence

FROM persistence-chef AS persistence-planner
COPY packages/persistence/ .
RUN cargo chef prepare --recipe-path /recipe.json

FROM persistence-chef AS persistence-builder
COPY --from=persistence-planner /recipe.json /recipe.json
RUN cargo chef cook --release --recipe-path /recipe.json
COPY packages/persistence/ .
RUN cargo build --release --locked --bin persistence \
  && install -D target/release/persistence /out/persistence

# Assemble the runtime image.
FROM ${NODE_IMAGE} AS runtime

ARG COMPOSERY_BUILD_VERSION=unknown
ARG COMPOSERY_BUILD_REVISION=unknown
ARG COMPOSERY_BUILD_SOURCE=https://github.com/sloikodavid/composery

LABEL org.opencontainers.image.title="Composery" \
  org.opencontainers.image.description="A persistent VPS-like Linux appliance with code-server in the browser." \
  org.opencontainers.image.source="${COMPOSERY_BUILD_SOURCE}" \
  org.opencontainers.image.revision="${COMPOSERY_BUILD_REVISION}" \
  org.opencontainers.image.version="${COMPOSERY_BUILD_VERSION}" \
  org.opencontainers.image.licenses="Apache-2.0"

# renovate: datasource=npm depName=bun
ARG BUN_VERSION=1.3.14
# renovate: datasource=npm depName=npm
ARG NPM_VERSION=11.17.0
# renovate: datasource=npm depName=pnpm
ARG PNPM_VERSION=11.7.0

ENV COMPOSERY_BUILD_VERSION="${COMPOSERY_BUILD_VERSION}" \
  COMPOSERY_BUILD_REVISION="${COMPOSERY_BUILD_REVISION}" \
  COMPOSERY_BUILD_SOURCE="${COMPOSERY_BUILD_SOURCE}" \
  BROWSER="/opt/code-server/current/lib/vscode/bin/helpers/browser.sh" \
  EDITOR="code --wait" \
  GIT_EDITOR="code --wait" \
  KUBE_EDITOR="code --wait" \
  LANG="C.UTF-8" \
  VISUAL="code --wait" \
  XDG_RUNTIME_DIR="/run/user/1000"
# LANG gives a UTF-8 default; LC_ALL is intentionally not pinned so the user can
# override the locale per session (a pinned LC_ALL overrides every LC_* and LANG,
# which would prevent that). A deployment-provided LC_ALL is still honored.

# Put the user's standard bin dirs on PATH at the process level, not just in
# interactive shells, so binaries on ~/.local/bin work everywhere that inherits
# this environment: integrated terminals, and shells an AI agent or task spawns
# (including `bash -c`/sandboxed commands, which source no startup files and so
# rely on inherited PATH). Interactive login shells layer rc-file PATH edits
# (cargo, rustup, ...) on top of this.
ENV PATH="/home/user/.local/bin:/home/user/bin:${PATH}"

# Apt packages are intentionally unpinned: the Debian suite comes from the base
# image, and the image digest is the reproducibility boundary. APT lists are kept
# so `sudo apt install` works out of the box in this VPS-like appliance; `apt
# update` refreshes them, and persistence persists any changes.
RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    bash \
    ca-certificates \
    cron \
    curl \
    desktop-file-utils \
    git \
    jq \
    less \
    libfile-mimeinfo-perl \
    mailcap \
    nano \
    openssh-client \
    procps \
    python3 \
    ripgrep \
    shared-mime-info \
    sudo \
    supervisor \
    systemd \
    tar \
    unzip \
    vim-tiny \
    wget \
    xdg-user-dirs \
    xdg-utils \
    xz-utils \
    zip

# cron's PAM stack fails `session required pam_loginuid.so` in an unprivileged
# container (no writable /proc/self/loginuid), which silently stops cron jobs from
# running even though the daemon is up. Make it optional so `crontab` works.
RUN sed -i 's/session\s\+required\s\+pam_loginuid/session optional pam_loginuid/' /etc/pam.d/cron

RUN npm install --global \
    "bun@${BUN_VERSION}" \
    "npm@${NPM_VERSION}" \
    "pnpm@${PNPM_VERSION}" \
  && npm cache clean --force

RUN groupmod --new-name user node \
  && usermod --login user --home /home/user --move-home node \
  && mkdir -p /home/user

COPY --from=code-server-builder /src/code-server/release /opt/code-server/current
COPY --from=persistence-builder /out/persistence /opt/persistence/bin/persistence
COPY rootfs/ /

# Show only the working directory in the interactive prompt (~/Desktop, not
# user@<container-id>:~/Desktop). The stock Debian skel ~/.bashrc (moved from
# /home/node) sets the user@host prompt; the last PS1 assignment wins, so
# appending here overrides it. Captured in the persistence baseline below.
RUN printf '%s\n' \
    '' \
    '# Composery: show only the working directory in the prompt.' \
    'PS1='\''${debian_chroot:+($debian_chroot)}\[\033[01;34m\]\w\[\033[00m\]\$ '\''' \
    >> /home/user/.bashrc

# Final runtime wiring: create the user's standard bin dirs (so login shells add
# them to PATH via the stock ~/.profile even before anything is installed), fix
# ownership (home, and /usr/local so the user can install globally without sudo),
# permissions, unit symlinks, and desktop/mime caches, then snapshot the baseline
# persistence restores from.
RUN find /home/user -name .gitkeep -type f -delete \
  && mkdir -p /data /etc/systemd/system/multi-user.target.wants \
  && mkdir -p /home/user/.local/bin /home/user/bin \
  && rm -f /etc/machine-id \
  && touch /etc/machine-id \
  && chown -R user:user /home/user \
  && chmod 0440 /etc/sudoers.d/user \
  && chmod +x /opt/composery/entrypoint.sh \
  && chmod +x /opt/composery/code-server.sh \
  && chmod +x /opt/composery/init/*.sh \
  && chmod +x /usr/local/bin/xclip /usr/local/bin/xsel /usr/local/bin/wl-paste /usr/local/bin/wl-copy \
  && rm -f /etc/systemd/system/multi-user.target.wants/supervisor.service \
  && ln -sf /dev/null /etc/systemd/system/systemd-modules-load.service \
  && ln -sf ../persistence.service /etc/systemd/system/multi-user.target.wants/persistence.service \
  && ln -sf ../composery.service /etc/systemd/system/multi-user.target.wants/composery.service \
  && ln -sf /opt/code-server/current/lib/vscode/bin/remote-cli/code-server /usr/local/bin/code \
  && ln -sf /opt/code-server/current/bin/code-server /usr/local/bin/code-server \
  && update-desktop-database /usr/share/applications \
  && update-mime-database /usr/share/mime \
  && chown -R user:user /usr/local \
  && /opt/persistence/bin/persistence __generate-baseline --root / --output /opt/persistence/baseline.sqlite

# No USER directive: persistence needs root to rebuild the filesystem on boot; supervisor
# drops to the unprivileged `user` for code-server. Root is intentional.
EXPOSE 8080

# Liveness against code-server's auth-exempt /healthz; PORT comes from the container env.
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD curl -fsS "http://localhost:${PORT:-8080}/healthz" > /dev/null || exit 1

ENTRYPOINT ["/opt/composery/entrypoint.sh"]
